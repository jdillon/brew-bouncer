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
import { pidsForExecutable, pidsInBundle, resolveBundleMainExecutable } from "./casks.ts";

function filterLivePids(pids: number[]): number[] {
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      // EPERM => process exists but we can't signal it; still alive.
      // ESRCH (and anything else) => treat as dead.
      return (err as NodeJS.ErrnoException)?.code === "EPERM";
    }
  });
}

type BundlePidScanner = (bundlePath: string) => Promise<number[]>;

interface GuiProcessScannerDependencies {
  resolveMainExecutable: (bundlePath: string) => Promise<string | undefined>;
  scanExecutable: (executablePath: string) => Promise<number[]>;
  scanBundle: BundlePidScanner;
  scanAppBundle?: BundlePidScanner;
}

export interface GuiProcessScanner {
  mode: "main" | "bundle" | "pid";
  scan: () => Promise<number[]>;
}

const defaultGuiProcessScannerDependencies: GuiProcessScannerDependencies = {
  resolveMainExecutable: resolveBundleMainExecutable,
  scanExecutable: pidsForExecutable,
  scanBundle: pidsInBundle,
  scanAppBundle: (bundlePath) => pidsInBundle(bundlePath, false),
};

/**
 * Track a declared main only after observing it. Launcher-based bundles can
 * run a different executable; preserve that evidence while excluding known
 * helper locations. Once observed, main tracking stays fixed across shutdown.
 */
export async function createGuiProcessScanner(
  trackedPids: number[],
  bundlePath?: string,
  dependencies: GuiProcessScannerDependencies = defaultGuiProcessScannerDependencies,
): Promise<GuiProcessScanner> {
  if (!bundlePath) {
    let pids = trackedPids;
    return {
      mode: "pid",
      scan: async () => {
        pids = filterLivePids(pids);
        return pids;
      },
    };
  }

  const mainExecutable = await dependencies.resolveMainExecutable(bundlePath);
  if (mainExecutable && (await dependencies.scanExecutable(mainExecutable)).length > 0) {
    return {
      mode: "main",
      scan: () => dependencies.scanExecutable(mainExecutable),
    };
  }

  return {
    mode: "bundle",
    scan: () => (mainExecutable && dependencies.scanAppBundle
      ? dependencies.scanAppBundle(bundlePath)
      : dependencies.scanBundle(bundlePath)),
  };
}
