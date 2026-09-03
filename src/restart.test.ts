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
import { createGuiProcessScanner } from "./restart.ts";

test("tracks a conventional app by its observed main executable", async () => {
  const resolveMainExecutable = mock(async () =>
    "/Applications/Raycast.app/Contents/MacOS/Raycast"
  );
  const scanExecutable = mock(async () => [101]);
  const scanBundle = mock(async () => [101, 102]);

  const scanner = await createGuiProcessScanner(
    [101, 102],
    "/Applications/Raycast.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("main");
  expect(await scanner.scan()).toEqual([101]);
  expect(scanBundle).not.toHaveBeenCalled();
});

test("falls back to the bundle when the main executable cannot be resolved", async () => {
  const resolveMainExecutable = mock(async () => undefined);
  const scanExecutable = mock(async () => []);
  const scanBundle = mock(async () => [201]);

  const scanner = await createGuiProcessScanner(
    [201],
    "/Applications/Netbird UI.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("bundle");
  expect(await scanner.scan()).toEqual([201]);
  expect(scanExecutable).not.toHaveBeenCalled();
});

test("falls back to the bundle when the declared main path is not observed", async () => {
  const resolveMainExecutable = mock(async () =>
    "/Applications/Scripted.app/Contents/MacOS/launcher"
  );
  const scanExecutable = mock(async () => []);
  const scanBundle = mock(async () => [301]);

  const scanner = await createGuiProcessScanner(
    [301],
    "/Applications/Scripted.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("bundle");
  expect(await scanner.scan()).toEqual([301]);
});
