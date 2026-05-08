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
import { pidsInBundle } from "./detect/casks.ts";
import { exec } from "./brew/runner.ts";
import { log } from "./logger.ts";

export async function restartApp(app: DetectedApp): Promise<boolean> {
  switch (app.kind) {
    case "cask-gui":
      return restartGuiApp(app);
    case "formula-service":
      return restartService(app);
    case "cask-cli":
    case "formula-cli":
      return restartCliProcess(app);
  }
}

async function restartGuiApp(app: DetectedApp): Promise<boolean> {
  const appName = app.displayName.replace(/\.app$/, "");
  const detectedPids = app.pids;
  const bundlePath = app.bundlePath;

  // Quit the app gracefully via AppleScript
  log.debug("Quitting app: {app}", { app: appName });
  const quit = Bun.spawn(
    ["osascript", "-e", `tell application "${appName}" to quit`],
    { stdout: "pipe", stderr: "pipe" }
  );
  await quit.exited;

  // Poll until the originally-detected PIDs are gone (up to 10s).
  // Using PIDs (not name match) avoids killing unrelated processes that share
  // a case-insensitive name (e.g. Claude.app vs the `claude` CLI).
  //
  // When detectedPids is empty (e.g. cask app was supplemented via osascript
  // and ps didn't see it), re-scan by bundlePath each iteration so the wait
  // actually observes quitting processes instead of short-circuiting.
  const quitDeadline = Date.now() + 10_000;
  let livePids = detectedPids;
  while (Date.now() < quitDeadline) {
    if (livePids.length === 0 && detectedPids.length === 0 && bundlePath) {
      livePids = await pidsInBundle(bundlePath);
    } else {
      livePids = filterLivePids(livePids);
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
    const verified = bundlePath
      ? await filterPidsByBundle(livePids, bundlePath)
      : livePids;

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
        stillLive = filterLivePids(stillLive);
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

  // Brief settle after quit before reopening
  await Bun.sleep(500);

  // Reopen the app
  log.debug("Reopening app: {app}", { app: appName });
  const open = Bun.spawn(["open", "-a", appName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await open.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(open.stderr).text();
    log.error("Failed to reopen app: {app} {stderr}", { app: appName, stderr });
    return false;
  }

  // Verify the app actually launched (poll up to 5s) by scanning ps for
  // processes whose executable resides under the .app bundle path. Bundle-
  // path matching avoids the case-sensitivity trap where the bundle name
  // and the executable name differ (e.g. Firefox.app/Contents/MacOS/firefox,
  // Visual Studio Code.app/Contents/MacOS/Electron) — and avoids matching
  // unrelated CLI binaries with shared lowercase names.
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
    launched = (await pidsInBundle(bundlePath)).length > 0;
    if (launched) break;
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
  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

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
