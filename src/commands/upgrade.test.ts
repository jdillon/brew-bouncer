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
import { expect, mock, spyOn, test } from "bun:test";
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
    brewInstalled: mock(async () => ({ ...success, stdout: JSON.stringify({ formulae: [], casks: [] }) })),
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

test("an app closed at upgrade confirmation stays closed despite the preview restart policy", async () => {
  const { dependencies: d, setRunning } = fixture();
  d.confirmUpgrade.mockImplementation(async () => { setRunning([]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).toHaveBeenCalledWith(1, "yes");
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

test("an app launched after an empty preview is not restarted without restart approval", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  d.confirmUpgrade.mockImplementation(async () => { setRunning([app]); return "yes"; });
  await upgrade(interactive, d);
  expect(d.confirmRestartPolicy).not.toHaveBeenCalled();
  expect(d.brewUpgrade).toHaveBeenCalledTimes(1);
  expect(d.doQuit).not.toHaveBeenCalled();
  expect(d.doReopen).not.toHaveBeenCalled();
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
  expect(d.brewUpgrade).toHaveBeenCalledWith("example", { noQuit: true });
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
  expect(d.confirmRestartPolicy).toHaveBeenCalledWith(1, "yes");
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

test("proceeding shows one package preview and defers rechecking until the package upgrade", async () => {
  const { dependencies: d } = fixture();
  const output = spyOn(console, "log").mockImplementation(() => {});
  d.confirmRestartPolicy.mockImplementation(async () => {
    // Nothing rescans the full target list between the preview and policy prompt.
    expect(d.detectRunningUpgrades).toHaveBeenCalledTimes(1);
    return "yes";
  });
  d.brewUpgrade.mockImplementation(async () => {
    expect(d.detectRunningUpgrades).toHaveBeenCalledTimes(2);
    return success;
  });
  try {
    await upgrade(interactive, d);
    const messages = output.mock.calls.map(([message]) => String(message));
    expect(messages.filter((message) => message.includes("restart needed"))).toHaveLength(1);
    expect(messages.some((message) => message.includes("Current running status"))).toBe(false);
    expect(d.doQuit).toHaveBeenCalledTimes(1);
    expect(d.doReopen).toHaveBeenCalledTimes(1);
  } finally {
    output.mockRestore();
  }
});

function formulaOutdated(names: string[]) {
  return { ...success, stdout: JSON.stringify({ casks: [], formulae: names.map((name) => ({
    name, installed_versions: ["1"], current_version: "2",
  })) }) };
}
function installed(versions: Record<string, string>) {
  return { ...success, stdout: JSON.stringify({ casks: [], formulae: Object.entries(versions).map(([name, version]) => ({
    name, installed: [{ version }],
  })) }) };
}
async function captureRun(operation: () => Promise<{ exitCode: number }>) {
  const output = spyOn(console, "log").mockImplementation(() => {});
  const errors = spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await operation();
    return { result, output: [...output.mock.calls, ...errors.mock.calls].map((args) => args.join(" ")).join("\n") };
  } finally { output.mockRestore(); errors.mockRestore(); }
}

test("seven dependency-updated targets avoid brew calls but retain watchman restart and quarantine accounting", async () => {
  const { dependencies: d, setRunning } = fixture();
  const dependencies = ["folly", "fizz", "wangle", "fbthrift", "fb303", "edencommon", "watchman"];
  const names = ["ca-certificates", ...dependencies];
  let changed = false;
  d.brewOutdated.mockImplementation(async () => formulaOutdated(changed ? [] : names));
  d.brewInstalled.mockImplementation(async () => installed(Object.fromEntries(names.map((n) => [n, changed ? "2" : "1"]))));
  setRunning([{ ...app, packageName: "watchman", displayName: "watchman", kind: "formula-cli", bundlePath: undefined }]);
  d.brewUpgrade.mockImplementation(async () => { changed = true; return success; });
  const checked: string[] = [];
  const removed: string[] = [];
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, {
    ...d,
    enumeratePackageExecutables: async (packages) => new Map(packages.map((p) => [p.name, [`/fixture/bin/${p.name}`]])),
    isQuarantined: async (path) => { checked.push(path); return path.endsWith("watchman"); },
    doUnquarantine: async (path) => { removed.push(path); return true; },
  }));
  expect(run.result.exitCode).toBe(0);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["ca-certificates"]);
  expect(d.doRestart).not.toHaveBeenCalled();
  expect(checked).toHaveLength(8);
  expect(removed).toEqual(["/fixture/bin/watchman"]);
  expect(run.output).toContain("8 observed package version changes");
  expect(run.output).toContain("7 targets updated by earlier operations");
  expect(run.output).toContain("Updated by earlier operations: folly, fizz, wangle, fbthrift, fb303, edencommon, watchman");
  expect(run.output).toContain("Manual restart/check required: watchman");
  expect(run.output).toContain("8 paths checked for quarantine");
  expect(run.output).toContain("1 unquarantined");
});

test("partial failure observes dependencies and new installs, recovers, then continues explicit requests", async () => {
  const { dependencies: d, setRunning } = fixture();
  let stage = 0;
  d.brewOutdated.mockImplementation(async () => formulaOutdated(stage === 0 ? ["netbird-ui", "watchman", "uv"] : ["netbird-ui", "uv"]));
  d.brewInstalled.mockImplementation(async () => installed(stage === 0
    ? { "netbird-ui": "1", watchman: "1", uv: "1" }
    : { "netbird-ui": "1", watchman: "2", uv: stage === 2 ? "2" : "1", "python@3.13": "3.13.9" }));
  setRunning(["netbird-ui", "watchman", "uv"].map((name) => ({ ...app, packageName: name,
    displayName: name, kind: "formula-cli" as const, bundlePath: undefined })));
  d.brewUpgrade.mockImplementation(async (name) => {
    stage++;
    return name === "netbird-ui" ? { ...success, exitCode: 1, stderr: "Error: chmod permission change failed\nAttempting rollback\n" } : success;
  });
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(1);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["netbird-ui", "uv"]);
  expect(d.detectRunningUpgrades.mock.calls.some(([packages]) => packages.some((p) => p.name === "python@3.13"))).toBe(true);
  expect(run.output).toContain("Failed upgrade: netbird-ui:");
  expect(run.output).toContain("installation/rollback outcome unverified");
  expect(run.output).toContain("Attempting rollback");
  expect(run.output).toContain("Additional dependency changes observed: python@3.13 (new → 3.13.9)");
  expect(run.output).toContain("Manual restart/check required: netbird-ui, watchman, uv");
});

