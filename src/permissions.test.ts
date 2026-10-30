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
import { afterAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findStaleGrants,
  inspectPackagePermissions,
  isHashPinned,
  parseTccRows,
  permissionLabel,
  permissionSettingsUrl,
} from "./permissions.ts";

// Signed system app; its identity requirement holds and an arbitrary cdhash does not.
const APP = "/System/Applications/Calculator.app";
const BUNDLE_ID = "com.apple.calculator";
const dir = mkdtempSync(join(tmpdir(), "permissions-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function compile(name: string, text: string): Uint8Array {
  writeFileSync(join(dir, `${name}.txt`), text);
  const result = Bun.spawnSync(["csreq", "-r", join(dir, `${name}.txt`), "-b", join(dir, `${name}.csreq`)]);
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return new Uint8Array(readFileSync(join(dir, `${name}.csreq`)));
}

const pinned = compile("pinned", 'cdhash H"0000000000000000000000000000000000000000"');
const identity = compile("identity", `identifier "${BUNDLE_ID}" and anchor apple`);

function tccDatabase(rows: Array<[service: string, client: string, authValue: number, csreq: Uint8Array | null]>): string {
  const path = join(dir, `tcc-${Math.random()}.db`);
  const db = new Database(path);
  db.run("create table access (service text, client text, client_type integer, auth_value integer, csreq blob)");
  for (const [service, client, authValue, csreq] of rows) {
    db.query("insert into access values (?, ?, 0, ?, ?)").run(service, client, authValue, csreq);
  }
  db.close();
  return path;
}

test("hash-only requirements are pinned; identity requirements are not", () => {
  expect(isHashPinned('cdhash H"afa4d2ef6b2c934a41e2a52c745c47cd2ec43584" or cdhash H"edc0705617ca7e2bb796fc32c93e9c3130a8feda"')).toBe(true);
  expect(isHashPinned('anchor apple generic and identifier "com.raycast.macos" and certificate leaf[subject.OU] = SY64MV22J9')).toBe(false);
  expect(isHashPinned('identifier "com.example" and cdhash H"00"')).toBe(false);
  expect(isHashPinned('identifier "com.example"')).toBe(false);
});

test("TCC rows without a stored requirement are dropped", () => {
  const blob = new Uint8Array([1]);
  expect(parseTccRows([
    { service: "kTCCServiceAccessibility", csreq: blob },
    { service: "kTCCServiceCamera", csreq: null },
    { service: "kTCCServiceMicrophone", csreq: new Uint8Array() },
  ])).toEqual([{ service: "kTCCServiceAccessibility", requirement: blob }]);
});

test("labels and Settings links fall back for unknown services", () => {
  expect(permissionLabel("kTCCServiceAccessibility")).toBe("Accessibility");
  expect(permissionSettingsUrl("kTCCServiceAccessibility"))
    .toBe("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
  expect(permissionLabel("kTCCServiceSomethingNew")).toBe("SomethingNew");
  expect(permissionSettingsUrl("kTCCServiceSomethingNew")).toBe("x-apple.systempreferences:com.apple.preference.security");
});

test("inspection reports allowed grants and which are pinned to the current build", async () => {
  const db = tccDatabase([
    ["kTCCServiceAccessibility", BUNDLE_ID, 2, pinned],
    ["kTCCServiceAppleEvents", BUNDLE_ID, 2, identity],
    ["kTCCServiceCamera", BUNDLE_ID, 0, pinned],
    ["kTCCServiceAccessibility", "com.example.other", 2, pinned],
  ]);
  const result = await inspectPackagePermissions(new Map([["calculator", [APP, "/opt/homebrew/bin/calc"]]]), [db]);
  expect(result.tccReadable).toBe(true);
  expect(result.apps).toHaveLength(1);
  expect(result.apps[0]!.grants.map((g) => g.service)).toEqual(["kTCCServiceAccessibility", "kTCCServiceAppleEvents"]);
  expect(result.apps[0]!.pinned).toEqual(["kTCCServiceAccessibility"]);
});

test("unreadable TCC falls back to the signature check and skips signed apps", async () => {
  const result = await inspectPackagePermissions(new Map([["calculator", [APP]]]), [join(dir, "missing", "TCC.db")]);
  expect(result).toEqual({ tccReadable: false, apps: [] });
});

test("post-upgrade check reports grants the installed build no longer satisfies", async () => {
  const stale = await findStaleGrants({
    packageName: "calculator", appPath: APP, pinned: [], adhocUnverified: false,
    grants: [
      { service: "kTCCServiceAccessibility", requirement: pinned },
      { service: "kTCCServiceAppleEvents", requirement: identity },
    ],
  });
  expect(stale).toEqual(["kTCCServiceAccessibility"]);
  expect(await findStaleGrants({
    packageName: "gone", appPath: join(dir, "Gone.app"), pinned: [], adhocUnverified: false,
    grants: [{ service: "kTCCServiceAccessibility", requirement: pinned }],
  })).toEqual([]);
});
