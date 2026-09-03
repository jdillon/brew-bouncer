/*
 * Copyright 2026 Jason Dillon
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import type { DetectedApp } from "./detect/matcher.ts";
import {
  pidsForExecutable,
  pidsInBundle,
  resolveBundleMainExecutable,
} from "./detect/casks.ts";
import { exec } from "./brew/runner.ts";
import { log } from "./logger.ts";

export async function restartApp(app: DetectedApp): Promise<boolean> {
  switch (app.kind) {
    case "cask-gui":
      if (!(await quitGuiApp(app))) return false;
      return reopenGuiApp(app);
    case "formula-service":
      return restartService(app);
    case "cask-cli":
    case "formula-cli":
      return restartCliProcess(app);
  }
}

export async function quitGuiApp(app: DetectedApp): Promise<boolean> {
  const appName = app.displayName.replace(/\.app$/, "");
  const detectedPids = app.pids;
  const bundlePath = app.bundlePath;

  let scanner: GuiProcessScanner;
  try {
    scanner = await createGuiProcessScanner(detectedPids, bundlePath);
  } catch (error) {
    log.error("Cannot inspect processes for {app}: {error}", {
      app: appName,
      error: errorMessage(error),
    });
    return false;
  }

  // Quit the app gracefully via AppleScript
  log.debug("Quitting app: {app}", { app: appName });
  const quit = Bun.spawn(
    ["osascript", "-e", `tell application "${appName}" to quit`],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [, stderr, exitCode] = await Promise.all([
    new Response(quit.stdout).text(),
    new Response(quit.stderr).text(),
    quit.exited,
  ]);

  if (exitCode !== 0) {
    log.error("Failed to request graceful quit for {app}: {stderr}", {
      app: appName,
      stderr: stderr.trim(),
    });
    return false;
  }

  if (detectedPids.length === 0 && !bundlePath) {
    log.error("Cannot verify that app {app} quit", { app: appName });
    return false;
  }

  // Poll until the app's main executable is gone (up to 10s). Helpers and
  // launchd-managed XPC services can legitimately outlive a conventional main
  // process. For nonstandard bundles where a main process cannot be proven,
  // conservatively retain exact bundle-path tracking instead.
  //
  // For osascript-only entries with no bundle path, fall back to the original
  // PID set. Using PIDs (not a name match) avoids killing unrelated processes
  // that share a case-insensitive name (e.g. Claude.app vs the `claude` CLI).
  const quitDeadline = Date.now() + 10_000;
  let livePids = detectedPids;
  while (Date.now() < quitDeadline) {
    try {
      livePids = await scanner.scan();
    } catch (error) {
      log.error("Cannot verify that app {app} quit: {error}", {
        app: appName,
        error: errorMessage(error),
      });
      return false;
    }
    if (livePids.length === 0) break;
    await Bun.sleep(500);
  }

  // Escalate: SIGTERM only the specific surviving PIDs we detected.
  // Defense-in-depth: if we know the .app bundle path, re-verify each PID's
  // current executable still lives inside that bundle. PIDs can be recycled
  // between detection and restart, so a stale PID could now belong to an
  // unrelated process. Skip any PID whose exec path no longer matches.
  if (livePids.length > 0) {
    let verified: number[];
    try {
      verified = bundlePath
        ? await filterPidsByBundle(livePids, bundlePath)
        : livePids;
    } catch (error) {
      log.error("Cannot verify processes before stopping app {app}: {error}", {
        app: appName,
        error: errorMessage(error),
      });
      return false;
    }

    const skipped = livePids.filter((p) => !verified.includes(p));
    if (skipped.length > 0) {
      log.warn(
        "Skipping SIGTERM for {count} pids no longer in bundle {bundle}: {pids}",
        {
          count: skipped.length,
          bundle: bundlePath ?? "<unknown>",
          pids: skipped.join(","),
        }
      );
    }

    if (verified.length > 0) {
      log.debug("Graceful quit timed out for {app}, sending SIGTERM to {pids}", {
        app: appName,
        pids: verified.join(","),
      });
      for (const pid of verified) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // Process may have just exited — ignore
        }
      }

      const killDeadline = Date.now() + 5_000;
      let stillLive = verified;
      while (Date.now() < killDeadline) {
        try {
          stillLive = await scanner.scan();
        } catch (error) {
          log.error("Cannot verify that app {app} quit after SIGTERM: {error}", {
            app: appName,
            error: errorMessage(error),
          });
          return false;
        }
        if (stillLive.length === 0) break;
        await Bun.sleep(500);
      }

      if (stillLive.length > 0) {
        log.error("App {app} did not quit after SIGTERM (pids {pids})", {
          app: appName,
          pids: stillLive.join(","),
        });
        return false;
      }
    }
  }

  // Let macOS release the old bundle before Homebrew replaces it.
  await Bun.sleep(500);

  return true;
}

export async function reopenGuiApp(app: DetectedApp): Promise<boolean> {
  const appName = app.displayName.replace(/\.app$/, "");
  const bundlePath = app.bundlePath;

  let scanLaunched: (() => Promise<number[]>) | undefined;
  if (bundlePath) {
    try {
      const mainExecutable = await resolveBundleMainExecutable(bundlePath);
      scanLaunched = mainExecutable
        ? () => pidsForExecutable(mainExecutable)
        : () => pidsInBundle(bundlePath);
    } catch (error) {
      log.error("Cannot prepare launch verification for {app}: {error}", {
        app: appName,
        error: errorMessage(error),
      });
      return false;
    }
  }

  // Reopen the app
  log.debug("Reopening app: {app}", { app: appName });
  const open = Bun.spawn(
    bundlePath ? ["open", bundlePath] : ["open", "-a", appName],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );
  const exitCode = await open.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(open.stderr).text();
    log.error("Failed to reopen app: {app} {stderr}", { app: appName, stderr });
    return false;
  }

  // Verify the app actually launched (poll up to 5s) by requiring its main
  // executable when one can be resolved. A helper or XPC process left behind
  // after a failed shutdown must not make a failed reopen look successful.
  // Nonstandard bundles fall back to exact bundle-path tracking.
  //
  // Without bundlePath (osascript-only entries), trust `open -a` exit code
  // since we have no reliable way to verify the launched process.
  if (!bundlePath) {
    return true;
  }

  const launchDeadline = Date.now() + 5_000;
  let launched = false;
  while (Date.now() < launchDeadline) {
    await Bun.sleep(500);
    try {
      launched = (await scanLaunched!()).length > 0;
      if (launched) break;
    } catch (error) {
      log.error("Cannot verify that app {app} reopened: {error}", {
        app: appName,
        error: errorMessage(error),
      });
      return false;
    }
  }

  if (!launched) {
    log.error("App {app} did not appear in process list after open", { app: appName });
    return false;
  }

  return true;
}

function filterLivePids(pids: number[]): number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM => process exists but we can't signal it; still alive.
      // ESRCH (and anything else) => treat as dead.
      return (err as NodeJS.ErrnoException)?.code === "EPERM";
    }
  });
}

type BundlePidScanner = (bundlePath: string) => Promise<number[]>;

interface GuiProcessScannerDependencies {
  resolveMainExecutable: (bundlePath: string) => Promise<string | undefined>;
  scanExecutable: (executablePath: string) => Promise<number[]>;
  scanBundle: BundlePidScanner;
}

interface GuiProcessScanner {
  mode: "main" | "bundle" | "pid";
  scan: () => Promise<number[]>;
}

const defaultGuiProcessScannerDependencies: GuiProcessScannerDependencies = {
  resolveMainExecutable: resolveBundleMainExecutable,
  scanExecutable: pidsForExecutable,
  scanBundle: pidsInBundle,
};

/**
 * Prefer main-executable tracking only after observing that executable alive.
 * Otherwise use the whole bundle so an inspection failure cannot masquerade
 * as a successful quit.
 */
