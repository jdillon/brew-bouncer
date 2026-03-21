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
import {
  parseOutdated,
  filterOutdated,
  parseBrewInfo,
  detectInstallerManualCasks,
} from "../brew/parser.ts";
import { detectRunningUpgrades, type DetectedApp } from "../detect/matcher.ts";
import { restartApp } from "../restart.ts";
import { confirmUpgrade, selectPackages, confirmRestartPolicy, confirmRestart, confirmQuarantinePolicy, confirmUnquarantine, type PolicyChoice, type RestartPolicy } from "../prompt.ts";
import { snapshotCaskQuarantine, removeQuarantine, type QuarantineInfo } from "../quarantine.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import { renderPackageTable, renderSkipped, renderSummary } from "../output/format.ts";
import chalk from "chalk";

interface UpgradeOptions {
  yes: boolean;
  verbose: boolean;
  only?: string[];
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
  let caskInfoParsed: ReturnType<typeof parseBrewInfo> | null = null;

  if (casks.length > 0) {
    const caskInfoResult = await brewInfoJson(casks.map((c) => c.name));
    if (caskInfoResult.exitCode === 0) {
      caskInfoParsed = parseBrewInfo(caskInfoResult.stdout);
      installerManualCasks = detectInstallerManualCasks(caskInfoParsed.casks);
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
    if (skipped.length > 0) {
      renderSkipped(skipped);
    }
    console.log("Nothing to upgrade.");
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

  // Step 5b: Snapshot quarantine status for cask targets
  const caskTargets = targets.filter((p) => p.type === "cask");
  let approvedApps = new Map<string, QuarantineInfo[]>();

  if (caskTargets.length > 0 && caskInfoParsed) {
    const s4 = spinner("Checking quarantine status...");
    approvedApps = await snapshotCaskQuarantine(
      caskTargets.map((c) => c.name),
      caskInfoParsed.casks
    );
    const approvedCount = [...approvedApps.values()].reduce((n, apps) => n + apps.length, 0);
    if (approvedCount === 0) {
      s4.done("No previously-approved apps to unquarantine");
    } else {
      s4.done(`${approvedCount} previously-approved app(s) can be unquarantined`);
    }
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

  // Step 7: Ask restart policy upfront (only when running apps detected in selected targets)
  const affectedCount = targets.filter((p) => detectedMap.has(p.name)).length;
  let restartPolicy: RestartPolicy = "no";
  if (affectedCount > 0) {
    if (options.yes) {
      restartPolicy = "yes";
    } else {
      restartPolicy = await confirmRestartPolicy(affectedCount);
    }
  }

  // Step 7b: Ask quarantine policy (only when previously-approved apps in final target list)
  const approvedInTargets = targets.filter((p) => approvedApps.has(p.name));
  const approvedAppCount = approvedInTargets.reduce(
    (n, p) => n + (approvedApps.get(p.name)?.length ?? 0), 0
  );
  let quarantinePolicy: PolicyChoice = "no";
  if (approvedAppCount > 0) {
    if (options.yes) {
      quarantinePolicy = "yes";
    } else {
      quarantinePolicy = await confirmQuarantinePolicy(approvedAppCount);
    }
  }

  console.log("");

  // Step 8: Upgrade packages one at a time, restarting affected apps immediately
  console.log(chalk.bold("Upgrading...\n"));

  let failCount = 0;
  let restartedCount = 0;
  let restartSkippedCount = 0;
  let manualRestartCount = 0;
  let unquarantinedCount = 0;
  let restartAll = restartPolicy === "yes";

  for (const pkg of targets) {
    const typeIcon = pkg.type === "cask" ? "🍷" : "🍺";
    console.log(
      chalk.bold(`${typeIcon} ${pkg.name}`) +
        chalk.dim(` ${pkg.installedVersions[0]} → ${pkg.currentVersion}`)
    );

    const exitCode = await brewUpgrade(pkg.name);
    if (exitCode !== 0) {
      failCount++;
      console.log("");
      continue;
    }

    // Remove quarantine if this cask was previously approved
    const approvedList = approvedApps.get(pkg.name);
    if (approvedList && quarantinePolicy !== "no") {
      for (const approved of approvedList) {
        if (quarantinePolicy === "yes") {
          const ok = await doUnquarantine(approved);
          if (ok) unquarantinedCount++;
        } else {
          // quarantinePolicy === "ask"
          const choice = await confirmUnquarantine(approved.appPath);
          if (choice) {
            const ok = await doUnquarantine(approved);
            if (ok) unquarantinedCount++;
          }
        }
      }
    }

    // Restart immediately if this package had a running process
    const app = detectedMap.get(pkg.name);
    if (app) {
      if (isManualRestartOnly(app)) {
        const pids = app.pids.length > 0 ? ` (PID ${app.pids.join(", ")})` : "";
        console.log(chalk.dim(`  ${app.displayName}${pids}: restart manually`));
        manualRestartCount++;
      } else if (restartPolicy === "no") {
        restartSkippedCount++;
      } else if (restartAll) {
        const ok = await doRestart(app);
        if (ok) restartedCount++;
      } else {
        // restartPolicy === "ask"
        const choice = await confirmRestart(app.displayName);
        if (choice === "all") {
          restartAll = true;
          const ok = await doRestart(app);
          if (ok) restartedCount++;
        } else if (choice === "yes") {
          const ok = await doRestart(app);
          if (ok) restartedCount++;
        } else {
          console.log(chalk.dim(`  Skipped ${app.displayName}`));
          restartSkippedCount++;
        }
      }
    }

    console.log("");
  }

  // Summary
  const parts: string[] = [];
  parts.push(`${targets.length - failCount} upgraded`);
  if (failCount > 0) parts.push(chalk.yellow(`${failCount} failed`));
  if (unquarantinedCount > 0) parts.push(chalk.green(`${unquarantinedCount} unquarantined`));
  if (restartedCount > 0) parts.push(chalk.cyan(`${restartedCount} restarted`));
  if (restartSkippedCount > 0) parts.push(chalk.dim(`${restartSkippedCount} restart skipped`));
  if (manualRestartCount > 0) {
    parts.push(chalk.dim(`${manualRestartCount} manual restart required`));
  }
  console.log(parts.join(chalk.dim(" · ")));
}

function isManualRestartOnly(app: DetectedApp): boolean {
  return app.kind === "cask-cli" || app.kind === "formula-cli";
}

async function doRestart(app: DetectedApp): Promise<boolean> {
  process.stdout.write(`  ${chalk.cyan("⟳")} Restarting ${chalk.bold(app.displayName)}... `);
  const ok = await restartApp(app);
  console.log(ok ? chalk.green("done") : chalk.red("failed"));
  return ok;
}

async function doUnquarantine(info: QuarantineInfo): Promise<boolean> {
  process.stdout.write(`  ${chalk.green("🔓")} Removing quarantine from ${chalk.bold(info.appPath)}... `);
  const ok = await removeQuarantine(info.appPath);
  console.log(ok ? chalk.green("done") : chalk.red("failed"));
  return ok;
}

