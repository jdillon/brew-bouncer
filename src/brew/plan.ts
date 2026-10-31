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
import { normalizeTerminalOutput } from "./diagnostics.ts";
import { packageKey } from "./state.ts";

export interface UpgradePreview {
  packages: OutdatedPackage[];
  reasons: Map<string, string>;
}

/** Homebrew has no JSON upgrade plan. Read only counted change sections;
 * never turn warnings, download output or arbitrary prose into package rows.
 * Incomplete sections fail before approval instead of hiding unknown changes.
 */
export function parseUpgradePreview(
  output: string,
  targets: OutdatedPackage[],
  knownPackages: OutdatedPackage[] = targets,
): UpgradePreview {
  return parseUpgradePreviewRuns([{ output }], targets, knownPackages);
}

/**
 * One dry run per package type, because brew rejects `--formula` with `--cask`.
 * A run's type settles a name shared by an outdated formula and cask.
 * shortcut: a dependency of the other type with that same name resolves to the
 * run's type, upgrade to a row-level type if brew ever reports one.
 */
export function parseUpgradePreviewRuns(
  runs: Array<{ output: string; type?: OutdatedPackage["type"] }>,
  targets: OutdatedPackage[],
  knownPackages: OutdatedPackage[] = targets,
): UpgradePreview {
  const packages = new Map(targets.map((pkg) => [packageKey(pkg), pkg]));
  const reasons = new Map<string, string>();
  const known = [...new Map([...knownPackages, ...targets].map((pkg) => [packageKey(pkg), pkg])).values()];
  let section: { remaining: number; action: string; description: string } | undefined;
  function finishSection() {
    if (section?.remaining) throw new Error("Homebrew upgrade plan has an incomplete package section; no upgrades started");
    section = undefined;
  }
  for (const { output, type } of runs) for (const raw of normalizeTerminalOutput(output).split("\n")) {
    const line = raw.trim();
    if (line.startsWith("==>")) {
      finishSection();
      const heading = line.match(/^==> Would (install|upgrade|reinstall) (\d+) (.+?):?$/);
      if (heading) section = { action: heading[1]!, remaining: Number(heading[2]), description: heading[3]! };
      continue;
    }
    if (!section || section.remaining === 0 || !line ||
        /^(?:Disable this behaviour|Hide these hints)/.test(line)) continue;
    const upgraded = line.match(/^(\S+)\s+(.+?)\s+(?:->|→)\s+(\S+)(?:\s+\([^)]*\))?$/);
    const installed = line.match(/^(\S+)\s+(\S+)(?:\s+\([^)]*\))?$/);
    // Cask dependency previews sometimes contain names only, without versions.
    const namesOnly = section.action === "install" && /\bfor\b/.test(section.description);
    const entries = namesOnly ? line.split(/\s+/).map((name) => [name, "required"])
      : upgraded ? [[upgraded[1]!, upgraded[3]!, upgraded[2]!]]
      : installed ? [[installed[1]!, installed[2]!]] : [];
    if (!entries.length || entries.length > section.remaining) {
      throw new Error(`Cannot read Homebrew upgrade plan row: ${line}`);
    }
    for (const [name, version, previous] of entries) {
      if (!name || !version || !/^[\w@+./-]+$/.test(name)) throw new Error("Invalid package name in Homebrew upgrade plan");
      const exact = known.filter((pkg) => pkg.name === name);
      const named = exact.length ? exact : known.filter((pkg) => pkg.name.split("/").at(-1) === name.split("/").at(-1));
      const typed = named.filter((pkg) => pkg.type === type);
      const aliases = typed.length ? typed : named;
      if (aliases.length > 1) throw new Error(`Ambiguous package in Homebrew upgrade plan: ${name}`);
      const match = aliases[0];
      const pkg: OutdatedPackage = {
        name: match?.name ?? name, type: match?.type ?? "formula",
        installedVersions: previous ? previous.split(/,\s+/) : section.action === "install" ? [] : match?.installedVersions ?? [],
        currentVersion: version,
      };
      const key = packageKey(pkg);
      const selected = targets.some((target) => packageKey(target) === key);
      packages.set(key, pkg);
      if (!selected) reasons.set(pkg.name, /\bdependents?\b/.test(section.description) ? "dependent" : "dependency");
      section.remaining--;
    }
  }
  finishSection();
  return { packages: [...packages.values()], reasons };
}