export async function createGuiProcessScanner(
  trackedPids: number[],
  bundlePath?: string,
  dependencies: GuiProcessScannerDependencies = defaultGuiProcessScannerDependencies,
): Promise<GuiProcessScanner> {
  if (!bundlePath) {
    let pids = trackedPids;
    return {
      mode: "pid",
      scan: async () => {
        pids = filterLivePids(pids);
        return pids;
      },
    };
  }

  const mainExecutable = await dependencies.resolveMainExecutable(bundlePath);
  if (mainExecutable) {
    const mainPids = await dependencies.scanExecutable(mainExecutable);
    if (mainPids.length > 0) {
      return {
        mode: "main",
        scan: () => dependencies.scanExecutable(mainExecutable),
      };
    }
  }

  return {
    mode: "bundle",
    scan: () => dependencies.scanBundle(bundlePath),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Return only the PIDs whose executable path currently resides under the
 * given .app bundle. Guards against PID recycling between detection and
 * restart — a stale PID could otherwise SIGTERM an unrelated process.
 */
async function filterPidsByBundle(
  pids: number[],
  bundlePath: string,
): Promise<number[]> {
  if (pids.length === 0) return [];

  const proc = Bun.spawn(["ps", "-ww", "-o", "pid=,comm=", "-p", ...pids.map(String)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  // BSD ps exits 1 with no output when every requested PID disappeared in the
  // race between scanning and verification. Any diagnostic is an inspection
  // failure, not evidence that the app is gone.
  if (exitCode !== 0 && stderr.trim()) {
    throw new Error(`ps failed while verifying ${bundlePath}: ${stderr.trim()}`);
  }

  const prefix = bundlePath.endsWith("/") ? bundlePath : bundlePath + "/";
  const verified: number[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;
    const pid = Number.parseInt(trimmed.slice(0, spaceIdx), 10);
    const command = trimmed.slice(spaceIdx + 1);
    if (Number.isFinite(pid) && command.startsWith(prefix)) {
      verified.push(pid);
    }
  }
  return verified;
}

async function restartService(app: DetectedApp): Promise<boolean> {
  log.debug("Restarting brew service: {service}", { service: app.packageName });
  const result = await exec(["services", "restart", app.packageName]);

  if (result.exitCode !== 0) {
    log.error("Failed to restart service: {service} {stderr}", {
      service: app.packageName,
      stderr: result.stderr,
    });
    return false;
  }

  return true;
}

async function restartCliProcess(app: DetectedApp): Promise<boolean> {
  // For CLI processes, we can only kill them — we can't restart them
  // since we don't know how they were originally launched
  console.log(
    `  ${app.displayName} (PID ${app.pids.join(", ")}): CLI process — must be restarted manually`
  );
  return false;
}
