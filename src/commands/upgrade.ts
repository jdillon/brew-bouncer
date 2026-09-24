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
import {
  brewUpdate,
  brewOutdated,
  brewUpgrade,
  brewInfoJson,
  exec,
  formatExecFailure,
} from "../brew/runner.ts";
import {
  parseOutdated,
  filterOutdated,
  parseBrewInfo,
  detectInstallerManualCasks,
  extractCaskNonQuitUpgradeDirectives,
} from "../brew/parser.ts";
import { detectRunningUpgrades, type DetectedApp } from "../detect/matcher.ts";
import {
  assessExecutionTarget,
  inspectExecutionContext,
  type ExecutionTargetAssessment,
} from "../detect/execution-context.ts";
import {
  quitGuiApp,
  reopenGuiApp,
  restartApp,
  type GuiQuitStatus,
} from "../restart.ts";
import { confirmUpgrade, selectPackages, confirmRestartPolicy, confirmRestart, confirmQuarantinePolicy, confirmUnquarantine, type PolicyChoice, type RestartPolicy } from "../prompt.ts";
import { enumeratePackageExecutables, isQuarantined, removeQuarantine } from "../quarantine.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import { renderPackageTable, renderSkipped, renderSummary } from "../output/format.ts";
import { getVersion } from "../version.ts";
import { planExecutionSafety } from "../upgrade-policy.ts";
import chalk from "chalk";

interface UpgradeOptions {
  yes: boolean;
  verbose: boolean;
  only?: string[];
}

interface UpgradeDiagnostic {
  packageName: string;
  level: "warning" | "error";
  message: string;
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  log.debug("brew-bouncer {version}", { version: getVersion() });
  const config = await loadConfig();

  // Step 1: Update (piped + spinner, same as status)
  const s1 = spinner("Updating Homebrew...");
  const updateResult = await brewUpdate();
  if (updateResult.exitCode !== 0) {
    s1.fail("brew update failed");
    console.error(formatExecFailure("brew update", updateResult));
    process.exit(1);
  }
  s1.done("Homebrew updated");

  // Step 2: Get outdated list
  const s2 = spinner("Checking for outdated packages...");
  const outdatedResult = await brewOutdated();

  if (outdatedResult.exitCode !== 0) {
    s2.fail("brew outdated failed");
    console.error(formatExecFailure("brew outdated --greedy --json", outdatedResult));
    process.exit(1);
  }

