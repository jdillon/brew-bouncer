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
import { collectUpgradeDiagnostics, groupDiagnostics, normalizeTerminalOutput } from "./diagnostics.ts";

test("diagnostics preserve multiline permission/rollback and command-shadowing context", () => {
  const output = "progress 1%\rprogress 100%\r\n\x1b[31mError: chmod failed\x1b[0m\r\n  /Applications/Fixture.app/installer.sh: Operation not permitted\r\nAttempting rollback\r\n\r\n==> Caveats\r\nThe opencode command is shadowed by:\r\n  /Users/fixture/.nvm/bin/opencode\r\n\r\n==> Summary\r\nInstalled successfully\r\n";
  expect(collectUpgradeDiagnostics("fixture", output, "")).toEqual([
    { packageName: "fixture", level: "error", message: "Error: chmod failed\n  /Applications/Fixture.app/installer.sh: Operation not permitted\nAttempting rollback" },
    { packageName: "fixture", level: "warning", message: "The opencode command is shadowed by:\n  /Users/fixture/.nvm/bin/opencode" },
  ]);
  expect(normalizeTerminalOutput("one\rtwo\r\n")).toBe("two\n");
});

test("diagnostics deduplicate warnings and ignore ordinary caveats and already-installed notices", () => {
  expect(collectUpgradeDiagnostics("fixture", "==> Caveats\nRun fixture to get started\nWarning: fixture 2 already installed\n", "")).toEqual([]);
  expect(collectUpgradeDiagnostics("fixture", "Warning: act now\n  details\n", "Warning: act now\n  details\n")).toHaveLength(1);
});

test("shadow caveats include base verb and tightly preceding conflicting path", () => {
  expect(collectUpgradeDiagnostics("opencode", "The executable at /Users/fixture/.nvm/bin/opencode will shadow Homebrew's opencode.\n", "")[0]?.message).toContain("/Users/fixture/.nvm/bin/opencode");
  expect(collectUpgradeDiagnostics("opencode", "/Users/fixture/.nvm/bin/opencode\nThis command takes precedence in PATH.\n", "")[0]?.message).toContain("/Users/fixture/.nvm/bin/opencode");
  expect(collectUpgradeDiagnostics("fixture", "==> Caveats\nEnabled shadow rendering support\n", "")).toEqual([]);
});

test("grouping merges repeated messages with a count and assigns tiers", () => {
  const groups = groupDiagnostics([
    { packageName: "a", level: "warning", message: "Warning: shared" },
    { packageName: "b", level: "warning", message: "Warning: shared" },
    { packageName: "b", level: "warning", message: "Warning: shared" },
    { packageName: "a", level: "warning", message: "Warning: only a" },
    { packageName: "a", level: "error", message: "Error: failed" },
    { packageName: "a", level: "warning", message: "Warning: Calling depends_on :macos is deprecated!" },
    { packageName: "a", level: "warning", tier: "important", message: "Bouncer note" },
    { packageName: "b", level: "warning", tier: "important", message: "Bouncer note" },
    { packageName: "a", level: "warning", tier: "action", message: "Re-grant" },
  ]);
  expect(groups.map(({ tier, message, packages, count }) => [tier, message, packages.join(","), count])).toEqual([
    ["action", "Error: failed", "a", 1],
    ["action", "Re-grant", "a", 1],
    ["important", "Warning: only a", "a", 1],
    ["important", "Bouncer note", "a,b", 2],
    ["noise", "Warning: shared", "a,b", 3],
    ["noise", "Warning: Calling depends_on :macos is deprecated!", "a", 1],
  ]);
});
