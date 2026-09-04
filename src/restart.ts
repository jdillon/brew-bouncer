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

const PROCESS_POLL_INTERVAL_MS = 500;
const GRACEFUL_QUIT_TIMEOUT_MS = 30_000;
const SIGTERM_QUIT_TIMEOUT_MS = 15_000;
const LAUNCH_TIMEOUT_MS = 20_000;
const LAUNCH_STABILITY_MS = 2_000;
const LAUNCH_RETRY_DELAY_MS = 5_000;

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

interface QuitGuiAppDependencies {
  createScanner: typeof createGuiProcessScanner;
  requestQuit: (appName: string) => Promise<QuitRequestResult>;
  waitForExit: typeof waitForNoProcesses;
  sleep: (milliseconds: number) => Promise<void>;
}

const defaultQuitGuiAppDependencies: QuitGuiAppDependencies = {
  createScanner: createGuiProcessScanner,
  requestQuit: requestGuiAppQuit,
  waitForExit: waitForNoProcesses,
  sleep: Bun.sleep,
};

export async function quitGuiApp(
  app: DetectedApp,
  dependencyOverrides: Partial<QuitGuiAppDependencies> = {},
): Promise<boolean> {
  const dependencies = {
    ...defaultQuitGuiAppDependencies,
    ...dependencyOverrides,
  };
  const appName = app.displayName.replace(/\.app$/, "");
  const detectedPids = app.pids;
  const bundlePath = app.bundlePath;

  let scanner: GuiProcessScanner;
  try {
    scanner = await dependencies.createScanner(detectedPids, bundlePath);
  } catch (error) {
    log.error("Cannot inspect processes for {app}: {error}", {
      app: appName,
      error: errorMessage(error),
    });
    return false;
  }

  // Quit the app gracefully via AppleScript
  log.debug("Quitting app: {app}", { app: appName });
  const { stderr, exitCode } = await dependencies.requestQuit(appName);
  const quitRequestSucceeded = exitCode === 0;

  if (!quitRequestSucceeded) {
    // Some apps (notably Raycast) return Apple event error -128 even though
    // they accepted the quit request and proceed to terminate. The process
    // scanner, not the AppleScript exit code, is the authoritative shutdown
    // evidence. Continue polling and only succeed once the process is gone.
    log.warn("Quit request for {app} returned an error; verifying exit: {stderr}", {
      app: appName,
      stderr: stderr.trim(),
    });
  }

  if (detectedPids.length === 0 && !bundlePath) {
    log.error("Cannot verify that app {app} quit", { app: appName });
    return false;
  }

  // Poll until the app's main executable is gone. Helpers and
  // launchd-managed XPC services can legitimately outlive a conventional main
  // process. For nonstandard bundles where a main process cannot be proven,
  // conservatively retain exact bundle-path tracking instead.
  //
  // For osascript-only entries with no bundle path, fall back to the original
  // PID set. Using PIDs (not a name match) avoids killing unrelated processes
  // that share a case-insensitive name (e.g. Claude.app vs the `claude` CLI).
  let livePids: number[];
  try {
    livePids = await dependencies.waitForExit(
      scanner.scan,
      GRACEFUL_QUIT_TIMEOUT_MS,
    );
  } catch (error) {
    log.error("Cannot verify that app {app} quit: {error}", {
      app: appName,
      error: errorMessage(error),
    });
    return false;
  }

  // Escalate: SIGTERM only the specific surviving PIDs we detected.
  // Defense-in-depth: if we know the .app bundle path, re-verify each PID's
  // current executable still lives inside that bundle. PIDs can be recycled
  // between detection and restart, so a stale PID could now belong to an
  // unrelated process. Skip any PID whose exec path no longer matches.
  if (livePids.length > 0) {
    // A failed AppleScript request may still be followed by a natural exit,
    // as Raycast demonstrates. If no exit follows, however, do not turn a
    // genuinely rejected quit into a forced termination.
    if (!quitRequestSucceeded) {
      log.error("App {app} remained running after its quit request failed", {
        app: appName,
      });
      return false;
    }

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

      let stillLive: number[];
      try {
        stillLive = await dependencies.waitForExit(
          scanner.scan,
          SIGTERM_QUIT_TIMEOUT_MS,
        );
      } catch (error) {
        log.error("Cannot verify that app {app} quit after SIGTERM: {error}", {
          app: appName,
          error: errorMessage(error),
        });
        return false;
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
  await dependencies.sleep(500);

  return true;
}

interface QuitRequestResult {
  stderr: string;
  exitCode: number;
}

async function requestGuiAppQuit(appName: string): Promise<QuitRequestResult> {
  const quit = Bun.spawn(
    ["osascript", "-e", `tell application "${appName}" to quit`],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [, stderr, exitCode] = await Promise.all([
    new Response(quit.stdout).text(),
    new Response(quit.stderr).text(),
    quit.exited,
  ]);
  return { stderr, exitCode };
}

interface ReopenGuiAppOptions {
  previousProcessWasStopped?: boolean;
}

export async function reopenGuiApp(
  app: DetectedApp,
  options: ReopenGuiAppOptions = {},
): Promise<boolean> {
  const appName = app.displayName.replace(/\.app$/, "");
  const bundlePath = app.bundlePath;

  let scanLaunched: (() => Promise<number[]>) | undefined;
  let preexistingPids: number[] = [];
  if (bundlePath) {
    try {
      const mainExecutable = await resolveBundleMainExecutable(bundlePath);
      scanLaunched = mainExecutable
        ? () => pidsForExecutable(mainExecutable)
        : () => pidsInBundle(bundlePath);
      const observedPids = await scanLaunched();
      // Homebrew may reopen applications named by a cask's `quit` stanza
      // during `brew upgrade`. Once we already proved the old process stopped,
      // these observed PIDs belong to a valid post-upgrade launch and must not
      // be excluded as stale. On recovery from a failed quit, keep excluding
      // them because they may still be the terminating old process.
      preexistingPids = options.previousProcessWasStopped ? [] : observedPids;
    } catch (error) {
      log.error("Cannot prepare launch verification for {app}: {error}", {
        app: appName,
        error: errorMessage(error),
      });
      return false;
    }
  }

  const launch = () => launchGuiApp(appName, bundlePath);
  if (!(await launch())) return false;

  // Verify that a new app process launched and remained alive. A process that
  // was already terminating when `open` ran must not count as the relaunch.
  // If that old process exits after the first `open`, retry once now that
  // LaunchServices can create a genuinely new process.
  //
  // Without bundlePath (osascript-only entries), trust `open -a` exit code
  // since we have no reliable way to verify the launched process.
  if (!bundlePath) {
    return true;
  }

  let launched: boolean;
  try {
    launched = await waitForFreshStableProcesses(
      scanLaunched!,
      preexistingPids,
      launch,
    );
  } catch (error) {
    log.error("Cannot verify that app {app} reopened: {error}", {
      app: appName,
      error: errorMessage(error),
    });
    return false;
  }

  if (!launched) {
    log.error("App {app} did not appear in process list after open", { app: appName });
    return false;
  }

  return true;
}

interface ProcessPollClock {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}

const systemProcessPollClock: ProcessPollClock = {
  now: Date.now,
  sleep: Bun.sleep,
};

/** Poll through the timeout boundary so a last-moment exit is observed. */
export async function waitForNoProcesses(
  scan: () => Promise<number[]>,
  timeoutMs: number,
  clock: ProcessPollClock = systemProcessPollClock,
): Promise<number[]> {
  const deadline = clock.now() + timeoutMs;
  let livePids = await scan();

  while (livePids.length > 0 && clock.now() < deadline) {
    const remaining = deadline - clock.now();
    await clock.sleep(Math.min(PROCESS_POLL_INTERVAL_MS, remaining));
    livePids = await scan();
  }

  return livePids;
}

interface FreshProcessWaitOptions {
  timeoutMs?: number;
  stabilityMs?: number;
  retryDelayMs?: number;
  clock?: ProcessPollClock;
}

/**
 * Require a new PID to remain present, excluding any process that existed
 * before `open`. Retry once after an old PID finishes terminating, or after a
 * delayed launch produces no process.
 */
export async function waitForFreshStableProcesses(
  scan: () => Promise<number[]>,
  preexistingPids: number[],
  retryLaunch: () => Promise<boolean>,
  options: FreshProcessWaitOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? LAUNCH_TIMEOUT_MS;
  const stabilityMs = options.stabilityMs ?? LAUNCH_STABILITY_MS;
  const retryDelayMs = options.retryDelayMs ?? LAUNCH_RETRY_DELAY_MS;
  const clock = options.clock ?? systemProcessPollClock;
  const deadline = clock.now() + timeoutMs;
  const retryAt = clock.now() + retryDelayMs;
  const preexisting = new Set(preexistingPids);
  let retried = false;
  let stablePid: number | undefined;
  let stableSince = 0;

  while (clock.now() < deadline) {
    const remaining = deadline - clock.now();
    await clock.sleep(Math.min(PROCESS_POLL_INTERVAL_MS, remaining));

    const currentPids = await scan();
    const freshPids = currentPids
      .filter((pid) => !preexisting.has(pid))
      .sort((a, b) => a - b);
    const stablePidStillLive =
      stablePid !== undefined && freshPids.includes(stablePid);

    if (freshPids.length > 0) {
      if (!stablePidStillLive) {
        stablePid = freshPids[0];
        stableSince = clock.now();
      } else if (clock.now() - stableSince >= stabilityMs) {
        return true;
      }
    } else {
      stablePid = undefined;
      stableSince = 0;
    }

    if (!retried && freshPids.length === 0) {
      const preexistingStillLive = currentPids.some((pid) => preexisting.has(pid));
      const shouldRetry =
        preexisting.size > 0 ? !preexistingStillLive : clock.now() >= retryAt;
      const hasVerificationWindow =
        deadline - clock.now() >= stabilityMs + PROCESS_POLL_INTERVAL_MS;
      if (shouldRetry && hasVerificationWindow) {
        if (!(await retryLaunch())) return false;
        retried = true;
        stablePid = undefined;
        stableSince = 0;
      }
    }
  }

  return false;
}

async function launchGuiApp(
  appName: string,
  bundlePath?: string,
): Promise<boolean> {
  log.debug("Reopening app: {app}", { app: appName });
  const open = Bun.spawn(
    bundlePath ? ["open", bundlePath] : ["open", "-a", appName],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [, stderr, exitCode] = await Promise.all([
    new Response(open.stdout).text(),
    new Response(open.stderr).text(),
    open.exited,
  ]);

  if (exitCode !== 0) {
    log.error("Failed to reopen app: {app} {stderr}", {
      app: appName,
      stderr: stderr.trim(),
    });
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
