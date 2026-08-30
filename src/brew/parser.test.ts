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
import { extractPkgAppNames } from "./parser.ts";

test("extractPkgAppNames finds direct /Applications bundles only", () => {
  expect(extractPkgAppNames([
    "/Applications/Karabiner-Elements.app",
    "/Applications/Karabiner-Elements.app/Contents/MacOS/Karabiner-Elements",
    "/Library/Application Support/org.pqrs/Karabiner-Elements/Karabiner-Menu.app",
  ])).toEqual(["Karabiner-Elements.app"]);
});
