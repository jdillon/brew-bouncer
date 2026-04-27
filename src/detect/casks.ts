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
  /** Absolute path to the .app bundle, when discoverable via ps */
  bundlePath?: string;
  /** PIDs whose executable lives inside this .app bundle */
  pids: number[];
}

/**
 * Get running apps using two methods:
 * 1. ps — primary source; captures PIDs and bundle paths
 * 2. osascript — supplements ps for foreground apps that don't appear there
 */
export async function getRunningApps(): Promise<RunningApp[]> {
  const [psApps, guiAppNames] = await Promise.all([
    getAppsFromProcessList(),
    getGuiAppNames(),
  ]);

  log.debug("Running apps: {ps} from ps, {gui} from osascript", {
    ps: psApps.length,
    gui: guiAppNames.length,
  });

  // Index ps results by lowercase bundleName so osascript can supplement only
  // entries that ps missed.
  const byBundle = new Map<string, RunningApp>();
  for (const app of psApps) {
    byBundle.set(app.bundleName.toLowerCase(), app);
  }

  for (const name of guiAppNames) {
    const bundleName = `${name}.app`;
    const key = bundleName.toLowerCase();
    if (byBundle.has(key)) continue;
    byBundle.set(key, { name, bundleName, pids: [] });
  }

  const merged = [...byBundle.values()];
  log.debug("Running apps after merge: {count}", { count: merged.length });
  return merged;
}

async function getGuiAppNames(): Promise<string[]> {
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

  return stdout.trim().split(", ").filter(Boolean);
}

/**
 * Scan ps output for processes running from .app bundles.
 * Captures PIDs and bundle paths so callers can target specific processes
 * by exact bundle identity rather than fuzzy name matching.
 *
 * Matches paths like:
 *   /Applications/1Password.app/Contents/MacOS/1Password
 *   /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/...
 */
async function getAppsFromProcessList(): Promise<RunningApp[]> {
  const proc = Bun.spawn(["ps", "-A", "-o", "pid=,comm="], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  await proc.exited;

  // Capture only the *outermost* .app bundle. A path like
  //   /Applications/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/...
  // should attribute to Foo.app, not "Foo Helper.app".
  const bundlePathPattern = /^(.+?\/([^/]+\.app))\//;
  const byBundlePath = new Map<string, RunningApp>();

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const spaceIdx = trimmed.indexOf(" ");
    if (spaceIdx === -1) continue;

    const pidStr = trimmed.slice(0, spaceIdx);
    const command = trimmed.slice(spaceIdx + 1);
    const pid = Number.parseInt(pidStr, 10);
    if (!Number.isFinite(pid)) continue;

    const match = command.match(bundlePathPattern);
    if (!match) continue;

    const bundlePath = match[1]!;
    const bundleName = match[2]!;

    let app = byBundlePath.get(bundlePath);
    if (!app) {
      app = {
        name: bundleName.replace(/\.app$/, ""),
        bundleName,
        bundlePath,
        pids: [],
      };
      byBundlePath.set(bundlePath, app);
    }
    app.pids.push(pid);
  }

  return [...byBundlePath.values()];
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
        log.debug(
          "Cask artifact {artifact} matched running app {app} ({pids} pids, path={path})",
          {
            artifact,
            app: app.bundleName,
            pids: app.pids.length,
            path: app.bundlePath ?? "<unknown>",
          }
        );
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
