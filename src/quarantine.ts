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
import { getLogger } from "@logtape/logtape";
import type { BrewCask, OutdatedPackage } from "./brew/parser.ts";
import {
  extractCaskAppNames,
  extractCaskBinaryNames,
  extractCaskPkgIds,
} from "./brew/parser.ts";
import { HOMEBREW_BIN } from "./brew/paths.ts";
import { brewList, pkgutilAppNames } from "./brew/runner.ts";

const log = getLogger(["brew-bouncer", "quarantine"]);

export interface QuarantineInfo {
  packageName: string;
  path: string;
}

/**
 * Check if a file/bundle has the com.apple.quarantine extended attribute.
 * Returns true if quarantined, false if attribute is absent, null if path doesn't exist.
 */
async function isQuarantined(path: string): Promise<boolean | null> {
  const proc = Bun.spawn(["xattr", "-p", "com.apple.quarantine", path], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;

  if (exitCode === 0) {
    log.debug("quarantined: {path}", { path });
    return true;
  }

  // "No such xattr" = attribute absent (previously approved)
  if (stderr.includes("No such xattr")) {
    log.debug("not quarantined (approved): {path}", { path });
    return false;
  }

  // "No such file" = path doesn't exist, or any other error (permission denied, etc.)
  // Treat as indeterminate — don't falsely mark as approved
  if (!stderr.includes("No such file")) {
    log.warn("unexpected xattr error for {path}: {stderr}", { path, stderr: stderr.trim() });
  }
  return null;
}

/**
 * Remove quarantine recursively from a path (file or app bundle).
 */
export async function removeQuarantine(path: string): Promise<boolean> {
  const proc = Bun.spawn(
    ["xattr", "-r", "-d", "com.apple.quarantine", path],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.warn("failed to remove quarantine: {path} {stderr}", { path, stderr: stderr.trim() });
    return false;
  }

  log.debug("removed quarantine: {path}", { path });
  return true;
}

/**
 * Enumerate executable paths to check for quarantine on a cask.
 *
 * Covers:
 * - `app` artifacts (.app bundles in /Applications)
 * - `binary` artifacts (CLI binaries linked into the Homebrew bin directory)
 * - pkg-installed casks with no `app` artifact (resolved via pkgutil receipts)
 */
async function caskQuarantinePaths(cask: BrewCask): Promise<string[]> {
  const paths: string[] = [];

  // app artifacts → /Applications/<name>
  for (const appName of extractCaskAppNames(cask)) {
    paths.push(`/Applications/${appName}`);
  }

  // binary artifacts → ${HOMEBREW_BIN}/<name>
  // xattr follows symlinks by default, so checking the linked path
  // operates on the actual file in the Caskroom.
  for (const binName of extractCaskBinaryNames(cask)) {
    paths.push(`${HOMEBREW_BIN}/${binName}`);
  }

  // pkg-installed cask fallback: if the cask declares no `app` artifact
  // but installs via a pkg, resolve .app names from the pkg receipt.
  // Mirrors the detection logic in src/detect/matcher.ts.
  if (extractCaskAppNames(cask).length === 0) {
    const pkgIds = extractCaskPkgIds(cask);
    const pkgResults = await Promise.all(pkgIds.map((id) => pkgutilAppNames(id)));
    for (const appName of pkgResults.flat()) {
      paths.push(`/Applications/${appName}`);
    }
  }

  return paths;
}

/**
 * Enumerate executable paths to check for quarantine on a formula.
 *
 * Walks `brew list <formula>` output for files under any `bin/` or `sbin/`
 * directory. Brew bottles aren't typically quarantined, but checking is
 * cheap and protects users who manually approved a downloaded binary.
 */
async function formulaQuarantinePaths(formulaName: string): Promise<string[]> {
  const result = await brewList(formulaName);
  if (result.exitCode !== 0) return [];

  return result.stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /\/(s?bin)\//.test(line));
}

/**
 * Snapshot quarantine status for upgrade targets before upgrading.
 *
 * Returns a map of package name → list of paths that are NOT quarantined
 * (i.e., previously approved by the user). Paths that are still quarantined
 * or don't exist are excluded — only previously-approved executables are
 * worth re-approving after the upgrade replaces them.
 */
export async function snapshotPackageQuarantine(
  targets: OutdatedPackage[],
  caskInfo: BrewCask[]
): Promise<Map<string, QuarantineInfo[]>> {
  const approved = new Map<string, QuarantineInfo[]>();

  // Build (packageName, path) pairs for everything we want to check.
  const checks: { packageName: string; path: string }[] = [];

  for (const target of targets) {
    if (target.type === "cask") {
      const cask = caskInfo.find((c) => c.token === target.name);
      if (!cask) continue;
      const paths = await caskQuarantinePaths(cask);
      for (const path of paths) {
        checks.push({ packageName: target.name, path });
      }
    } else {
      const paths = await formulaQuarantinePaths(target.name);
      for (const path of paths) {
        checks.push({ packageName: target.name, path });
      }
    }
  }

  log.debug("checking quarantine status for {count} path(s)", { count: checks.length });

  const results = await Promise.all(
    checks.map(async (check) => {
      const quarantined = await isQuarantined(check.path);
      return { ...check, quarantined };
    })
  );

  for (const result of results) {
    // false = attribute absent (previously approved)
    // null  = path doesn't exist (skip — don't treat as approved)
    // true  = quarantined (skip — user never approved)
    if (result.quarantined === false) {
      log.debug("previously approved (not quarantined): {pkg} {path}", {
        pkg: result.packageName,
        path: result.path,
      });
      const existing = approved.get(result.packageName) ?? [];
      existing.push({ packageName: result.packageName, path: result.path });
      approved.set(result.packageName, existing);
    } else if (result.quarantined === null) {
      log.debug("path not found, skipping: {pkg} {path}", {
        pkg: result.packageName,
        path: result.path,
      });
    }
  }

  const totalApproved = [...approved.values()].reduce((n, paths) => n + paths.length, 0);
  log.debug("quarantine snapshot: {approved} approved, {skipped} skipped/quarantined", {
    approved: totalApproved,
    skipped: results.length - totalApproved,
  });

  return approved;
}
