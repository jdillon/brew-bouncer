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
import type { OutdatedPackage } from "./parser.ts";
import type { DetectedApp } from "../detect/matcher.ts";

export type InstalledState = Map<string, OutdatedPackage>;
export const packageKey = (pkg: Pick<OutdatedPackage, "type" | "name">): string => `${pkg.type}:${pkg.name}`;
/** The packageKey of the package an app was detected for. */
export const detectedKey = (app: DetectedApp): string =>
  packageKey({ name: app.packageName, type: app.kind.startsWith("cask") ? "cask" : "formula" });

/** Installed receipts are observations, never proof of file integrity/rollback. */
export function parseInstalled(json: string): InstalledState {
  const data = JSON.parse(json) as {
    formulae: Array<{ name: string; installed: Array<{ version: string }> }>;
    casks: Array<{ token: string; installed: string | string[] | null }>;
  };
  const state: InstalledState = new Map();
  for (const f of data.formulae) {
    if (!f.installed.length) continue;
    const pkg: OutdatedPackage = { name: f.name, type: "formula",
      installedVersions: f.installed.map((i) => i.version).sort(), currentVersion: "" };
    state.set(packageKey(pkg), pkg);
  }
  for (const c of data.casks) {
    if (!c.installed) continue;
    const pkg: OutdatedPackage = { name: c.token, type: "cask",
      installedVersions: (Array.isArray(c.installed) ? c.installed : [c.installed]).sort(), currentVersion: "" };
    state.set(packageKey(pkg), pkg);
  }
  return state;
}

export function installedChanges(before: InstalledState, after: InstalledState): OutdatedPackage[] {
  const changed = [...after].flatMap(([key, pkg]) => {
    const previous = before.get(key);
    if (JSON.stringify(previous?.installedVersions) === JSON.stringify(pkg.installedVersions)) return [];
    return [{ ...pkg, installedVersions: previous?.installedVersions ?? [],
      currentVersion: pkg.installedVersions.join(", ") }];
  });
  for (const [key, pkg] of before) {
    if (!after.has(key)) changed.push({ ...pkg, currentVersion: "removed" });
  }
  return changed;
}