test("spawn failure still performs post-detection and later upgrades, even when recovery reopen throws", async () => {
  const { dependencies: d } = fixture();
  d.brewOutdated.mockImplementation(async () => ({ ...success, stdout: JSON.stringify({ formulae: [], casks:
    ["example", "second"].map((name) => ({ name, installed_versions: ["1"], current_version: "2" })),
  }) }));
  d.brewUpgrade.mockImplementation(async (name) => { if (name === "example") throw new Error("spawn failed"); return success; });
  d.doReopen.mockImplementation(async () => { throw new Error("launch failed"); });
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(1);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["example", "second"]);
  expect(d.detectRunningUpgrades.mock.calls.filter(([packages]) => packages.some((p) => p.name === "example"))).toHaveLength(3);
  expect(run.output).toContain("spawn failed");
  expect(run.output).toContain("example: recovery reopen failed");
  expect(run.output).toContain("launch failed");
});

test("successful upgrade requests with reopen/quarantine failures produce named failures and nonzero result", async () => {
  const { dependencies: d } = fixture();
  d.doReopen.mockImplementation(async () => false);
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, {
    ...d, enumeratePackageExecutables: async () => new Map([["example", ["/fixture/Example.app"]]]),
    isQuarantined: async () => true, doUnquarantine: async () => false,
  }));
  expect(run.result.exitCode).toBe(1);
  expect(run.output).toContain("1 successful upgrade requests");
  expect(run.output).toContain("example: quarantine removal failed: /fixture/Example.app");
  expect(run.output).toContain("example: reopen failed");
  expect(run.output).toContain("Manual restart/check required: example");
});

test("unchanged receipts do not claim an upgrade, while successful request and actionable warning remain visible", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  d.brewUpgrade.mockImplementation(async () => ({ ...success,
    stdout: "==> Caveats\nThe opencode command is shadowed by:\n  /Users/fixture/.nvm/bin/opencode\n\n" }));
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(0);
  expect(run.output).toContain("1 successful upgrade requests");
  expect(run.output).toContain("0 observed package version changes");
  expect(run.output).toContain("1 with no version change observed");
  expect(run.output).toContain("/Users/fixture/.nvm/bin/opencode");
});

test("failed state refresh keeps later explicit requests and reports incomplete accounting", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  d.brewOutdated.mockImplementationOnce(async () => formulaOutdated(["first", "second"]));
  d.brewOutdated.mockImplementation(async () => ({ ...success, exitCode: 2 }));
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(1);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["first", "second"]);
  expect(run.output).toContain("Package change accounting is incomplete");
});

test("a transient installed snapshot failure still reconciles targets proven no longer outdated", async () => {
  const { dependencies: d, setRunning } = fixture();
  let changed = false;
  d.brewOutdated.mockImplementation(async () => formulaOutdated(changed ? [] : ["first", "watchman"]));
  d.brewInstalled.mockImplementation(async () => changed ? { ...success, exitCode: 1 } : installed({ first: "1", watchman: "1" }));
  setRunning([{ ...app, packageName: "watchman", kind: "formula-cli", displayName: "watchman" }]);
  d.brewUpgrade.mockImplementation(async () => { changed = true; return success; });
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(1);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["first"]);
  expect(run.output).toContain("Manual restart/check required: watchman");
  expect(run.output).toContain("Package change accounting is incomplete");
});

