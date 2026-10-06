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
import { expect, test } from "bun:test";
import { detectRunningUpgrades } from "./matcher.ts";
import { assessExecutionTarget, type ExecutionContext } from "./execution-context.ts";
import type { RunningProcess } from "./formulae.ts";

const bundlePath = "/Applications/Example.app";
const pkg = { name: "example", type: "cask" as const, installedVersions: ["1"], currentVersion: "2" };
const success = { stdout: "", stderr: "", exitCode: 0 };

function fixture(processes: RunningProcess[], appPids: number[]) {
  return {
    getRunningApps: async () => [{ name: "Example", bundleName: "Example.app", bundlePath, pids: [101] }],
    getRunningProcesses: async () => processes,
    brewServicesList: async () => success,
    brewInfoJson: async () => ({ ...success, stdout: JSON.stringify({ formulae: [], casks: [{
      token: "example", artifacts: [{ app: ["Example.app"] }, { binary: ["bin/example-cli"] }],
    }] }) }),
    createGuiProcessScanner: async () => ({ mode: "bundle" as const, scan: async () => appPids }),
  };
}

test("closed GUI still matches its running CLI artifact", async () => {
  const command = "/opt/homebrew/bin/example-cli";
  const apps = await detectRunningUpgrades([pkg], undefined, fixture([
    { pid: 202, command, path: command, name: "example-cli" },
  ], []));
  expect(apps[0]?.kind).toBe("cask-cli");
  expect(apps[0]?.pids).toEqual([202]);
  expect(apps[0]?.executablePaths).toContain(command);
});

test("helper-only bundle retains execution-context protection without GUI lifecycle actions", async () => {
  const command = `${bundlePath}/Contents/XPCServices/Agent.xpc/Contents/MacOS/Agent`;
  const apps = await detectRunningUpgrades([pkg], undefined, fixture([
    { pid: 101, command, path: command, name: "Agent" },
  ], []));
  expect(apps[0]?.kind).toBe("cask-cli");
  const context: ExecutionContext = {
    status: "known", rootPid: 999, hints: { tmux: false }, issues: [], guiHosts: [],
    frames: [{ pid: 101, ppid: 1, state: "S", executable: command, bundlePath, role: "gui-host", source: "direct" }],
  };
  expect(assessExecutionTarget(apps[0]!, context).membership).toBe("host");
});

test("live alternate app executable remains a GUI target", async () => {
  const apps = await detectRunningUpgrades([pkg], undefined, fixture([], [303]));
  expect(apps[0]?.kind).toBe("cask-gui");
  expect(apps[0]?.pids).toEqual([303]);
});

test("a closed first same-name bundle does not hide a live second install", async () => {
  const d = fixture([], []);
  const secondPath = "/Users/example/Applications/Example.app";
  d.getRunningApps = async () => [bundlePath, secondPath].map((path, index) => ({
    name: "Example", bundleName: "Example.app", bundlePath: path, pids: [101 + index],
  }));
  const apps = await detectRunningUpgrades([pkg], undefined, {
    ...d,
    createGuiProcessScanner: async (_pids, path) => ({ mode: "bundle", scan: async () => path === secondPath ? [102] : [] }),
  });
  expect(apps[0]?.kind).toBe("cask-gui");
  expect(apps[0]?.bundlePath).toBe(secondPath);
});
