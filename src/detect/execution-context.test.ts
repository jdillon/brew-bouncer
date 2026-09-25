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
import type { DetectedApp } from "./matcher.ts";
import {
  assessExecutionTarget,
  inspectExecutionContext,
  parseProcessIdentities,
  type ProcessIdentity,
} from "./execution-context.ts";

function proc(
  pid: number,
  ppid: number,
  executable: string,
  state = "S",
): ProcessIdentity {
  return { pid, ppid, state, executable };
}

function guiApp(
  bundlePath: string,
  pids: number[],
): DetectedApp {
  return {
    packageName: bundlePath.split("/").pop()!.replace(/\.app$/, "").toLowerCase(),
    oldVersion: "1.0",
    newVersion: "2.0",
    kind: "cask-gui",
    displayName: bundlePath.split("/").pop()!,
    bundlePath,
    pids,
  };
}

const launchd = proc(1, 0, "/sbin/launchd");

test("detects a direct terminal application from current ancestry", async () => {
  const processes = [
    proc(100, 200, "/opt/homebrew/bin/bun"),
    proc(200, 300, "/bin/zsh"),
    proc(300, 400, "/usr/bin/login"),
    proc(400, 1, "/Applications/cmux.app/Contents/MacOS/cmux"),
    launchd,
  ];
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: { TERM_PROGRAM: "cmux" },
    readProcesses: async () => processes,
  });

  expect(context.status).toBe("known");
  expect(context.frames.map((frame) => frame.role)).toEqual([
    "runtime",
    "wrapper",
    "wrapper",
    "gui-host",
    "wrapper",
  ]);
  expect(assessExecutionTarget(guiApp("/Applications/cmux.app", [400]), context).membership)
    .toBe("host");
});

test("attributes a nested helper to its outer application bundle", async () => {
  const processes = [
    proc(100, 200, "/opt/homebrew/bin/codex"),
    proc(200, 300, "/bin/zsh"),
    proc(300, 400, "/usr/bin/login"),
    proc(
      400,
      1,
      "/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper",
    ),
    launchd,
  ];
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: { TERM_PROGRAM: "Orca" },
    readProcesses: async () => processes,
  });

  expect(context.guiHosts.map((host) => host.bundlePath))
    .toEqual(["/Applications/Orca.app"]);
  expect(assessExecutionTarget(guiApp("/Applications/Orca.app", [400]), context).membership)
    .toBe("host");
});

test("bridges through every attached client of the current tmux session", async () => {
  const processes = [
    proc(100, 500, "/opt/homebrew/bin/bun"),
    proc(500, 1, "/opt/homebrew/bin/tmux"),
    proc(600, 700, "/opt/homebrew/bin/tmux"),
    proc(700, 710, "/opt/homebrew/bin/codex"),
    proc(710, 720, "/bin/zsh"),
    proc(720, 730, "/usr/bin/login"),
    proc(
      730,
      1,
      "/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper",
    ),
    proc(800, 810, "/opt/homebrew/bin/tmux"),
    proc(810, 820, "/bin/zsh"),
    proc(820, 830, "/usr/bin/login"),
    proc(830, 1, "/Applications/Ghostty.app/Contents/MacOS/ghostty"),
    launchd,
  ];
  const readProcesses = mock(async () => processes);
  const readTmuxClientPids = mock(async () => [600, 800]);
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: { TMUX: "/tmp/tmux/default,500,0", TMUX_PANE: "%7" },
    readProcesses,
    readTmuxClientPids,
  });

  expect(readProcesses).toHaveBeenCalledTimes(2);
  expect(readTmuxClientPids).toHaveBeenCalledWith("%7", "/opt/homebrew/bin/tmux");
  expect(context.status).toBe("known");
  expect(context.guiHosts.map((host) => host.bundlePath).sort()).toEqual([
    "/Applications/Ghostty.app",
    "/Applications/Orca.app",
  ]);
  expect(assessExecutionTarget(guiApp("/Applications/Orca.app", [730]), context).membership)
    .toBe("host");
  expect(assessExecutionTarget(guiApp("/Applications/Ghostty.app", [830]), context).membership)
    .toBe("host");
});

test("treats a detached tmux session with no clients as unknown", async () => {
  const processes = [
    proc(100, 500, "/opt/homebrew/bin/bun"),
    proc(500, 1, "/opt/homebrew/bin/tmux"),
    launchd,
  ];
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: { TMUX: "/tmp/tmux/default,500,0", TMUX_PANE: "%7" },
    readProcesses: async () => processes,
    readTmuxClientPids: async () => [],
  });

  expect(context.status).toBe("unknown");
  expect(context.issues).toContain("the current tmux session has no attached clients");
  expect(assessExecutionTarget(guiApp("/Applications/Ghostty.app", [900]), context).membership)
    .toBe("unknown");
});

test("does not classify an unrelated application as an execution host", async () => {
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: { TERM_PROGRAM: "Ghostty" },
    readProcesses: async () => [
      proc(100, 400, "/opt/homebrew/bin/bun"),
      proc(400, 1, "/Applications/cmux.app/Contents/MacOS/cmux"),
      launchd,
    ],
  });

  expect(assessExecutionTarget(guiApp("/Applications/Ghostty.app", [900]), context).membership)
    .toBe("not-host");
});

test("does not trust a stale matching PID when the bundle identity changed", async () => {
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: {},
    readProcesses: async () => [
      proc(100, 400, "/opt/homebrew/bin/bun"),
      proc(400, 1, "/Applications/cmux.app/Contents/MacOS/cmux"),
      launchd,
    ],
  });

  const assessment = assessExecutionTarget(
    guiApp("/Applications/Ghostty.app", [400]),
    context,
  );
  expect(assessment.membership).toBe("unknown");
  expect(assessment.evidence[0]).toContain("could not be revalidated");
});

test("fails conservatively when process inspection fails", async () => {
  const context = await inspectExecutionContext({
    currentPid: 100,
    environment: {},
    readProcesses: async () => {
      throw new Error("ps unavailable");
    },
  });

  expect(context.status).toBe("unknown");
  expect(assessExecutionTarget(guiApp("/Applications/cmux.app", [400]), context).membership)
    .toBe("unknown");
});

test("parses process identities with executable paths containing spaces and excludes zombies", () => {
  expect(parseProcessIdentities(`
    101 1 S  /Applications/Visual Studio Code.app/Contents/MacOS/Electron
    102 1 Z  /Applications/Old.app/Contents/MacOS/Old
  `)).toEqual([{
    pid: 101,
    ppid: 1,
    state: "S",
    executable: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  }]);
});