test("fresh per-target probe errors after a partial failure preserve the queue and manual guidance", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  let calls = 0;
  d.brewOutdated.mockImplementation(async () => formulaOutdated(["first", "second", "third"]));
  d.detectRunningUpgrades.mockImplementation(async (packages) => {
    if (packages.length === 1 && packages[0]?.name === "second") throw new Error("probe spawn failed");
    return packages.some((p) => p.name === "third") ? [{ ...app, packageName: "third", kind: "formula-cli", displayName: "third" }] : [];
  });
  d.inspectExecutionContext.mockImplementation(async () => { if (calls++ === 1) throw new Error("context failed"); return knownContext; });
  d.brewUpgrade.mockImplementation(async (name) => ({ ...success, exitCode: name === "first" ? 1 : 0 }));
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(1);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["first", "second", "third"]);
  expect(run.output).toContain("second: process detection failed");
  expect(run.output).toContain("execution context detection failed");
  expect(run.output).toContain("Manual restart/check required: second");
});

test("quarantine inspection exceptions are named lifecycle failures, not successful absent attributes", async () => {
  const { dependencies: d } = fixture();
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, {
    ...d, enumeratePackageExecutables: async () => new Map([["example", ["/fixture/Example.app"]]]),
    isQuarantined: async () => { throw new Error("Operation not permitted"); },
  }));
  expect(run.result.exitCode).toBe(1);
  expect(d.doReopen).toHaveBeenCalled();
  expect(run.output).toContain("example: quarantine check failed: /fixture/Example.app");
  expect(run.output).toContain("Operation not permitted");
});

test("post-attempt cask metadata supplies newly declared executables for quarantine checks", async () => {
  const { dependencies: d } = fixture();
  let upgraded = false;
  d.brewUpgrade.mockImplementation(async () => { upgraded = true; return success; });
  d.brewInfoJson.mockImplementation(async () => ({ ...success, stdout: JSON.stringify({ formulae: [], casks: [{
    token: "example", version: upgraded ? "2" : "1", artifacts: [{ binary: [upgraded ? "newtool" : "oldtool"] }],
  }] }) }));
  const paths: string[] = [];
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, {
    ...d,
    enumeratePackageExecutables: async (_packages, casks) => new Map([["example", casks.flatMap((c) => c.artifacts.flatMap((a) => (a.binary as string[] | undefined) ?? []))]]),
    isQuarantined: async (path) => { paths.push(path); return false; },
  }));
  expect(run.result.exitCode).toBe(0);
  expect(paths).toEqual(["oldtool", "newtool"]);
});

test("indirect changes outside the selected list are reported without lifecycle or quarantine writes", async () => {
  const { dependencies: d, setRunning } = fixture();
  let changed = false;
  d.brewOutdated.mockImplementation(async () => formulaOutdated(changed ? [] : ["first", "watchman"]));
  d.brewInstalled.mockImplementation(async () => installed({ first: changed ? "2" : "1", watchman: changed ? "2" : "1" }));
  d.brewUpgrade.mockImplementation(async () => { changed = true; return success; });
  setRunning([{ ...app, packageName: "watchman", kind: "formula-service", displayName: "watchman" }]);
  const paths: string[] = [];
  const run = await captureRun(() => upgrade({ yes: true, verbose: false, only: ["first"] }, {
    ...d, enumeratePackageExecutables: async (packages) => new Map(packages.map((p) => [p.name, [`/fixture/${p.name}`]])),
    isQuarantined: async () => true, doUnquarantine: async (path) => { paths.push(path); return true; },
  }));
  expect(run.result.exitCode).toBe(0);
  expect(d.brewUpgrade.mock.calls.map(([name]) => name)).toEqual(["first"]);
  expect(d.doRestart).not.toHaveBeenCalled();
  expect(paths).toEqual(["/fixture/first"]);
  expect(run.output).toContain("Additional dependency changes observed: watchman (1 → 2)");
  expect(run.output).toContain("Manual restart/check required: watchman");
});

test("newly discovered executable paths are processed under --yes even with an empty preview", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  let upgraded = false;
  d.brewUpgrade.mockImplementation(async () => { upgraded = true; return success; });
  const removed: string[] = [];
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, {
    ...d, enumeratePackageExecutables: async () => upgraded ? new Map([["example", ["/fixture/newtool"]]]) : new Map(),
    isQuarantined: async () => true, doUnquarantine: async (path) => { removed.push(path); return true; },
  }));
  expect(run.result.exitCode).toBe(0);
  expect(removed).toEqual(["/fixture/newtool"]);
  expect(run.output).toContain("1 paths checked for quarantine");
  expect(run.output).toContain("1 unquarantined");
});

test("a headless target needs no execution-context probes after preview", async () => {
  const { dependencies: d, setRunning } = fixture();
  setRunning([]);
  d.inspectExecutionContext.mockImplementationOnce(async () => knownContext);
  d.inspectExecutionContext.mockImplementation(async () => { throw new Error("irrelevant context probe"); });
  const run = await captureRun(() => upgrade({ yes: true, verbose: false }, d));
  expect(run.result.exitCode).toBe(0);
  expect(d.inspectExecutionContext).toHaveBeenCalledTimes(1);
  expect(run.output).not.toContain("Manual restart/check required");
});
