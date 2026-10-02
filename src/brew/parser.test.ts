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
import {
  extractCaskNonQuitUpgradeDirectives,
  extractPkgAppNames,
} from "./parser.ts";

test("extractPkgAppNames finds direct /Applications bundles only", () => {
  expect(extractPkgAppNames([
    "/Applications/Karabiner-Elements.app",
    "/Applications/Karabiner-Elements.app/Contents/MacOS/Karabiner-Elements",
    "/Library/Application Support/org.pqrs/Karabiner-Elements/Karabiner-Menu.app",
  ])).toEqual(["Karabiner-Elements.app"]);
});

test("extractCaskNonQuitUpgradeDirectives excludes quit and ordinary upgrade signals", () => {
  expect(extractCaskNonQuitUpgradeDirectives({
    token: "cmux",
    version: "1.0",
    artifacts: [{
      uninstall: [{
        launchctl: "application.com.cmuxterm.cua.*",
        quit: "com.cmuxterm.app",
        signal: ["TERM", "com.cmuxterm.app"],
      }],
    }],
  })).toEqual(["launchctl"]);
});

test("extractCaskNonQuitUpgradeDirectives includes signals opted into upgrades", () => {
  expect(extractCaskNonQuitUpgradeDirectives({
    token: "example",
    version: "1.0",
    artifacts: [{
      uninstall: [{
        on_upgrade: ["signal"],
        signal: ["TERM", "com.example.app"],
        script: { executable: "uninstall.sh" },
      }],
    }],
  })).toEqual(["script", "signal"]);
});
