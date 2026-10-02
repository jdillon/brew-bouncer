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
import type { DetectedApp } from "./detect/matcher.ts";
import { planExecutionSafety } from "./upgrade-policy.ts";

const guiApp: DetectedApp = {
  packageName: "cmux",
  oldVersion: "1.0",
  newVersion: "2.0",
  kind: "cask-gui",
  displayName: "cmux.app",
  bundlePath: "/Applications/cmux.app",
  pids: [400],
};

test("protects a host cask from both Brew Bouncer and Homebrew lifecycle actions", () => {
  expect(planExecutionSafety(
    { type: "cask" },
    guiApp,
    { status: "known" },
    { membership: "host", evidence: ["bundle"] },
  )).toEqual({
    protected: true,
    suppressHomebrewQuit: true,
    allowAutomaticLifecycle: false,
    manualRestartAfterExit: true,
  });
});

test("protects an app when host membership is unknown", () => {
  expect(planExecutionSafety(
    { type: "cask" },
    guiApp,
    { status: "unknown" },
    { membership: "unknown", evidence: ["ps failed"] },
  ).allowAutomaticLifecycle).toBe(false);
});

test("preserves automatic lifecycle behavior for an unrelated app", () => {
  expect(planExecutionSafety(
    { type: "cask" },
    guiApp,
    { status: "known" },
    { membership: "not-host", evidence: [] },
  )).toEqual({
    protected: false,
    suppressHomebrewQuit: false,
    allowAutomaticLifecycle: true,
    manualRestartAfterExit: false,
  });
});

test("uses --no-quit for casks when the whole execution context is unknown", () => {
  expect(planExecutionSafety(
    { type: "cask" },
    undefined,
    { status: "unknown" },
  )).toEqual({
    protected: true,
    suppressHomebrewQuit: true,
    allowAutomaticLifecycle: false,
    manualRestartAfterExit: false,
  });
});

test("represents a formula CLI host as manual restart only without --no-quit", () => {
  const cliApp: DetectedApp = {
    ...guiApp,
    packageName: "tmux",
    kind: "formula-cli",
    displayName: "tmux",
    bundlePath: undefined,
    executablePaths: ["/opt/homebrew/bin/tmux"],
  };
  expect(planExecutionSafety(
    { type: "formula" },
    cliApp,
    { status: "known" },
    { membership: "host", evidence: ["executable"] },
  )).toEqual({
    protected: true,
    suppressHomebrewQuit: false,
    allowAutomaticLifecycle: false,
    manualRestartAfterExit: true,
  });
});
