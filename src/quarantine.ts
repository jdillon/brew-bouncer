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
import type { BrewCask } from "./brew/parser.ts";
import { extractCaskAppNames } from "./brew/parser.ts";
import { log } from "./logger.ts";

export interface QuarantineInfo {
  caskName: string;
  appPath: string;
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

  if (exitCode === 0) return true;

  // "No such file" = path doesn't exist, can't determine status
  if (stderr.includes("No such file")) return null;

  // "No such xattr" = attribute absent (previously approved)
  return false;
}

/**
 * Remove quarantine recursively from an app bundle.
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
    log.warn({ path, stderr }, "failed to remove quarantine");
  }

  return exitCode === 0;
}

/**
 * Snapshot quarantine status for cask targets before upgrade.
 * Returns a map of cask name → QuarantineInfo for casks whose apps
 * are NOT quarantined (i.e., previously approved by the user).
 * Casks that are still quarantined or have no app artifact are excluded.
 */
export async function snapshotCaskQuarantine(
  caskNames: string[],
  caskInfo: BrewCask[]
): Promise<Map<string, QuarantineInfo[]>> {
  const approved = new Map<string, QuarantineInfo[]>();

  const checks = caskInfo
    .filter((cask) => caskNames.includes(cask.token))
    .flatMap((cask) => {
      const appNames = extractCaskAppNames(cask);
      return appNames.map((appName) => ({
        caskName: cask.token,
        appPath: `/Applications/${appName}`,
      }));
    });

  const results = await Promise.all(
    checks.map(async (check) => {
      const quarantined = await isQuarantined(check.appPath);
      return { ...check, quarantined };
    })
  );

  for (const result of results) {
    // false = attribute absent (previously approved)
    // null = path doesn't exist (skip — don't treat as approved)
    // true = quarantined (skip — user never approved)
    if (result.quarantined === false) {
      log.debug({ cask: result.caskName, appPath: result.appPath }, "previously approved (not quarantined)");
      const existing = approved.get(result.caskName) ?? [];
      existing.push({ caskName: result.caskName, appPath: result.appPath });
      approved.set(result.caskName, existing);
    } else if (result.quarantined === null) {
      log.debug({ cask: result.caskName, appPath: result.appPath }, "path not found, skipping");
    }
  }

  return approved;
}
