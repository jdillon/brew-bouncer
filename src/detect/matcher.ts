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
import type { OutdatedPackage } from "../brew/parser.ts";
import {
  brewInfoJson,
  brewList,
  brewServicesList,
  pkgutilAppNames,
} from "../brew/runner.ts";
import {
  parseBrewInfo,
  extractCaskAppNames,
  extractCaskBinaryNames,
  extractCaskPkgIds,
  parseBrewServices,
} from "../brew/parser.ts";
import {
  getRunningApps,
  matchCaskToRunningApps,
} from "./casks.ts";
import {
  getRunningProcesses,
  extractFormulaBinaries,
  matchFormulaToRunningProcesses,
  matchFormulaToRunningServices,
} from "./formulae.ts";
import { pool } from "../pool.ts";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["brew-bouncer", "detect"]);

export interface DetectedApp {
  packageName: string;
  oldVersion: string;
  newVersion: string;
  kind: "cask-gui" | "cask-cli" | "formula-cli" | "formula-service";
  displayName: string;
  pids: number[];
  /**
   * For cask-gui: absolute path to the .app bundle (when discoverable).
   * Used by the restart layer to verify a PID belongs to this exact bundle
   * before sending SIGTERM, preventing collateral damage to unrelated
   * processes that happen to share a name.
   */
  bundlePath?: string;
}

export type ProgressCallback = (message: string) => void;

export async function detectRunningUpgrades(
  packages: OutdatedPackage[],
  onProgress?: ProgressCallback
): Promise<DetectedApp[]> {
  const detected: DetectedApp[] = [];

  const casks = packages.filter((p) => p.type === "cask");
  const formulae = packages.filter((p) => p.type === "formula");

  // Gather system state and cask info in parallel
  onProgress?.("gathering system state");
  const [runningApps, runningProcesses, servicesResult, caskInfoResult] =
    await Promise.all([
      getRunningApps(),
      getRunningProcesses(),
      brewServicesList(),
      casks.length > 0
        ? brewInfoJson(casks.map((c) => c.name))
        : Promise.resolve(null),
    ]);

  const services = parseBrewServices(servicesResult.stdout);

  log.debug("System state: {apps} running apps, {procs} processes, {svcs} services", {
    apps: runningApps.length,
    procs: runningProcesses.length,
    svcs: services.filter((s) => s.status === "started").length,
  });

  // Process casks
  if (caskInfoResult && caskInfoResult.exitCode === 0) {
    onProgress?.("matching casks to running apps");
    const info = parseBrewInfo(caskInfoResult.stdout);

    for (const cask of info.casks) {
      const pkg = casks.find((c) => c.name === cask.token);
      if (!pkg) continue;

      log.debug("Checking cask {name}", { name: cask.token });
      let appNames = extractCaskAppNames(cask);

      log.debug("Cask {name} app artifacts: {apps}", {
        name: cask.token,
        apps: appNames.join(", ") || "none",
      });

      // Fallback: for pkg-installed casks, resolve app names from receipts
      if (appNames.length === 0) {
        const pkgIds = extractCaskPkgIds(cask);
        const pkgResults = await Promise.all(
          pkgIds.map((id) => pkgutilAppNames(id))
        );
        appNames = pkgResults.flat();
      }

      const matched = matchCaskToRunningApps(appNames, runningApps);

      if (matched.length > 0) {
        // Aggregate PIDs across all matched bundles (helpers, multi-window etc)
        const pids = matched.flatMap((m) => m.pids);
        // Prefer the first matched bundle's path for verification. Cask app
        // artifacts map 1:1 to a bundle, so multiple matches are unusual.
        const bundlePath = matched[0]!.bundlePath;
        detected.push({
          packageName: pkg.name,
          oldVersion: pkg.installedVersions[0] ?? "unknown",
          newVersion: pkg.currentVersion,
          kind: "cask-gui",
          displayName: matched[0]!.bundleName,
          pids,
          bundlePath,
        });
        continue;
      }

      // Fallback: check binary artifacts against running processes
      // Casks like claude-code install CLI binaries, not .app bundles
      const binaryNames = extractCaskBinaryNames(cask);
      if (binaryNames.length > 0) {
        log.debug("Cask {name} binary artifacts: {bins}", {
          name: cask.token,
          bins: binaryNames.join(", "),
        });
      }
      if (binaryNames.length > 0) {
        const binMatched = matchFormulaToRunningProcesses(
          binaryNames,
          runningProcesses
        );
        if (binMatched.length > 0) {
          detected.push({
            packageName: pkg.name,
            oldVersion: pkg.installedVersions[0] ?? "unknown",
            newVersion: pkg.currentVersion,
            kind: "cask-cli",
            displayName: binMatched[0]!.name,
            pids: binMatched.map((m) => m.pid),
          });
        }
      }
    }
  }

  // Process formulae — batch brew list calls with concurrency limit
  if (formulae.length > 0) {
    let checked = 0;
    onProgress?.(`checking packages (0/${formulae.length})`);

    const formulaResults = await pool(
      formulae,
      async (pkg) => {
        // Check services first (no subprocess needed)
        const service = matchFormulaToRunningServices(pkg.name, services);
        if (service) {
          return {
            packageName: pkg.name,
            oldVersion: pkg.installedVersions[0] ?? "unknown",
            newVersion: pkg.currentVersion,
            kind: "formula-service" as const,
            displayName: pkg.name,
            pids: [] as number[],
          };
        }

        // Check running processes via brew list
        const listResult = await brewList(pkg.name);
        if (listResult.exitCode !== 0) return null;

        const binaries = extractFormulaBinaries(listResult.stdout);
        const matched = matchFormulaToRunningProcesses(
          binaries,
          runningProcesses
        );

        if (matched.length > 0) {
          return {
            packageName: pkg.name,
            oldVersion: pkg.installedVersions[0] ?? "unknown",
            newVersion: pkg.currentVersion,
            kind: "formula-cli" as const,
            displayName: matched[0]!.name,
            pids: matched.map((m) => m.pid),
          };
        }

        return null;
      },
      {
        concurrency: 8,
        onProgress: (done, total) => {
          checked = done;
          onProgress?.(`checking packages (${done}/${total})`);
        },
      }
    );

    for (const result of formulaResults) {
      if (result) detected.push(result);
    }
  }

  log.debug("Detection complete: {count} affected packages", { count: detected.length });
  for (const d of detected) {
    log.debug("  {kind} {name} ({display})", {
      kind: d.kind,
      name: d.packageName,
      display: d.displayName,
    });
  }

  return detected;
}
