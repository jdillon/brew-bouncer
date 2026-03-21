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

const log = getLogger(["brew-bouncer", "detect", "casks"]);

export interface RunningApp {
  name: string;
  bundleName: string;
}

/**
 * Get running apps using two methods:
 * 1. osascript — catches foreground GUI apps by display name
 * 2. ps — catches all processes, matched by .app bundle path
 *
 * Combined, this catches apps that run as background-only (1Password, Docker)
 * or that don't appear in System Events (menu bar apps, agents).
 */
export async function getRunningApps(): Promise<RunningApp[]> {
  const [guiApps, psApps] = await Promise.all([
    getGuiApps(),
    getAppsFromProcessList(),
  ]);

  log.debug("Running apps: {gui} from osascript, {ps} from ps", {
    gui: guiApps.length,
    ps: psApps.length,
  });

  // Merge, deduplicating by bundleName (case-insensitive)
  const seen = new Set<string>();
  const merged: RunningApp[] = [];

  for (const app of [...guiApps, ...psApps]) {
    const key = app.bundleName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(app);
    }
  }

  log.debug("Running apps after dedup: {count}", { count: merged.length });
  return merged;
}

async function getGuiApps(): Promise<RunningApp[]> {
  const proc = Bun.spawn(
    [
      "osascript",
      "-e",
      'tell application "System Events" to get name of every process whose background only is false',
    ],
    { stdout: "pipe", stderr: "pipe" }
  );

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  return stdout
    .trim()
    .split(", ")
    .filter(Boolean)
    .map((name) => ({
      name,
      bundleName: `${name}.app`,
    }));
}

/**
 * Scan ps output for processes running from .app bundles.
 * Matches paths like /Applications/1Password.app/Contents/MacOS/1Password
 * and ~/Applications/Docker.app/Contents/MacOS/Docker
 */
async function getAppsFromProcessList(): Promise<RunningApp[]> {
  const proc = Bun.spawn(["ps", "axo", "comm"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  const appBundlePattern = /\/([^/]+\.app)\//;
  const seen = new Set<string>();
  const apps: RunningApp[] = [];

  for (const line of stdout.trim().split("\n")) {
    const match = line.match(appBundlePattern);
    if (!match) continue;

    const bundleName = match[1]!;
    const key = bundleName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    apps.push({
      name: bundleName.replace(/\.app$/, ""),
      bundleName,
    });
  }

  return apps;
}

export function matchCaskToRunningApps(
  appArtifacts: string[],
  runningApps: RunningApp[]
): RunningApp[] {
  const matched: RunningApp[] = [];

  for (const artifact of appArtifacts) {
    const artifactBase = artifact.replace(/\.app$/, "").toLowerCase();
    let found = false;

    for (const app of runningApps) {
      if (
        app.name.toLowerCase() === artifactBase ||
        app.bundleName.toLowerCase() === artifact.toLowerCase()
      ) {
        log.debug("Cask artifact {artifact} matched running app {app}", {
          artifact,
          app: app.bundleName,
        });
        matched.push(app);
        found = true;
        break; // one match per artifact is enough
      }
    }

    if (!found) {
      log.debug("Cask artifact {artifact} not running", { artifact });
    }
  }

  return matched;
}
