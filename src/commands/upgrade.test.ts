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
import { expect, mock, test } from "bun:test";
import { upgrade } from "./upgrade.ts";
import type { DetectedApp } from "../detect/matcher.ts";
import type { ExecutionContext } from "../detect/execution-context.ts";

const app: DetectedApp = {
  packageName: "example", oldVersion: "1", newVersion: "2",
  kind: "cask-gui", displayName: "Example.app",
  bundlePath: "/Applications/Example.app", pids: [101],
};
const knownContext: ExecutionContext = {
  status: "known", rootPid: 999, frames: [], guiHosts: [],
  hints: { tmux: false }, issues: [],
};
const success = { stdout: "", stderr: "", exitCode: 0 };

function fixture() {
  let running: DetectedApp[] = [app];
  const dependencies = {
    loadConfig: async () => ({ ignore: [], promptDefaults: {
      upgrade: "yes" as const, restartPolicy: "yes" as const,
      quarantinePolicy: "no" as const,
    } }),
    brewUpdate: mock(async () => success),
    brewOutdated: mock(async () => ({ ...success, stdout: JSON.stringify({
      formulae: [], casks: [{ name: "example", installed_versions: ["1"], current_version: "2" }],
    }) })),
    brewInfoJson: mock(async () => ({ ...success, stdout: JSON.stringify({ formulae: [], casks: [] }) })),
    brewUpgrade: mock(async (_name: string, _options?: { noQuit?: boolean }) => success),
    detectRunningUpgrades: mock(async (packages: Array<{ name: string }>) =>
      running.filter((app) => packages.some((pkg) => pkg.name === app.packageName))),
    inspectExecutionContext: mock(async () => knownContext),
    enumeratePackageExecutables: async () => new Map<string, string[]>(),
    confirmUpgrade: mock(async () => "yes" as const),
    confirmRestartPolicy: mock(async () => "yes" as "yes" | "ask" | "no"),
    confirmRestart: mock(async () => "yes" as const),
    doQuit: mock(async () => "stopped" as "stopped" | "already-stopped" | "unknown"),
    doReopen: mock(async () => true),
    doRestart: mock(async () => true),
  };
  return { dependencies, setRunning: (apps: DetectedApp[]) => { running = apps; } };
}
const interactive = { yes: false, verbose: false };

