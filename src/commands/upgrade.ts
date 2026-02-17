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
import { brewUpdate, brewOutdated, brewUpgrade, brewInfoJson, exec } from "../brew/runner.ts";
import type { TeeResult } from "../brew/runner.ts";
import {
  parseOutdated,
  filterOutdated,
  parseBrewInfo,
  detectInstallerManualCasks,
} from "../brew/parser.ts";
import { detectRunningUpgrades } from "../detect/matcher.ts";
import { restartApp } from "../restart.ts";
import { confirmUpgrade, selectPackages, confirmRestart } from "../prompt.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import { renderPackageTable, renderSkipped, renderSummary } from "../output/format.ts";
import chalk from "chalk";
import { homedir } from "node:os";
import { join } from "node:path";

interface UpgradeOptions {
  yes: boolean;
  verbose: boolean;
  only?: string[];
}

function logFilePath(): string {
  const stateDir = process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
  const date = new Date().toISOString().slice(0, 10);
  return join(stateDir, "brew-bouncer", `upgrade-${date}.log`);
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  const config = await loadConfig();

  // Step 1: Update (piped + spinner, same as status)
  const s1 = spinner("Updating Homebrew...");
  const updateResult = await brewUpdate();
  if (updateResult.exitCode !== 0) {
    s1.fail("brew update failed");
    log.error({ stderr: updateResult.stderr }, "brew update failed");
    process.exit(1);
  }
  s1.done("Homebrew updated");

  // Step 2: Get outdated list
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

  // Step 3: Fetch cask info to detect installer-manual casks
  const casks = allOutdated.filter((p) => p.type === "cask");
  let installerManualCasks = new Set<string>();

  if (casks.length > 0) {
    const caskInfoResult = await brewInfoJson(casks.map((c) => c.name));
    if (caskInfoResult.exitCode === 0) {
      const info = parseBrewInfo(caskInfoResult.stdout);
      installerManualCasks = detectInstallerManualCasks(info.casks);
    }
  }

  // Step 4: Filter
  const { actionable, skipped } = filterOutdated(
    allOutdated,
    config.ignore,
    installerManualCasks
  );

  // If specific packages requested, filter to just those
  let targets = actionable;
  if (options.only) {
    const requested = new Set(options.only.map((n) => n.toLowerCase()));
    targets = actionable.filter((p) => requested.has(p.name.toLowerCase()));

    const found = new Set(targets.map((p) => p.name.toLowerCase()));
    for (const name of options.only) {
      if (!found.has(name.toLowerCase())) {
        const wasSkipped = skipped.find(
          (s) => s.name.toLowerCase() === name.toLowerCase()
        );
        if (wasSkipped) {
          console.log(chalk.yellow(`${name} was skipped (${wasSkipped.skipped!.reason})`));
        } else {
          // Distinguish "installed but up to date" from "not installed"
          const listResult = await exec(["list", name]);
          if (listResult.exitCode === 0) {
            console.log(chalk.yellow(`${name} is already up to date.`));
          } else {
            console.log(chalk.yellow(`${name} is not installed.`));
          }
        }
      }
    }

    if (targets.length === 0) {
      console.log("Nothing to upgrade.");
      return;
    }
  }

  if (targets.length === 0) {
    console.log("Everything is up to date (after filtering).");
    return;
  }

  // Step 5: Detect running processes BEFORE showing preview
  const s3 = spinner("Checking running processes...");
  const preDetected = await detectRunningUpgrades(targets, (msg) => s3.update(msg));
  const detectedMap = new Map(preDetected.map((d) => [d.packageName, d]));
  if (preDetected.length === 0) {
    s3.done("No running apps will be affected");
  } else {
    s3.done(`${preDetected.length} running app(s) will need restarting`);
  }

  // Step 6: Show preview and confirm
  console.log(chalk.bold(`\nThe following packages will be upgraded (${targets.length}):\n`));
  console.log(renderPackageTable(targets, detectedMap));

  if (skipped.length > 0 && !options.only) {
    renderSkipped(skipped);
  }

  renderSummary(targets.length, detectedMap.size, skipped.length);

  if (!options.yes) {
    const choice = await confirmUpgrade("Proceed with upgrade?");
    if (choice === "no") {
      console.log("Aborted.");
      return;
    }
    if (choice === "select") {
      targets = await selectPackages(targets, detectedMap);
      if (targets.length === 0) {
        console.log("No packages selected.");
        return;
      }

      console.log(chalk.bold(`\nSelected for upgrade (${targets.length}):\n`));
      console.log(renderPackageTable(targets, detectedMap));
    }
  }

  // Step 7: Upgrade — pass explicit package names, never --greedy blindly
  const targetNames = targets.map((t) => t.name);
  const logFile = logFilePath();

  const upgradeResult = await runUpgrade(targetNames, logFile, options.verbose);

  if (upgradeResult.exitCode !== 0) {
    console.log(chalk.yellow("⚠ brew upgrade exited with warnings or errors"));
    console.log(chalk.dim(`  Full log: ${logFile}`));
  } else {
    console.log(chalk.green("✓ Upgrade complete"));
  }

  // Show important lines (caveats, warnings, errors) from captured output
  if ("importantLines" in upgradeResult) {
    const tee = upgradeResult as TeeResult;
    if (tee.importantLines.length > 0) {
      console.log("");
      for (const line of tee.importantLines) {
        if (/^Error:/i.test(line)) {
          console.log(chalk.red(`  ${line}`));
        } else if (/^Warning:/i.test(line) || /Not upgrading/i.test(line)) {
          console.log(chalk.yellow(`  ${line}`));
        } else {
          console.log(chalk.dim(`  ${line}`));
        }
      }
    }
  }

  // Step 8: Re-detect running processes (state may have changed after upgrade)
  console.log("");
  const s5 = spinner("Checking running processes...");
  const detected = await detectRunningUpgrades(targets, (msg) => s5.update(msg));
  if (detected.length === 0) {
    s5.done("No running apps or processes need restarting");
    return;
  }
  s5.done(`${detected.length} running app(s) need restarting`);

  // Step 9: Show what needs restarting
  console.log("");
  for (const app of detected) {
    console.log(
      `  ${chalk.yellow("⟳")} ${chalk.bold(app.displayName)}  ${chalk.dim(app.packageName)}  ${chalk.red(app.oldVersion)} ${chalk.dim("→")} ${chalk.green(app.newVersion)}`
    );
  }

  // Step 10: Restart
  console.log("");

  let restartAll = options.yes;

  for (const app of detected) {
    if (restartAll) {
      process.stdout.write(`  ${chalk.cyan("⟳")} Restarting ${chalk.bold(app.displayName)}... `);
      const ok = await restartApp(app);
      console.log(ok ? chalk.green("done") : chalk.red("failed"));
    } else {
      const choice = await confirmRestart(app.displayName);

      if (choice === "all") {
        restartAll = true;
        process.stdout.write(`  ${chalk.cyan("⟳")} Restarting ${chalk.bold(app.displayName)}... `);
        const ok = await restartApp(app);
        console.log(ok ? chalk.green("done") : chalk.red("failed"));
      } else if (choice === "yes") {
        process.stdout.write(`  ${chalk.cyan("⟳")} Restarting ${chalk.bold(app.displayName)}... `);
        const ok = await restartApp(app);
        console.log(ok ? chalk.green("done") : chalk.red("failed"));
      } else {
        console.log(chalk.dim(`  Skipped ${app.displayName}`));
      }
    }
  }
}

async function runUpgrade(
  packages: string[],
  logFile: string,
  verbose: boolean
): Promise<TeeResult | { exitCode: number }> {
  if (verbose) {
    console.log(chalk.bold("\nUpgrading...\n"));
    return brewUpgrade(packages, { logFile, verbose: true });
  }

  const s = spinner(`Upgrading ${packages.length} packages...`);
  const result = await brewUpgrade(packages, {
    logFile,
    onLine: (line) => s.update(line),
  });

  if (result.exitCode === 0) {
    s.done(`Upgraded ${packages.length} packages`);
  } else {
    s.fail(`Upgrade finished with exit code ${result.exitCode}`);
  }
  return result;
}