  if (!outdatedResult.stdout.trim()) {
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
  s3.update("checking Brew Bouncer execution context");
  const previewExecutionContext = await inspectExecutionContext();
  const previewExecutionAssessments = new Map(
    preDetected.map((app) => [
      app.packageName,
      assessExecutionTarget(app, previewExecutionContext),
    ]),
  );
  const executionContextCount = [...previewExecutionAssessments.values()]
    .filter((assessment) => assessment.membership === "host").length;
  if (preDetected.length === 0) {
    s3.done("No running apps will be affected");
  } else if (previewExecutionContext.status === "unknown") {
    s3.done(`${preDetected.length} running app(s); execution context not fully verified`);
  } else if (executionContextCount > 0) {
    s3.done(`${preDetected.length} running app(s), ${executionContextCount} in Brew Bouncer's execution context`);
  } else {
    s3.done(`${preDetected.length} running app(s) will need restarting`);
  }

  // Step 5b: Enumerate executable paths for all upgrade targets.
  // Quarantine is checked post-upgrade (not pre) so executables that shipped
  // quarantined and were never manually approved still get handled.
  const s4 = spinner("Enumerating package executables...");
  const packageExecutables = await enumeratePackageExecutables(
    targets,
    caskInfoParsed?.casks ?? []
  );
  const executableCount = [...packageExecutables.values()].reduce((n, paths) => n + paths.length, 0);
  if (executableCount === 0) {
    s4.done("No executables found to check for quarantine");
  } else {
    s4.done(`${executableCount} executable(s) will be checked for quarantine post-upgrade`);
  }

  // Step 6: Show preview and confirm
  console.log(chalk.bold(`\nThe following packages will be upgraded (${targets.length}):\n`));
  console.log(renderPackageTable(targets, detectedMap, previewExecutionAssessments));
  renderExecutionContextPreview(targets, detectedMap, previewExecutionAssessments);

  if (skipped.length > 0 && !options.only) {
    renderSkipped(skipped);
  }

  renderSummary(targets.length, detectedMap.size, skipped.length);

  if (!options.yes) {
    const choice = await confirmUpgrade(
      "Proceed with upgrade?",
      config.promptDefaults.upgrade
    );
    if (choice === "no") {
      console.log("Aborted.");
      return;
    }
    if (choice === "select") {
      targets = await selectPackages(
        targets,
        detectedMap,
        previewExecutionAssessments,
      );
      if (targets.length === 0) {
        console.log("No packages selected.");
        return;
      }

      console.log(chalk.bold(`\nSelected for upgrade (${targets.length}):\n`));
      console.log(renderPackageTable(targets, detectedMap, previewExecutionAssessments));
      renderExecutionContextPreview(targets, detectedMap, previewExecutionAssessments);
    }
  }

  // Step 7: Ask restart policy upfront (only when running apps detected in selected targets)
  const affectedCount = targets.filter((pkg) => {
    const app = detectedMap.get(pkg.name);
    if (!app || isManualRestartOnly(app)) return false;
    return planExecutionSafety(
      pkg,
      app,
      previewExecutionContext,
      previewExecutionAssessments.get(pkg.name),
    ).allowAutomaticLifecycle;
  }).length;
  let restartPolicy: RestartPolicy = "no";
  if (affectedCount > 0) {
    if (options.yes) {
      restartPolicy = "yes";
    } else {
      restartPolicy = await confirmRestartPolicy(
        affectedCount,
        config.promptDefaults.restartPolicy
      );
    }
  }

  // Step 7b: Ask quarantine policy (only when final targets have known executables)
  const targetsWithExecutables = targets.filter((p) => packageExecutables.has(p.name));
  const totalExecutableCount = targetsWithExecutables.reduce(
    (n, p) => n + (packageExecutables.get(p.name)?.length ?? 0), 0
  );
  let quarantinePolicy: PolicyChoice = "no";
  if (totalExecutableCount > 0) {
    if (options.yes) {
      quarantinePolicy = "yes";
    } else {
      quarantinePolicy = await confirmQuarantinePolicy(
        totalExecutableCount,
        config.promptDefaults.quarantinePolicy
      );
    }
  }

  console.log("");

  // Step 8: Upgrade packages one at a time, safely restarting affected apps
  console.log(chalk.bold("Upgrading...\n"));

  let failCount = 0;
  let restartedCount = 0;
  let restartSkippedCount = 0;
  let manualRestartCount = 0;
  let unquarantinedCount = 0;
  let restartAll = restartPolicy === "yes";
  const diagnostics: UpgradeDiagnostic[] = [];

  for (const pkg of targets) {
    const typeIcon = pkg.type === "cask" ? "🍷" : "🍺";
    console.log(
      chalk.bold(`${typeIcon} ${pkg.name}`) +
        chalk.dim(` ${pkg.installedVersions[0]} → ${pkg.currentVersion}`)
    );

    const app = detectedMap.get(pkg.name);
    const decisionContext = await inspectExecutionContext();
    const decisionAssessment = app
      ? assessExecutionTarget(app, decisionContext)
      : undefined;
    const decisionSafety = planExecutionSafety(
      pkg,
      app,
      decisionContext,
      decisionAssessment,
    );
    let restartRequested = false;
    if (
      app &&
      decisionSafety.allowAutomaticLifecycle &&
      !isManualRestartOnly(app) &&
      restartPolicy !== "no"
    ) {
      if (restartAll) {
        restartRequested = true;
      } else {
        const choice = await confirmRestart(app.displayName);
        if (choice === "all") {
          restartAll = true;
          restartRequested = true;
        } else {
          restartRequested = choice === "yes";
        }
      }
    }

    // Recompute immediately before lifecycle or upgrade actions. If either
    // check says host/unknown, retain protection for this package; moving from
    // protected to apparently unrelated is not enough evidence to start an
    // automatic quit that the user was never asked to approve.
    const upgradeContext = await inspectExecutionContext();
    const upgradeAssessment = app
      ? assessExecutionTarget(app, upgradeContext)
      : undefined;
    const upgradeSafety = planExecutionSafety(
      pkg,
      app,
      upgradeContext,
      upgradeAssessment,
    );
    const executionProtected = decisionSafety.protected || upgradeSafety.protected;
    const suppressHomebrewQuit = pkg.type === "cask" && executionProtected;
    if (executionProtected) {
      restartRequested = false;
    }
    if (executionProtected && (app || suppressHomebrewQuit)) {
      const protectiveAssessment =
        decisionAssessment && decisionAssessment.membership !== "not-host"
          ? decisionAssessment
          : upgradeAssessment;
      renderExecutionProtection(
        pkg.name,
        app,
        protectiveAssessment,
        suppressHomebrewQuit,
        caskInfoParsed,
      );
    }

    // Replacing a live .app can make macOS report an unexpected quit. For
    // opted-in restarts, stop it cleanly before Homebrew touches the bundle.
    let stoppedBeforeUpgrade = false;
    if (restartRequested && app?.kind === "cask-gui") {
      const quitStatus = await doQuit(app);
      stoppedBeforeUpgrade = quitStatus === "stopped";
      if (!stoppedBeforeUpgrade) {
        failCount++;
        console.log(chalk.yellow("  Upgrade skipped because the app did not quit"));
        if (quitStatus === "unknown") await doReopen(app);
        console.log("");
        continue;
      }
    }

    const result = await brewUpgrade(pkg.name, { noQuit: suppressHomebrewQuit });
    diagnostics.push(...collectUpgradeDiagnostics(pkg.name, result.stdout, result.stderr));

    if (result.exitCode !== 0) {
      console.error(`brew upgrade ${pkg.name} exited with status ${result.exitCode}.`);
      failCount++;
      if (stoppedBeforeUpgrade && app) await doReopen(app, true);
      if (executionProtected && app) {
        renderExecutionUpgradeFailure(app);
      }
      console.log("");
      continue;
    }

    // Check quarantine post-upgrade and remove per policy.
    // Done after upgrade so newly-downloaded binaries (which ship quarantined)
    // are handled, not just previously-approved ones.
    const execPaths = packageExecutables.get(pkg.name);
    if (execPaths && quarantinePolicy !== "no") {
      for (const path of execPaths) {
        const quarantined = await isQuarantined(path);
        if (quarantined !== true) continue; // not quarantined or path gone
        if (quarantinePolicy === "yes") {
          const ok = await doUnquarantine(path);
          if (ok) unquarantinedCount++;
        } else {
          // quarantinePolicy === "ask"
          const choice = await confirmUnquarantine(path);
          if (choice) {
            const ok = await doUnquarantine(path);
            if (ok) unquarantinedCount++;
          }
        }
      }
    }

    // Restart immediately if this package had a running process
    if (app) {
      if (executionProtected) {
        renderExecutionManualRestart(app);
        manualRestartCount++;
      } else if (isManualRestartOnly(app)) {
        const pids = app.pids.length > 0 ? ` (PID ${app.pids.join(", ")})` : "";
        console.log(chalk.dim(`  ${app.displayName}${pids}: restart manually`));
        manualRestartCount++;
      } else if (restartPolicy === "no") {
        restartSkippedCount++;
      } else if (restartRequested) {
        const ok = stoppedBeforeUpgrade
          ? await doReopen(app, true)
          : await doRestart(app);
        if (ok) restartedCount++;
      } else {
        console.log(chalk.dim(`  Skipped ${app.displayName}`));
        restartSkippedCount++;
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

  renderDiagnosticsSummary(diagnostics);
}

function renderExecutionContextPreview(
  packages: Array<{ name: string }>,
  detectedMap: Map<string, DetectedApp>,
  assessments: Map<string, ExecutionTargetAssessment>,
): void {
  const protectedApps = packages.flatMap((pkg) => {
    const app = detectedMap.get(pkg.name);
    const assessment = assessments.get(pkg.name);
    return app && assessment && assessment.membership !== "not-host"
      ? [{ app, assessment }]
      : [];
  });
  if (protectedApps.length === 0) return;

  console.log(chalk.yellow("Execution context protection:"));
  for (const { app, assessment } of protectedApps) {
    const relation = assessment.membership === "host"
      ? app.kind === "cask-gui"
        ? "hosts Brew Bouncer"
        : "is part of Brew Bouncer's execution context"
      : "may host Brew Bouncer; detection was inconclusive";
    console.log(chalk.yellow(`  ${app.displayName} ${relation}`));
  }
  console.log(chalk.dim(
    "  These targets will stay running and require a manual restart after Brew Bouncer exits.\n",
  ));
}

function renderExecutionProtection(
  packageName: string,
  app: DetectedApp | undefined,
  assessment: ExecutionTargetAssessment | undefined,
  suppressHomebrewQuit: boolean,
  caskInfo: ReturnType<typeof parseBrewInfo> | null,
): void {
  const target = app?.displayName ?? packageName;
  const relation = assessment?.membership === "host"
    ? "is in Brew Bouncer's execution context"
    : "may be in Brew Bouncer's execution context; detection is inconclusive";
  const quitTreatment = suppressHomebrewQuit
    ? " Homebrew will be called with --no-quit."
    : "";
  console.log(chalk.yellow(
    `  ${target} ${relation}; it will not be stopped or restarted automatically.${quitTreatment}`,
  ));

  if (!suppressHomebrewQuit) return;
  const cask = caskInfo?.casks.find((candidate) => candidate.token === packageName);
  if (!cask) return;
  const directives = extractCaskNonQuitUpgradeDirectives(cask);
  if (directives.length > 0) {
    console.log(chalk.yellow(
      `  Homebrew may still run other cask uninstall actions: ${directives.join(", ")}.`,
    ));
  }
}

function renderExecutionManualRestart(app: DetectedApp): void {
  const consequence = app.kind === "cask-gui"
    ? "its app bundle was replaced while it remained running and it may misbehave until restarted"
    : "it may still be using the pre-upgrade executable";
  console.log(chalk.yellow(
    `  ${app.displayName}: restart manually after Brew Bouncer exits; ${consequence}`,
  ));
}

function renderExecutionUpgradeFailure(app: DetectedApp): void {
  console.log(chalk.yellow(
    `  ${app.displayName}: Homebrew failed, so Brew Bouncer cannot confirm whether the installation changed. If it did, restart it manually after Brew Bouncer exits.`,
  ));
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

async function doQuit(app: DetectedApp): Promise<GuiQuitStatus> {
  process.stdout.write(`  ${chalk.cyan("⟳")} Quitting ${chalk.bold(app.displayName)}... `);
  const status = await quitGuiApp(app);
  console.log(status === "stopped" ? chalk.green("done") : chalk.red("failed"));
  return status;
}

async function doReopen(
  app: DetectedApp,
  previousProcessWasStopped = false,
): Promise<boolean> {
  process.stdout.write(`  ${chalk.cyan("⟳")} Reopening ${chalk.bold(app.displayName)}... `);
  const ok = await reopenGuiApp(app, { previousProcessWasStopped });
  console.log(ok ? chalk.green("done") : chalk.red("failed"));
  return ok;
}

async function doUnquarantine(path: string): Promise<boolean> {
  process.stdout.write(`  ${chalk.green("🔓")} Removing quarantine from ${chalk.bold(path)}... `);
  const ok = await removeQuarantine(path);
  console.log(ok ? chalk.green("done") : chalk.red("failed"));
  return ok;
}

function collectUpgradeDiagnostics(
  packageName: string,
  stdout: string,
  stderr: string
): UpgradeDiagnostic[] {
  const lines = `${stdout}\n${stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const diagnostics: UpgradeDiagnostic[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const level = classifyDiagnostic(line);
    if (!level) continue;

    const key = `${level}:${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    diagnostics.push({ packageName, level, message: line });
  }

  return diagnostics;
}

function classifyDiagnostic(line: string): UpgradeDiagnostic["level"] | null {
  if (/^Warning:/.test(line)) return "warning";
  if (/^Error:/.test(line)) return "error";
  return null;
}

function renderDiagnosticsSummary(diagnostics: UpgradeDiagnostic[]): void {
  if (diagnostics.length === 0) return;

  console.log(chalk.bold("\nWarnings and errors\n"));

  let currentPackage = "";
  for (const diagnostic of diagnostics) {
    if (diagnostic.packageName !== currentPackage) {
      currentPackage = diagnostic.packageName;
      console.log(chalk.bold(diagnostic.packageName));
    }

    const icon = diagnostic.level === "error" ? chalk.red("✗") : chalk.yellow("!");
    console.log(`  ${icon} ${diagnostic.message}`);
  }
}
