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
  extractKegPrefixes,
  matchFormulaToRunningProcesses,
  type RunningProcess,
} from "./formulae.ts";

const AWSCLI_LIST = `
/opt/homebrew/Cellar/awscli/2.36.33_1/INSTALL_RECEIPT.json
/opt/homebrew/Cellar/awscli/2.36.33_1/bin/aws
/opt/homebrew/Cellar/awscli/2.36.33_1/bin/aws_completer
/opt/homebrew/Cellar/awscli/2.36.33_1/libexec/bin/python
/opt/homebrew/Cellar/awscli/2.36.33_1/libexec/bin/python3.14
`;

function proc(pid: number, command: string): RunningProcess {
  return { pid, command, name: command.split("/").pop() ?? command };
}

test("extractKegPrefixes collapses a file list to its keg root", () => {
  expect(extractKegPrefixes(AWSCLI_LIST)).toEqual([
    "/opt/homebrew/Cellar/awscli/2.36.33_1/",
  ]);
});

test("extractKegPrefixes keeps one prefix per installed version", () => {
  const list = `
/opt/homebrew/Cellar/node/26.7.0/bin/node
/opt/homebrew/Cellar/node/25.1.0/bin/node
`;
  expect(extractKegPrefixes(list)).toEqual([
    "/opt/homebrew/Cellar/node/26.7.0/",
    "/opt/homebrew/Cellar/node/25.1.0/",
  ]);
});

// Regression: awscli vendors libexec/bin/python, which used to name-match any
// running python — including uv's cached interpreter.
test("a same-named process outside the keg does not match", () => {
  const processes = [
    proc(89593, "/Users/jason/.cache/uv/archive-v0/kpyNaBeL0qSzjipG/bin/python"),
  ];
  const matched = matchFormulaToRunningProcesses(
    extractKegPrefixes(AWSCLI_LIST),
    processes
  );
  expect(matched).toEqual([]);
});

test("a process running from libexec inside the keg matches", () => {
  const processes = [proc(65986, "/opt/homebrew/Cellar/moon/2.5.2/libexec/bin/moon")];
  const matched = matchFormulaToRunningProcesses(
    ["/opt/homebrew/Cellar/moon/2.5.2/"],
    processes
  );
  expect(matched.map((p) => p.pid)).toEqual([65986]);
});

test("a pid matching two prefixes is only reported once", () => {
  const processes = [proc(1, "/opt/homebrew/Cellar/node/26.7.0/bin/node")];
  const matched = matchFormulaToRunningProcesses(
    ["/opt/homebrew/Cellar/node/26.7.0/", "/opt/homebrew/Cellar/node/26.7.0/bin/"],
    processes
  );
  expect(matched).toHaveLength(1);
});
