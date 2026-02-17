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
import { brewUpdate, brewOutdated, brewInfoJson } from "../brew/runner.ts";
import {
  parseOutdated,
  filterOutdated,
  parseBrewInfo,
  detectInstallerManualCasks,
} from "../brew/parser.ts";
import { detectRunningUpgrades } from "../detect/matcher.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import { renderPackageTable, renderSkipped, renderSummary } from "../output/format.ts";
import chalk from "chalk";

export async function status(): Promise<void> {
  const config = await loadConfig();

  const s1 = spinner("Updating Homebrew...");
  const updateResult = await brewUpdate();
  if (updateResult.exitCode !== 0) {
    s1.fail("brew update failed");
    log.error({ stderr: updateResult.stderr }, "brew update failed");
    process.exit(1);
  }
  s1.done("Homebrew updated");

  const s2 = spinner("Checking for outdated packages...");
  const outdatedResult = await brewOutdated();

  if (outdatedResult.exitCode !== 0 || !outdatedResult.stdout.trim()) {
    s2.done("Everything is up to date.");
    return;
  }

  const allOutdated = parseOutdated(outdatedResult.stdout);
  if (allOutdated.length === 0) {
    s2.done("Everything is up to date.");
    return;
  }
  s2.done(`${allOutdated.length} outdated packages found`);

  // Detect installer-manual casks so they show as skipped
  const caskPkgs = allOutdated.filter((p) => p.type === "cask");
  let installerManualCasks = new Set<string>();

  if (caskPkgs.length > 0) {
    const caskInfoResult = await brewInfoJson(caskPkgs.map((c) => c.name));
    if (caskInfoResult.exitCode === 0) {
      const info = parseBrewInfo(caskInfoResult.stdout);
      installerManualCasks = detectInstallerManualCasks(info.casks);
    }
  }

  const { actionable, skipped } = filterOutdated(
    allOutdated,
    config.ignore,
    installerManualCasks
  );

  // Detect which outdated packages have running processes
  const s3 = spinner("Checking running processes...");
  const detected = await detectRunningUpgrades(actionable, (msg) => s3.update(msg));
  s3.done(`Checked ${actionable.length} packages against running processes`);

  const detectedMap = new Map(detected.map((d) => [d.packageName, d]));

  console.log("");

  if (actionable.length > 0) {
    console.log(chalk.bold(`Outdated (${actionable.length})`));
    console.log(renderPackageTable(actionable, detectedMap));
  } else if (skipped.length > 0) {
    console.log("Everything is up to date (after filtering).");
  }

  renderSkipped(skipped);
  renderSummary(actionable.length, detectedMap.size, skipped.length);
}
