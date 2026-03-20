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
 */
async function isQuarantined(path: string): Promise<boolean> {
  const proc = Bun.spawn(["xattr", "-p", "com.apple.quarantine", path], {
    stdout: "pipe",
    stderr: "pipe",
  });

  await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  // exit 0 = attribute exists (quarantined), non-zero = no attribute
  return exitCode === 0;
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
): Promise<Map<string, QuarantineInfo>> {
  const approved = new Map<string, QuarantineInfo>();

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
    if (!result.quarantined) {
      log.debug({ cask: result.caskName, appPath: result.appPath }, "previously approved (not quarantined)");
      approved.set(result.caskName, {
        caskName: result.caskName,
        appPath: result.appPath,
      });
    }
  }

  return approved;
}
