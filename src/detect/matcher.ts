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

export interface DetectedApp {
  packageName: string;
  oldVersion: string;
  newVersion: string;
  kind: "cask-gui" | "formula-cli" | "formula-service";
  displayName: string;
  pids: number[];
}

export async function detectRunningUpgrades(
  packages: OutdatedPackage[]
): Promise<DetectedApp[]> {
  const detected: DetectedApp[] = [];

  const casks = packages.filter((p) => p.type === "cask");
  const formulae = packages.filter((p) => p.type === "formula");

  // Gather system state in parallel
  const [runningApps, runningProcesses, servicesResult] = await Promise.all([
    getRunningApps(),
    getRunningProcesses(),
    brewServicesList(),
  ]);

  const services = parseBrewServices(servicesResult.stdout);

  // Process casks
  if (casks.length > 0) {
    const infoResult = await brewInfoJson(casks.map((c) => c.name));
    if (infoResult.exitCode === 0) {
      const info = parseBrewInfo(infoResult.stdout);
      for (const cask of info.casks) {
        const pkg = casks.find((c) => c.name === cask.token);
        if (!pkg) continue;

        let appNames = extractCaskAppNames(cask);

        // Fallback: for pkg-installed casks, resolve app names from receipts
        if (appNames.length === 0) {
          const pkgIds = extractCaskPkgIds(cask);
          for (const pkgId of pkgIds) {
            const names = await pkgutilAppNames(pkgId);
            appNames.push(...names);
          }
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
  }

  // Process formulae
  for (const pkg of formulae) {
    // Check services first
    const service = matchFormulaToRunningServices(pkg.name, services);
    if (service) {
      detected.push({
        packageName: pkg.name,
        oldVersion: pkg.installedVersions[0] ?? "unknown",
        newVersion: pkg.currentVersion,
        kind: "formula-service",
        displayName: pkg.name,
        pids: [],
      });
      continue;
    }

    // Check running processes
    const listResult = await brewList(pkg.name);
    if (listResult.exitCode !== 0) continue;

    const binaries = extractFormulaBinaries(listResult.stdout);
    const matched = matchFormulaToRunningProcesses(
      binaries,
      runningProcesses
    );

    if (matched.length > 0) {
      detected.push({
        packageName: pkg.name,
        oldVersion: pkg.installedVersions[0] ?? "unknown",
        newVersion: pkg.currentVersion,
        kind: "formula-cli",
        displayName: matched[0]!.name,
        pids: matched.map((m) => m.pid),
      });
    }
  }

  return detected;
}
