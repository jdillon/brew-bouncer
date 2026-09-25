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
import { brewUpgradeArgs, formatExecFailure } from "./runner.ts";

test("formatExecFailure includes stderr", () => {
  expect(formatExecFailure("brew update", {
    stdout: "",
    stderr: "fatal: unable to access remote\n",
    exitCode: 1,
  })).toBe("brew update exited with status 1:\nfatal: unable to access remote");
});

test("formatExecFailure uses stdout when stderr is empty", () => {
  expect(formatExecFailure("brew update", {
    stdout: "update failed\n",
    stderr: "",
    exitCode: 2,
  })).toBe("brew update exited with status 2:\nupdate failed");
});

test("formatExecFailure always provides an exit-code reason", () => {
  expect(formatExecFailure("brew update", {
    stdout: "",
    stderr: "",
    exitCode: 3,
  })).toBe("brew update exited with status 3 without an error message.");
});

test("brewUpgradeArgs adds --no-quit only when requested", () => {
  expect(brewUpgradeArgs("cmux")).toEqual(["upgrade", "cmux"]);
  expect(brewUpgradeArgs("cmux", { noQuit: true })).toEqual([
    "upgrade",
    "--no-quit",
    "cmux",
  ]);
});
