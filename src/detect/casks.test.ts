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
import { parsePidsForExecutable, parseRunningApps, matchCaskToRunningApps } from "./casks.ts";
import { extractOutermostAppBundlePath } from "./bundles.ts";

test("extracts the outermost bundle from a nested helper", () => {
  expect(extractOutermostAppBundlePath(
    "/Applications/Orca.app/Contents/Frameworks/Orca Helper.app/Contents/MacOS/Orca Helper",
  )).toBe("/Applications/Orca.app");
});

test("main executable matching excludes helpers inside the same bundle", () => {
  const processList = `
    101 S  /Applications/Raycast.app/Contents/MacOS/Raycast
    102 Ss /Applications/Raycast.app/Contents/XPCServices/Raycast Accessibility.xpc/Contents/MacOS/com.raycast.macos.Accessibility
    103 S  /Applications/Raycast.app/Contents/MacOS/Raycast Helper
  `;

  expect(
    parsePidsForExecutable(
      processList,
      "/Applications/Raycast.app/Contents/MacOS/Raycast",
    ),
  ).toEqual([101]);
});

test("main executable matching preserves paths containing spaces", () => {
  const processList = `
    201 S  /Applications/Visual Studio Code.app/Contents/MacOS/Electron
    202 Ss /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper
  `;

  expect(
    parsePidsForExecutable(
      processList,
      "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
    ),
  ).toEqual([201]);
});

test("main executable matching excludes a terminating zombie", () => {
  const processList = `
    301 Z  <defunct>
  `;

  expect(
    parsePidsForExecutable(
      processList,
      "/Applications/Raycast.app/Contents/MacOS/Raycast",
    ),
  ).toEqual([]);
});

test("bundle fallback keeps alternate executables and excludes known helpers and zombies", () => {
  const processes = `
    401 S /Applications/Scripted.app/Contents/MacOS/real-ui
    402 S /Applications/Scripted.app/Contents/Frameworks/Scripted Helper.app/Contents/MacOS/Scripted Helper
    403 S /Applications/Scripted.app/Contents/XPCServices/Agent.xpc/Contents/MacOS/Agent
    404 Z /Applications/Scripted.app/Contents/MacOS/launcher
    405 S /Applications/Scripted.app/Contents/Resources/unknown-worker
  `;
  expect(parseRunningApps(processes, false)[0]?.pids).toEqual([401, 405]);
  expect(parseRunningApps(processes)[0]?.pids).toEqual([401, 402, 403, 405]);
});

test("same-name installs preserve both bundle identities", () => {
  const apps = ["/Applications/Example.app", "/Users/example/Applications/Example.app"].map((bundlePath, index) => ({
    name: "Example", bundleName: "Example.app", bundlePath, pids: [101 + index],
  }));
  expect(matchCaskToRunningApps(["Example.app"], apps)).toEqual(apps);
});
