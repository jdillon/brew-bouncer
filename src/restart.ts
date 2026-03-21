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

  // Quit the app gracefully
  log.debug("Quitting app: {app}", { app: appName });
  const quit = Bun.spawn(
    ["osascript", "-e", `tell application "${appName}" to quit`],
    { stdout: "pipe", stderr: "pipe" }
  );
  await quit.exited;

  // Wait a moment for the app to fully quit
  await Bun.sleep(1500);

  // Reopen it
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

  return true;
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
