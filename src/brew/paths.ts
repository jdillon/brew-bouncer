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

/**
 * Homebrew install locations.
 *
 * Detection order (first match wins):
 *  1. `HOMEBREW_PREFIX` env var — respects custom installs
 *  2. `/opt/homebrew` — standard on Apple Silicon
 *  3. `/usr/local` — standard on Intel Macs (and some custom setups)
 *  4. `brew` resolved on the caller's PATH
 *
 * Throws at module load if none of the above contain a `bin/brew` binary.
 * Detection is synchronous so these can be exported as plain constants —
 * every file in the codebase can import them without awaiting anything.
 */
import { existsSync } from "node:fs";
import { dirname } from "node:path";

function resolveFromPath(): string | null {
  // Bun.spawnSync is available in Bun runtime and in compiled binaries.
  const result = Bun.spawnSync(["/usr/bin/env", "which", "brew"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const path = result.stdout.toString().trim();
  return path || null;
}

function detectHomebrewPrefix(): { prefix: string; brewPath: string } {
  const candidates: string[] = [];

  const envPrefix = process.env.HOMEBREW_PREFIX;
  if (envPrefix) candidates.push(envPrefix);

  candidates.push("/opt/homebrew", "/usr/local");

  for (const prefix of candidates) {
    const brewPath = `${prefix}/bin/brew`;
    if (existsSync(brewPath)) {
      return { prefix, brewPath };
    }
  }

  // Fall back to PATH lookup — handles custom installs that don't set
  // HOMEBREW_PREFIX and live outside the standard locations.
  const pathBrew = resolveFromPath();
  if (pathBrew && existsSync(pathBrew)) {
    // Assume a standard layout: <prefix>/bin/brew
    const prefix = dirname(dirname(pathBrew));
    return { prefix, brewPath: pathBrew };
  }

  throw new Error(
    "Could not locate Homebrew. Set HOMEBREW_PREFIX or add brew to PATH."
  );
}

const detected = detectHomebrewPrefix();

/**
 * The Homebrew install prefix (e.g. `/opt/homebrew` or `/usr/local`).
 */
export const HOMEBREW_PREFIX: string = detected.prefix;

/**
 * Absolute path to the `brew` binary.
 */
export const BREW_PATH: string = detected.brewPath;

/**
 * The bin directory where formula symlinks and cask `binary` artifacts live.
 */
export const HOMEBREW_BIN: string = `${HOMEBREW_PREFIX}/bin`;
