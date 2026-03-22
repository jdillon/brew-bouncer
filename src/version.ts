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

import { log } from "./logger.ts";
import pkg from "../package.json";

interface BuildInfo {
  BUILD_RELEASE: boolean;
  BUILD_SHA: string;
  BUILD_BRANCH: string;
  BUILD_TIMESTAMP: string;
}

let buildInfo: BuildInfo | undefined;
try {
  buildInfo = await import("./build-info.ts");
} catch {
  // build-info.ts not generated — unstamped dev
}

function isMainBranch(branch: string): boolean {
  return branch === "main" || branch === "master" || branch === "HEAD";
}

function sanitizeBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9-]/g, "-");
}

export function getVersion(): string {
  if (!buildInfo || !buildInfo.BUILD_SHA) {
    log.warn("Build info not stamped — run 'bun run build:info' for version metadata");
    return `${pkg.version}-dev`;
  }

  if (buildInfo.BUILD_RELEASE) {
    return pkg.version;
  }

  const { BUILD_SHA, BUILD_BRANCH, BUILD_TIMESTAMP } = buildInfo;
  const branchPart = isMainBranch(BUILD_BRANCH) ? "" : `${sanitizeBranch(BUILD_BRANCH)}.`;
  return `${pkg.version}-dev+${branchPart}${BUILD_SHA} (${BUILD_TIMESTAMP})`;
}