test("an app closed at upgrade confirmation stays closed and does not affect restart policy", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmUpgrade.mockImplementation(async () => { setRunning([]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).not.toHaveBeenCalled();
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
  expect(d.brewUpgrade).toHaveBeenCalledWith("example", { noQuit: false });
});

test("an app closed during restart policy confirmation stays closed", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmRestartPolicy.mockImplementation(async () => { setRunning([]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
});

test("an app closed at its individual restart prompt stays closed", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmRestartPolicy.mockImplementation(async () => "ask");
  d.confirmRestart.mockImplementation(async () => { setRunning([]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.confirmRestart).toHaveBeenCalledTimes(1);
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
});

test("an app closed between the last detection and quit is upgraded without reopening", async () => {
  const { dependencies: d } = fixture();
  d.doQuit.mockImplementation(async () => "already-stopped");
  await upgrade({ yes: true, verbose: false }, d);
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
  expect(d.doReopen).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
});

test("failed upgrades do not reopen an app that was already closed", async () => {
  const { dependencies: d } = fixture();
  d.doQuit.mockImplementation(async () => "already-stopped");
  d.brewUpgrade.mockImplementation(async () => ({ ...success, exitCode: 1 }));
  await upgrade({ yes: true, verbose: false }, d);
  expect(d.doReopen).not.toHaveBeenCalled();
});

test("a still-running app is stopped before upgrade and reopened afterwards", async () => {
  const { dependencies: d } = fixture();
  const order: string[] = [];
  d.doQuit.mockImplementation(async () => { order.push("quit"); return "stopped"; });
  d.brewUpgrade.mockImplementation(async () => { order.push("upgrade"); return success; });
  d.doReopen.mockImplementation(async () => { order.push("reopen"); return true; });
  await upgrade(interactive, d);
  expect(order).toEqual(["quit", "upgrade", "reopen"]);
});

test("failure recovery reopens an app Brew Bouncer actually stopped", async () => {
  const { dependencies: d } = fixture();
  d.brewUpgrade.mockImplementation(async () => ({ ...success, exitCode: 1 }));
  await upgrade(interactive, d);
  expect(d.doQuit).toHaveBeenCalledTimes(1);
  expect(d.doReopen).toHaveBeenCalledWith(app, true);
});

test("an unverified running state skips upgrade without launching an app", async () => {
  const { dependencies: d } = fixture();
  d.doQuit.mockImplementation(async () => "unknown");
  await upgrade(interactive, d);
  expect(d.brewUpgrade).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
});

test("an app launched during confirmation is included in the refreshed restart policy", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  d.confirmUpgrade.mockImplementation(async () => { setRunning([app]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).toHaveBeenCalledWith(1, "yes");
  expect(d.doQuit).toHaveBeenCalledTimes(1);
  expect(d.doReopen).toHaveBeenCalledTimes(1);
});

test("a protected host stays selected and upgrades with --no-quit and no automatic restart", async () => {
  const { dependencies: d } = fixture();
  d.inspectExecutionContext.mockImplementation(async () => ({ ...knownContext, frames: [{
    pid: 101, ppid: 1, state: "S", executable: `${app.bundlePath}/Contents/MacOS/Example`,
    source: "direct", role: "gui-host", bundlePath: app.bundlePath,
  }] }));
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).not.toHaveBeenCalled();
  expect(d.brewUpgrade).toHaveBeenCalledWith("example", { noQuit: true });
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
});

test("a service stopped during upgrade is not started by the restart step", async () => {
  const { dependencies: d, setRunning } = fixture();
  const service: DetectedApp = { ...app, kind: "formula-service", bundlePath: undefined, pids: [] };
  setRunning([service]);
  d.brewOutdated.mockImplementation(async () => ({ ...success, stdout: JSON.stringify({
    casks: [], formulae: [{ name: "example", installed_versions: ["1"], current_version: "2" }],
  }) }));
  d.brewUpgrade.mockImplementation(async () => { setRunning([]); return success; });
  await upgrade(interactive, d);
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
  expect(d.doRestart).not.toHaveBeenCalled();
});

test("a still-running service can restart after upgrade", async () => {
  const { dependencies: d, setRunning } = fixture();
  const service: DetectedApp = { ...app, kind: "formula-service", bundlePath: undefined, pids: [] };
  setRunning([service]);
  d.brewOutdated.mockImplementation(async () => ({ ...success, stdout: JSON.stringify({
    casks: [], formulae: [{ name: "example", installed_versions: ["1"], current_version: "2" }],
  }) }));
  await upgrade(interactive, d);
  expect(d.doRestart).toHaveBeenCalledWith(service);
  expect(d.doQuit).not.toHaveBeenCalled();
});

test("a different GUI bundle appearing during a prompt is not quit under the old approval", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmRestartPolicy.mockImplementation(async () => "ask");
  d.confirmRestart.mockImplementation(async () => {
    setRunning([{ ...app, bundlePath: "/Users/example/Applications/Example.app", pids: [202] }]);
    return "yes";
  });
  await upgrade(interactive, d);
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
});

test("a thrown Homebrew error restores only the GUI Brew Bouncer stopped", async () => {
  const { dependencies: d } = fixture();
  d.brewUpgrade.mockImplementation(async () => { throw new Error("spawn failed"); });
  await upgrade(interactive, d);
  expect(d.doReopen).toHaveBeenCalledWith(app, true);
});

test("a closed GUI with a running CLI artifact upgrades without automatic lifecycle actions", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmUpgrade.mockImplementation(async () => {
    setRunning([{ ...app, kind: "cask-cli", displayName: "example-cli", pids: [202],
      executablePaths: ["/opt/homebrew/bin/example-cli"] }]);
    return "yes";
  });
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).not.toHaveBeenCalled();
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doRestart).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
});

test("each package is refreshed after earlier upgrades, including a partial failure", async () => {
  const { dependencies: d, setRunning } = fixture();
  const second: DetectedApp = { ...app, packageName: "second", displayName: "Second.app",
    bundlePath: "/Applications/Second.app", pids: [202] };
  setRunning([app, second]);
  d.brewOutdated.mockImplementation(async () => ({ ...success, stdout: JSON.stringify({
    formulae: [], casks: ["example", "second"].map((name) => ({
      name, installed_versions: ["1"], current_version: "2",
    })),
  }) }));
  d.brewUpgrade.mockImplementation(async (name) => {
    if (name === "example") {
      setRunning([]); // Jason closes the second app while the first upgrade runs.
      return { ...success, exitCode: 1 };
    }
    return success;
  });
  await upgrade(interactive, d);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["example", "second"]);
  expect(d.doQuit).toHaveBeenCalledTimes(1);
  expect(d.doQuit).toHaveBeenCalledWith(app);
  expect(d.doReopen).toHaveBeenCalledTimes(1);
  expect(d.doReopen).toHaveBeenCalledWith(app, true);
});
