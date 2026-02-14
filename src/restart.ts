import type { DetectedApp } from "./detect/matcher.ts";
import { exec } from "./brew/runner.ts";
import { log } from "./logger.ts";

export async function restartApp(app: DetectedApp): Promise<boolean> {
  switch (app.kind) {
    case "cask-gui":
      return restartGuiApp(app);
    case "formula-service":
      return restartService(app);
    case "formula-cli":
      return restartCliProcess(app);
  }
}

async function restartGuiApp(app: DetectedApp): Promise<boolean> {
  const appName = app.displayName.replace(/\.app$/, "");

  // Quit the app gracefully
  log.debug({ app: appName }, "Quitting app");
  const quit = Bun.spawn(
    ["osascript", "-e", `tell application "${appName}" to quit`],
    { stdout: "pipe", stderr: "pipe" }
  );
  await quit.exited;

  // Wait a moment for the app to fully quit
  await Bun.sleep(1500);

  // Reopen it
  log.debug({ app: appName }, "Reopening app");
  const open = Bun.spawn(["open", "-a", appName], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const exitCode = await open.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(open.stderr).text();
    log.error({ app: appName, stderr }, "Failed to reopen app");
    return false;
  }

  return true;
}

async function restartService(app: DetectedApp): Promise<boolean> {
  log.debug({ service: app.packageName }, "Restarting brew service");
  const result = await exec(["services", "restart", app.packageName]);

  if (result.exitCode !== 0) {
    log.error(
      { service: app.packageName, stderr: result.stderr },
      "Failed to restart service"
    );
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
