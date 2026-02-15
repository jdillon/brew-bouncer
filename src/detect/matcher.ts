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

export interface DetectedApp {
  packageName: string;
  oldVersion: string;
  newVersion: string;
  kind: "cask-gui" | "formula-cli" | "formula-service";
  displayName: string;
  pids: number[];
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

  // Process casks
  if (caskInfoResult && caskInfoResult.exitCode === 0) {
    onProgress?.("matching casks to running apps");
    const info = parseBrewInfo(caskInfoResult.stdout);

    for (const cask of info.casks) {
      const pkg = casks.find((c) => c.name === cask.token);
      if (!pkg) continue;

      let appNames = extractCaskAppNames(cask);

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
        detected.push({
          packageName: pkg.name,
          oldVersion: pkg.installedVersions[0] ?? "unknown",
          newVersion: pkg.currentVersion,
          kind: "cask-gui",
          displayName: matched[0]!.bundleName,
          pids: [],
        });
      }
    }
  }

  // Process formulae — batch brew list calls with concurrency limit
  if (formulae.length > 0) {
    let checked = 0;
    onProgress?.(`checking formulae (0/${formulae.length})`);

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
          onProgress?.(`checking formulae (${done}/${total})`);
        },
      }
    );

    for (const result of formulaResults) {
      if (result) detected.push(result);
    }
  }

  return detected;
}
