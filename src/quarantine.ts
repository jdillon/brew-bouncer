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
  extractPkgAppNames,
} from "./brew/parser.ts";
import { HOMEBREW_PREFIX, HOMEBREW_BIN } from "./brew/paths.ts";
import { brewList, pkgutilFiles } from "./brew/runner.ts";

const log = getLogger(["brew-bouncer", "quarantine"]);

/**
 * Check if a file/bundle has the com.apple.quarantine extended attribute.
 * Returns true if quarantined, false if attribute is absent, null if path doesn't exist.
 */
export async function isQuarantined(path: string): Promise<boolean | null> {
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
    const pkgResults = await Promise.all(pkgIds.map((id) => pkgutilFiles(id)));
    for (const appName of extractPkgAppNames(pkgResults.flat())) {
      paths.push(`/Applications/${appName}`);
    }
  }

  return paths;
}

/**
 * Enumerate executable paths to check for quarantine on a formula.
 *
 * Extracts top-level bin/ and sbin/ entries from `brew list` output and
 * returns their HOMEBREW_BIN symlink paths rather than the raw Cellar paths.
 * This is critical: after `brew upgrade`, the old Cellar version directory is
 * deleted, so any path containing the old version would fail. The symlink in
 * HOMEBREW_BIN is updated by brew to point to the new version.
 *
 * Only top-level bin/sbin entries are included — nested paths like
 * libexec/bin/ or Frameworks/.../bin/ are internal and not user-facing.
 */
async function formulaQuarantinePaths(formulaName: string): Promise<string[]> {
  const result = await brewList(formulaName);
  if (result.exitCode !== 0) return [];

  const paths: string[] = [];
  for (const line of result.stdout.trim().split("\n")) {
    // Match only top-level bin/sbin: <prefix>/Cellar/<name>/<version>/(s)bin/<binary>
    const match = line.trim().match(/\/Cellar\/[^/]+\/[^/]+\/(s?bin)\/(.+)$/);
    if (match) {
      const dir = match[1] === "sbin" ? `${HOMEBREW_PREFIX}/sbin` : HOMEBREW_BIN;
      paths.push(`${dir}/${match[2]}`);
    }
  }
  return paths;
}

/**
 * Enumerate executable paths for upgrade targets.
 *
 * Returns a map of package name → list of executable paths to check for
 * quarantine after upgrade. Paths that don't exist yet are excluded (they
 * can't have quarantine). This intentionally does NOT filter by current
 * quarantine status — both previously-approved and never-approved executables
 * are included so that post-upgrade detection works for packages (like
 * claude-code) whose binaries ship quarantined and are never pre-approved.
 */
export async function enumeratePackageExecutables(
  targets: OutdatedPackage[],
  caskInfo: BrewCask[]
): Promise<Map<string, string[]>> {
  const packagePaths = new Map<string, string[]>();

  for (const target of targets) {
    let paths: string[];
    if (target.type === "cask") {
      const cask = caskInfo.find((c) => c.token === target.name);
      if (!cask) continue;
      paths = await caskQuarantinePaths(cask);
    } else {
      paths = await formulaQuarantinePaths(target.name);
    }

    // Filter to paths that actually exist (can't have quarantine if not present)
    const existing = await Promise.all(
      paths.map(async (p) => {
        const q = await isQuarantined(p);
        return q !== null ? p : null; // null = path doesn't exist
      })
    );
    const found = existing.filter((p): p is string => p !== null);

    if (found.length > 0) {
      log.debug("enumerated {count} executable(s) for {pkg}", {
        count: found.length,
        pkg: target.name,
      });
      packagePaths.set(target.name, found);
    }
  }

  return packagePaths;
}
