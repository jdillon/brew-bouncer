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
import { installedChanges, parseInstalled } from "./state.ts";

test("installed observations separate new dependencies, version changes, removals and formula/cask identities", () => {
  const before = parseInstalled(JSON.stringify({ formulae: [
    { name: "same", installed: [{ version: "1" }, { version: "0.9" }] },
    { name: "gone", installed: [{ version: "1" }] },
  ], casks: [{ token: "same", installed: "3" }] }));
  const after = parseInstalled(JSON.stringify({ formulae: [
    { name: "same", installed: [{ version: "2" }] },
    { name: "python@3.13", installed: [{ version: "3.13.9" }] },
  ], casks: [{ token: "same", installed: ["3"] }] }));
  expect(installedChanges(before, after).map((p) => [p.name, p.installedVersions, p.currentVersion])).toEqual([
    ["same", ["0.9", "1"], "2"], ["python@3.13", [], "3.13.9"], ["gone", ["1"], "removed"],
  ]);
  expect(installedChanges(before, before)).toEqual([]);
});
