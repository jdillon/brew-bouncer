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
import { parseUpgradePreview } from "./plan.ts";
import type { OutdatedPackage } from "./parser.ts";
import { renderPackageTable } from "../output/format.ts";
import { normalizeTerminalOutput } from "./diagnostics.ts";

const selected: OutdatedPackage[] = [
  { name: "simdutf", type: "formula", installedVersions: ["9.3.0"], currentVersion: "9.3.2_1" },
  { name: "netbird-ui", type: "cask", installedVersions: ["0.81.3"], currentVersion: "0.81.5" },
  { name: "microsoft-edge", type: "cask", installedVersions: ["156.0.4314.42,old-build"], currentVersion: "156.0.4314.50,new-build" },
];

test("merges the supplied dry-run layout into one formatted table with canonical names and dependency rows", () => {
  const plan = parseUpgradePreview(`
==> Would install 1 dependency:
icu4c@79 79.1
==> Would upgrade 3 requested outdated packages
simdutf                      9.3.2 -> 9.3.2_1 (416.2KB)
netbirdio/tap/netbird-ui      0.81.3 -> 0.81.5
microsoft-edge               156.0.4314.42,old-build -> 156.0.4314.50,new-build
==> Would upgrade 1 dependent
node@22 22.23.3_3 -> 22.23.4 (15.1MB)
Warning: The following taps are not trusted:
  paradevai/tap
==> Downloading bottle manifests
✔︎ Bottle Manifest simdutf (9.3.2_1)
`, selected);
  expect(plan.packages).toHaveLength(5);
  expect(plan.packages.find((p) => p.name === "simdutf")?.installedVersions).toEqual(["9.3.2"]);
  expect(plan.packages.find((p) => p.name === "netbird-ui")?.type).toBe("cask");
  expect(plan.packages.find((p) => p.name === "icu4c@79")?.installedVersions).toEqual([]);
  expect([...plan.reasons]).toEqual([["icu4c@79", "dependency"], ["node@22", "dependent"]]);
  const table = normalizeTerminalOutput(renderPackageTable(plan.packages, undefined, undefined, plan.reasons));
  expect(table).toContain("new");
  expect(table).toContain("dependency");
  expect(table).not.toContain("old-build");
  expect(table).not.toContain("Would upgrade");
  expect(table).not.toContain("Bottle Manifest");
  expect(table).not.toContain("paradevai");
  expect(table.split("\n").filter((line) => line.includes("netbird-ui"))).toHaveLength(1);
});

test("already selected dependencies and repeated sections do not duplicate packages", () => {
  const plan = parseUpgradePreview(`==> Would upgrade 1 dependency:
simdutf 9.3.2 -> 9.3.2_1
==> Would upgrade 1 requested outdated package
simdutf 9.3.2 -> 9.3.2_1
`, [selected[0]!]);
  expect(plan.packages).toHaveLength(1);
  expect(plan.reasons.size).toBe(0);
});

test("cask name-only dependency lists remain visible without invented versions", () => {
  const plan = parseUpgradePreview(`==> Would install 2 dependencies for vendor/tap/app:
python@3.13 certifi
`, []);
  expect(plan.packages.map((p) => [p.name, p.currentVersion])).toEqual([
    ["python@3.13", "required"], ["certifi", "required"],
  ]);
});

test("planning ignores unrelated headings, ANSI styles and progress output", () => {
  const plan = parseUpgradePreview(`==> Downloading bottle manifests
✔︎ Bottle Manifest ignored (1.0)
\x1b[1m==> Would upgrade 1 dependency:\x1b[0m\r
simdutf\t9.3.2\t->\t9.3.2_1\r
==> 1 Pinned formula
unrelated 1 -> 2
`, selected);
  expect(plan.packages).toHaveLength(3);
});

test("incomplete or malformed counted plan sections fail instead of silently omitting changes", () => {
  for (const output of [
    "==> Would install 1 dependency:\n",
    "==> Would upgrade 2 dependents\nnode 1 -> 2\n==> Downloading bottle manifests",
    "==> Would upgrade 1 dependent\nunrecognized plan row with unexpected fields",
  ]) expect(() => parseUpgradePreview(output, selected)).toThrow();
});

test("a short name cannot silently match two distinct taps", () => {
  const known: OutdatedPackage[] = ["one/tap/tool", "two/tap/tool"].map((name) => ({
    name, type: "formula", installedVersions: ["1"], currentVersion: "2",
  }));
  expect(() => parseUpgradePreview("==> Would upgrade 1 dependent\ntool 1 -> 2", [], known)).toThrow("Ambiguous");
});
