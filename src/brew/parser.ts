export interface OutdatedPackage {
  name: string;
  installedVersions: string[];
  currentVersion: string;
  type: "formula" | "cask";
  skipped?: { reason: string };
}

export interface BrewInfoResult {
  formulae: BrewFormula[];
  casks: BrewCask[];
}

export interface BrewFormula {
  name: string;
  fullName: string;
  versions: { stable: string };
}

export interface BrewCask {
  token: string;
  version: string;
  artifacts: CaskArtifact[];
}

type CaskArtifact = Record<string, unknown>;

export function parseOutdated(json: string): OutdatedPackage[] {
  const data = JSON.parse(json) as {
    formulae: Array<{
      name: string;
      installed_versions: string[];
      current_version: string;
    }>;
    casks: Array<{
      name: string;
      installed_versions: string[];
      current_version: string;
    }>;
  };

  const packages: OutdatedPackage[] = [];

  for (const f of data.formulae) {
    packages.push({
      name: f.name,
      installedVersions: f.installed_versions,
      currentVersion: f.current_version,
      type: "formula",
    });
  }

  for (const c of data.casks) {
    packages.push({
      name: c.name,
      installedVersions: c.installed_versions,
      currentVersion: c.current_version,
      type: "cask",
    });
  }

  return packages;
}

/**
 * Filters outdated packages, marking ones that should be skipped.
 * - `latest -> latest` casks: brew can't detect actual changes
 * - Packages in the user's ignore list
 */
export function filterOutdated(
  packages: OutdatedPackage[],
  ignoreList: string[]
): { actionable: OutdatedPackage[]; skipped: OutdatedPackage[] } {
  const ignoreSet = new Set(ignoreList.map((n) => n.toLowerCase()));
  const actionable: OutdatedPackage[] = [];
  const skipped: OutdatedPackage[] = [];

  for (const pkg of packages) {
    if (ignoreSet.has(pkg.name.toLowerCase())) {
      skipped.push({ ...pkg, skipped: { reason: "ignored in config" } });
    } else if (isUnversionedCask(pkg)) {
      skipped.push({
        ...pkg,
        skipped: { reason: "unversioned (latest -> latest)" },
      });
    } else {
      actionable.push(pkg);
    }
  }

  return { actionable, skipped };
}

function isUnversionedCask(pkg: OutdatedPackage): boolean {
  if (pkg.type !== "cask") return false;
  return (
    pkg.currentVersion === "latest" &&
    pkg.installedVersions.every((v) => v === "latest")
  );
}

export function parseBrewInfo(json: string): BrewInfoResult {
  return JSON.parse(json) as BrewInfoResult;
}

export function extractCaskAppNames(cask: BrewCask): string[] {
  const apps: string[] = [];
  for (const artifact of cask.artifacts) {
    if ("app" in artifact && Array.isArray(artifact.app)) {
      for (const app of artifact.app) {
        if (typeof app === "string") {
          apps.push(app);
        }
      }
    }
  }
  return apps;
}

/**
 * Extract pkgutil identifiers from a cask's uninstall stanza.
 * Used as a fallback for pkg-installed casks that don't declare an "app" artifact.
 */
export function extractCaskPkgIds(cask: BrewCask): string[] {
  const ids: string[] = [];
  for (const artifact of cask.artifacts) {
    if ("uninstall" in artifact && Array.isArray(artifact.uninstall)) {
      for (const entry of artifact.uninstall) {
        if (typeof entry === "object" && entry !== null && "pkgutil" in entry) {
          const val = (entry as Record<string, unknown>).pkgutil;
          if (typeof val === "string") {
            ids.push(val);
          } else if (Array.isArray(val)) {
            ids.push(...val.filter((v): v is string => typeof v === "string"));
          }
        }
      }
    }
  }
  return ids;
}

export function parseBrewServices(
  output: string
): Array<{ name: string; status: string; user: string }> {
  const lines = output.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header line
  return lines.slice(1).map((line) => {
    const parts = line.split(/\s+/);
    return {
      name: parts[0] ?? "",
      status: parts[1] ?? "",
      user: parts[2] ?? "",
    };
  });
}
