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
  const quitDeadline = Date.now() + 10_000;
  let livePids = detectedPids;
  while (Date.now() < quitDeadline) {
    livePids = filterLivePids(livePids);
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

  // Verify the app actually launched (poll up to 5s).
  // Case-sensitive exact match — avoids matching CLI binaries with shared
  // lowercase names (Claude.app vs `claude`).
  const launchDeadline = Date.now() + 5_000;
  let launched = false;
  while (Date.now() < launchDeadline) {
    await Bun.sleep(500);
    launched = await isAppRunning(appName);
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
    } catch {
      return false;
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

  const proc = Bun.spawn(["ps", "-o", "pid=,comm=", "-p", ...pids.map(String)], {
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

async function isAppRunning(appName: string): Promise<boolean> {
  const proc = Bun.spawn(["pgrep", "-x", appName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await proc.exited;
  return exitCode === 0;
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
