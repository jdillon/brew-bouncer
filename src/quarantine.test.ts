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
import { removeQuarantine, shellQuote } from "./quarantine.ts";

test("shellQuote keeps $(...), backticks and apostrophes inert", () => {
  expect(shellQuote("/Applications/Example$(id).app")).toBe("'/Applications/Example$(id).app'");
  expect(shellQuote("/Applications/Jason's `x`.app")).toBe("'/Applications/Jason'\\''s `x`.app'");
});

test.skipIf(process.platform !== "darwin")("removeQuarantine reports xattr's first error line to the caller", async () => {
  const reasons: string[] = [];
  const ok = await removeQuarantine("/nonexistent/brew-bouncer-test.app", (r) => reasons.push(r));
  expect(ok).toBe(false);
  expect(reasons).toHaveLength(1);
  expect(reasons[0]).toContain("No such file");
  expect(reasons[0]).not.toContain("\n");
});
