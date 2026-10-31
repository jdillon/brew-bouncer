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
  brewInstalled,
  brewUpdate,
  brewOutdated,
  brewUpgrade,
  brewUpgradePreview,
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
  type ExecutionContext,
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
import { collectUpgradeDiagnostics, groupDiagnostics, type DiagnosticTier, type UpgradeDiagnostic } from "../brew/diagnostics.ts";
import {
  appDisplayName,
  findStaleGrants,
  inspectPackagePermissions,
  permissionLabel,
  permissionSettingsUrl,
  type PermissionInspection,
} from "../permissions.ts";
import { installedChanges, packageKey, parseInstalled, type InstalledState } from "../brew/state.ts";
import type { OutdatedPackage } from "../brew/parser.ts";
import { parseUpgradePreview, type UpgradePreview } from "../brew/plan.ts";

interface UpgradeOptions {
  yes: boolean;
  verbose: boolean;
  only?: string[];
}

export interface UpgradeResult { exitCode: number }

const defaultUpgradeDependencies = {
  brewInstalled, brewUpdate, brewOutdated, brewUpgrade, brewUpgradePreview, brewInfoJson, exec,
  detectRunningUpgrades, inspectExecutionContext, loadConfig,
  enumeratePackageExecutables, isQuarantined, inspectPackagePermissions, findStaleGrants,
  confirmUpgrade, selectPackages, confirmRestartPolicy, confirmRestart,
  confirmQuarantinePolicy, confirmUnquarantine,
  doQuit, doReopen, doRestart, doUnquarantine,
};

/** Upgrade explicit targets using fresh running state and execution-context protection for lifecycle actions. */
const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function upgrade(
  options: UpgradeOptions,
  dependencyOverrides: Partial<typeof defaultUpgradeDependencies> = {},
): Promise<UpgradeResult> {
  const {
    brewInstalled, brewUpdate, brewOutdated, brewUpgrade, brewUpgradePreview, brewInfoJson, exec,
    detectRunningUpgrades, inspectExecutionContext, loadConfig,
    enumeratePackageExecutables, isQuarantined, inspectPackagePermissions, findStaleGrants,
    confirmUpgrade, selectPackages, confirmRestartPolicy, confirmRestart,
    confirmQuarantinePolicy, confirmUnquarantine,
    doQuit, doReopen, doRestart, doUnquarantine,
  } ={ ...defaultUpgradeDependencies, ...dependencyOverrides };
  log.debug("brew-bouncer {version}", { version: getVersion() });
  const config = await loadConfig();

  // Step 1: Update (piped + spinner, same as status)
  const s1 = spinner("Updating Homebrew...");
  const updateResult = await brewUpdate();
  if (updateResult.exitCode !== 0) {
    s1.fail("brew update failed");
    console.error(formatExecFailure("brew update", updateResult));
    return { exitCode: 1 };
  }
  s1.done("Homebrew updated");

  // Step 2: Get outdated list
  const s2 = spinner("Checking for outdated packages...");
  const outdatedResult = await brewOutdated();

  if (outdatedResult.exitCode !== 0) {
    s2.fail("brew outdated failed");
    console.error(formatExecFailure("brew outdated --greedy --json", outdatedResult));
    return { exitCode: 1 };
  }

  if (!outdatedResult.stdout.trim()) {
    s2.done("Everything is up to date.");
    return { exitCode: 0 };
  }

  const allOutdated = parseOutdated(outdatedResult.stdout);
  if (allOutdated.length === 0) {
    s2.done("Everything is up to date.");
    return { exitCode: 0 };
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
      return { exitCode: 0 };
    }
  }

  if (targets.length === 0) {
    if (skipped.length > 0) {
      renderSkipped(skipped);
    }
    console.log("Nothing to upgrade.");
    return { exitCode: 0 };
  }

  let detectedMap = new Map<string, DetectedApp>();
  let previewExecutionContext!: ExecutionContext;
  let previewExecutionAssessments = new Map<string, ExecutionTargetAssessment>();
  let packageExecutables = new Map<string, string[]>();
  let permissions: PermissionInspection = { tccReadable: true, apps: [] };
  let planningDiagnostics: UpgradeDiagnostic[] = [];

  // Resolve changes before rendering the one preview. Selection regenerates
  // both the plan and affected-process observations before approval.
  while (true) {
    const planning = spinner("Resolving Homebrew upgrade plan...");
    let plan: UpgradePreview;
    try {
      const preview = await brewUpgradePreview(targets);
      if (preview.exitCode !== 0) {
        planning.fail("Homebrew upgrade planning failed; no upgrades started");
        console.error(formatExecFailure("brew upgrade --dry-run", preview));
        return { exitCode: 1 };
      }
      plan = parseUpgradePreview(`${preview.stdout}\n${preview.stderr}`, targets, allOutdated);
      planningDiagnostics = collectUpgradeDiagnostics("Homebrew plan", preview.stdout, preview.stderr);
    } catch (error) {
      planning.fail("Homebrew upgrade planning failed; no upgrades started");
      console.error(error instanceof Error ? error.message : String(error));
      return { exitCode: 1 };
    }
    planning.done("Homebrew upgrade plan resolved");
    const selectedKeys = new Set(targets.map(packageKey));
    targets = plan.packages.filter((pkg) => selectedKeys.has(packageKey(pkg)));

    // Step 5: Detect running processes BEFORE showing preview
    const s3 = spinner("Checking running processes...");
    const preDetected = await detectRunningUpgrades(plan.packages, (msg) => s3.update(msg));
    detectedMap = new Map(preDetected.map((d) => [d.packageName, d]));
    s3.update("checking Brew Bouncer execution context");
    previewExecutionContext = await inspectExecutionContext();
    previewExecutionAssessments = new Map(
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
    packageExecutables = await enumeratePackageExecutables(
      targets,
      caskInfoParsed?.casks ?? []
    );
    const executableCount = [...packageExecutables.values()].reduce((n, paths) => n + paths.length, 0);
    if (executableCount === 0) {
      s4.done("No executables found to check for quarantine");
    } else {
      s4.done(`${executableCount} executable(s) will be checked for quarantine post-upgrade`);
    }

    // Step 5c: Privacy grants bound to the installed build's hash do not carry
    // over to the new build. Read-only: Brew Bouncer only warns and guides.
    const s5 = spinner("Checking privacy permission grants...");
    try {
      permissions = await inspectPackagePermissions(packageExecutables);
      const atRisk = permissions.apps.filter((a) => a.pinned.length > 0 || a.adhocUnverified).length;
      const unreadable = permissions.tccReadable ? "" : " (grants unreadable without Full Disk Access; checked signatures only)";
      s5.done(atRisk
        ? `${atRisk} app(s) hold privacy permissions that will likely need re-granting${unreadable}`
        : `No privacy permissions at risk${unreadable}`);
    } catch (error) {
      permissions = { tccReadable: false, apps: [] };
      s5.fail(`Privacy permission check failed: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Step 6: Show preview and confirm
    const installs = plan.packages.filter((pkg) => pkg.installedVersions.length === 0).length;
    console.log(chalk.bold(`\nThe following packages will be ${installs ? "changed" : "upgraded"} (${plan.packages.length}):\n`));
    console.log(renderPackageTable(plan.packages, detectedMap, previewExecutionAssessments, plan.reasons));
    renderExecutionContextPreview(plan.packages, detectedMap, previewExecutionAssessments);
    renderPermissionPreview(permissions);

    if (skipped.length > 0 && !options.only) {
      renderSkipped(skipped);
    }

    renderSummary(plan.packages.length - installs, detectedMap.size, skipped.length, installs);
    if (options.yes) break;
    const choice = await confirmUpgrade(
      "Proceed with upgrade?",
      config.promptDefaults.upgrade
    );
    if (choice === "no") {
      console.log("Aborted.");
      return { exitCode: 0 };
    }
    if (choice === "select") {
      targets = await selectPackages(
        targets,
        detectedMap,
        previewExecutionAssessments,
      );
      if (targets.length === 0) {
        console.log("No packages selected.");
        return { exitCode: 0 };
      }

      continue;
    }
    break;
  }

  // Step 7: Ask restart policy from the selected preview. Running state is
  // checked afresh when each package reaches the upgrade step below.
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
  let quarantinePolicy: PolicyChoice = options.yes ? "yes" : "no";
  let quarantinePolicyChosen = totalExecutableCount > 0 || options.yes;
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
  let successfulRequests = 0;
  let noVersionChangeCount = 0;
  const failedRequests: string[] = [];
  const lifecycleFailures: string[] = [];
  async function recover<T>(label: string, operation: () => Promise<T>, fallback: T): Promise<T> {
    try { return await operation(); }
    catch (error) {
      lifecycleFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return fallback;
    }
  }
  async function perform(label: string, operation: () => Promise<boolean>): Promise<boolean> {
    return recover(label, async () => {
      const ok = await operation();
      if (!ok) lifecycleFailures.push(label);
      return ok;
    }, false);
  }
  const skippedWork: string[] = [];
  const outstandingRestarts = new Set<string>();
  const probeFailures = new Set<string>();
  async function runningFor(packages: OutdatedPackage[]): Promise<DetectedApp[]> {
    try { return await detectRunningUpgrades(packages); }
    catch (error) {
      lifecycleFailures.push(`${packages.map((p) => p.name).join(", ")}: process detection failed: ${String(error)}`);
      for (const pkg of packages) { probeFailures.add(pkg.name); outstandingRestarts.add(pkg.name); }
      return [];
    }
  }
  async function contextFor(pkg: OutdatedPackage, app?: DetectedApp): Promise<ExecutionContext> {
    if (!app && !probeFailures.has(pkg.name)) {
      return { status: "known", rootPid: process.pid, frames: [], guiHosts: [],
        hints: { tmux: false }, issues: [] };
    }
    try { return await inspectExecutionContext(); }
    catch (error) {
      lifecycleFailures.push(`${pkg.name}: execution context detection failed: ${String(error)}`);
      probeFailures.add(pkg.name);
      outstandingRestarts.add(pkg.name);
      return { status: "unknown", rootPid: process.pid, frames: [], guiHosts: [],
        hints: { tmux: Boolean(process.env.TMUX) }, issues: ["execution context probe failed"] };
    }
  }
  const observedChanges = new Map<string, OutdatedPackage>();
  const dependencyUpdated = new Set<string>();
  const extraChanges = new Map<string, OutdatedPackage>();
  const targetKeys = new Set(targets.map(packageKey));
  let state: InstalledState | null = null;
  let refreshedOutdated: Set<string> | null = null;
  let observationFailed = false;
  async function readInstalled(): Promise<InstalledState | null> {
    try {
      const result = await brewInstalled();
      if (result.exitCode !== 0) throw new Error(`exit ${result.exitCode}`);
      return parseInstalled(result.stdout);
    } catch (error) {
      observationFailed = true;
      console.error(`Installed-state observation failed: ${error instanceof Error ? error.message : String(error)}; package changes may be incomplete.`);
      return null;
    }
  }
  state = await readInstalled();
  let restartedCount = 0;
  let restartSkippedCount = 0;
  let recoveredReopenCount = 0;
  let unquarantinedCount = 0;
  let quarantineCheckedCount = 0;
  let restartAll = restartPolicy === "yes";
  const diagnostics: UpgradeDiagnostic[] = [...planningDiagnostics];

  for (const pkg of targets) {
    const typeIcon = pkg.type === "cask" ? "🍷" : "🍺";
    console.log(
      chalk.bold(`${typeIcon} ${pkg.name}`) +
        chalk.dim(` ${pkg.installedVersions[0]} → ${pkg.currentVersion}`)
    );

    const alreadyUpdated = Boolean(state?.has(packageKey(pkg)) && refreshedOutdated !== null && !refreshedOutdated.has(packageKey(pkg)));
    let app = (await runningFor([pkg]))[0];
    // Old kegs may have been cleaned up. Retain preview evidence for manual
    // guidance only; it never authorizes a lifecycle action on a stale PID.
    const earlierApp = alreadyUpdated ? detectedMap.get(pkg.name) : undefined;
    const decisionContext = await contextFor(pkg, app);
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
    let restartPrompted = false;
    if (
      app &&
      decisionSafety.allowAutomaticLifecycle &&
      !isManualRestartOnly(app) &&
      restartPolicy !== "no"
    ) {
      if (restartAll) {
        restartRequested = true;
      } else {
        restartPrompted = true;
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
    // Refresh again after a per-app prompt; the first check already follows
    // global prompts and earlier upgrades. GUI quit also scans before sending
    // any quit request to catch an app that closed during these safety checks.
    const promptedApp = app;
    if (restartPrompted) app = (await runningFor([pkg]))[0];
    // Approval for one GUI bundle does not authorize lifecycle actions on a
    // different bundle or a service that appeared while the prompt was open.
    const identityChanged = Boolean(app && promptedApp && (
      app.kind !== promptedApp.kind || app.bundlePath !== promptedApp.bundlePath ||
      app.displayName !== promptedApp.displayName
    ));
    if (identityChanged) {
      restartRequested = false;
    }
    if (!app) restartRequested = false;
    const upgradeContext = await contextFor(pkg, app);
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
    const suppressHomebrewQuit = pkg.type === "cask" && (executionProtected || identityChanged || probeFailures.has(pkg.name));
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
    } else if (identityChanged && suppressHomebrewQuit) {
      console.log(chalk.yellow(
        "  Running app identity changed during confirmation; automatic restart is cancelled and Homebrew will use --no-quit.",
      ));
    }

    // Replacing a live .app can make macOS report an unexpected quit. For
    // opted-in restarts, stop it cleanly before Homebrew touches the bundle.
    let stoppedBeforeUpgrade = false;
    if (!alreadyUpdated && restartRequested && app?.kind === "cask-gui") {
      const quitApp = app;
      const failuresBeforeQuit = lifecycleFailures.length;
      const quitStatus = await recover(`${pkg.name}: quit failed`, () => doQuit(quitApp), "unknown" as GuiQuitStatus);
      stoppedBeforeUpgrade = quitStatus === "stopped";
      if (quitStatus === "already-stopped") {
        app = undefined;
        restartRequested = false;
      } else if (!stoppedBeforeUpgrade) {
        skippedWork.push(`${pkg.name}: app quit ${quitStatus}; upgrade not attempted`);
        if (lifecycleFailures.length === failuresBeforeQuit) lifecycleFailures.push(`${pkg.name}: could not quit app (${quitStatus})`);
        outstandingRestarts.add(pkg.name);
        console.log(chalk.yellow("  Upgrade skipped because the app did not quit"));
        if (quitStatus === "unknown") {
          console.log(chalk.yellow("  Running state could not be verified; check the app manually"));
        }
        console.log("");
        continue;
      }
    }

    let upgradeFailed = false;
    const before = state;
    if (alreadyUpdated) {
      if (observedChanges.has(packageKey(pkg))) {
        dependencyUpdated.add(pkg.name);
        console.log(chalk.dim("  Updated by an earlier operation; no redundant upgrade request."));
      } else {
        noVersionChangeCount++;
        console.log(chalk.dim("  No longer outdated; no upgrade request (no version change observed)."));
      }
    } else {
      try {
        const result = await brewUpgrade(pkg.name, { noQuit: suppressHomebrewQuit, type: pkg.type });
        diagnostics.push(...collectUpgradeDiagnostics(pkg.name, result.stdout, result.stderr));
        if (result.diagnosticsIncomplete) diagnostics.push({ packageName: pkg.name, level: "warning", tier: "important",
          message: "Mixed terminal/redirection: some output was displayed directly and could not be summarized; inspect the live output." });
        if (result.exitCode !== 0) {
          throw new Error(`exited with status ${result.exitCode}`);
        }
        successfulRequests++;
      } catch (error) {
        upgradeFailed = true;
        failCount++;
        const reason = error instanceof Error ? error.message : String(error);
        failedRequests.push(`${pkg.name}: ${reason}; installation/rollback outcome unverified`);
        console.error(`brew upgrade ${pkg.name}: ${reason}. Installation/rollback outcome is unverified.`);
      }

      // A failed request can still install dependencies or replace files.
      // Observe state and detect processes after every attempt, including throws.
      const observed = await readInstalled();
      // Keep the last observation through transient failures. A fresh outdated
      // list can still reconcile queued packages known to have been installed.
      state = observed ?? before;
      if (before && observed) {
        const changes = installedChanges(before, observed);
        for (const changed of changes) {
          const key = packageKey(changed);
          const observation = { ...changed,
            installedVersions: observedChanges.get(key)?.installedVersions ?? changed.installedVersions };
          observedChanges.set(key, observation);
          if (!targetKeys.has(key)) extraChanges.set(key, observation);
        }
        if (!upgradeFailed && !changes.some((changed) => packageKey(changed) === packageKey(pkg))) {
          noVersionChangeCount++;
        }
      }
      try {
        const current = await brewOutdated();
        if (current.exitCode !== 0) throw new Error(`exit ${current.exitCode}`);
        refreshedOutdated = new Set(parseOutdated(current.stdout).map(packageKey));
      } catch {
        refreshedOutdated = null;
        observationFailed = true;
        diagnostics.push({ packageName: pkg.name, level: "warning", tier: "important",
          message: "Could not refresh outdated state; remaining explicit targets will still be attempted." });
      }
      const changedPackages = before && observed ? installedChanges(before, observed) : [];
      const postApps = await runningFor([
        pkg, ...changedPackages.filter((changed) => packageKey(changed) !== packageKey(pkg)),
      ]);
      for (const changed of changedPackages) {
        if (!targetKeys.has(packageKey(changed)) && detectedMap.has(changed.name)) {
          outstandingRestarts.add(changed.name);
        }
      }
      for (const postApp of postApps) {
        const changed = changedPackages.find((p) => p.name === postApp.packageName);
        if ((changed && !targetKeys.has(packageKey(changed))) ||
            (postApp.packageName === pkg.name && !app && !stoppedBeforeUpgrade)) {
          outstandingRestarts.add(postApp.packageName);
        }
      }
      if (upgradeFailed) {
        if (stoppedBeforeUpgrade && app) {
          const recoveryTarget = app;
          if (await perform(`${pkg.name}: recovery reopen failed`, () => doReopen(recoveryTarget, true))) recoveredReopenCount++;
          else outstandingRestarts.add(pkg.name);
        } else if (app || postApps.some((a) => a.packageName === pkg.name)) {
          outstandingRestarts.add(pkg.name);
        }
        renderExecutionUpgradeFailure(pkg.name, app);
      }
    }

    // Check quarantine post-upgrade and remove per policy.
    // Done after upgrade so newly-downloaded binaries (which ship quarantined)
    // are handled, not just previously-approved ones.
    let quarantineCasks = caskInfoParsed?.casks ?? [];
    const inspectQuarantine = quarantinePolicy !== "no" || !quarantinePolicyChosen;
    if (inspectQuarantine && pkg.type === "cask") {
      quarantineCasks = await recover(`${pkg.name}: post-upgrade cask metadata refresh failed`, async () => {
        const info = await brewInfoJson([pkg.name]);
        if (info.exitCode !== 0) throw new Error(`brew info exited ${info.exitCode}`);
        return parseBrewInfo(info.stdout).casks;
      }, quarantineCasks);
    }
    const freshExecutables = inspectQuarantine
      ? await recover(`${pkg.name}: executable enumeration failed`,
        () => enumeratePackageExecutables([pkg], quarantineCasks), new Map<string, string[]>())
      : new Map<string, string[]>();
    const execPaths = [...new Set([
      ...(packageExecutables.get(pkg.name) ?? []), ...(freshExecutables.get(pkg.name) ?? []),
    ])];
    if (!quarantinePolicyChosen && execPaths.length > 0) {
      quarantinePolicy = await confirmQuarantinePolicy(execPaths.length, config.promptDefaults.quarantinePolicy);
      quarantinePolicyChosen = true;
    }
    if (quarantinePolicy !== "no") {
      for (const path of execPaths) {
        quarantineCheckedCount++;
        const quarantined = await recover(`${pkg.name}: quarantine check failed: ${path}`, () => isQuarantined(path), null);
        if (quarantined !== true) continue; // not quarantined or path gone
        if (quarantinePolicy === "yes") {
          const ok = await perform(`${pkg.name}: quarantine removal failed: ${path}`, () => doUnquarantine(path));
          if (ok) unquarantinedCount++;
        } else {
          // quarantinePolicy === "ask"
          const choice = await confirmUnquarantine(path);
          if (choice) {
            const ok = await perform(`${pkg.name}: quarantine removal failed: ${path}`, () => doUnquarantine(path));
            if (ok) unquarantinedCount++;
          }
        }
      }
    }

    // Compare stored grants with the build now on disk; this also catches a
    // signed app that changed team, and a failed upgrade that replaced files.
    for (const held of permissions.apps.filter((a) => a.packageName === pkg.name)) {
      const name = appDisplayName(held.appPath);
      if (held.adhocUnverified) {
        if (!upgradeFailed) diagnostics.push({ packageName: pkg.name, level: "warning", tier: "important",
          message: `🔐 ${name} is ad-hoc signed, so privacy permissions it held were likely reset; grants are unreadable without Full Disk Access.\n` +
            `Check: open "${permissionSettingsUrl("")}"` });
        continue;
      }
      try {
        const stale = await findStaleGrants(held);
        const byLabel = new Map(stale.map((service) => [permissionLabel(service), service]));
        for (const [label, service] of byLabel) {
          diagnostics.push({ packageName: pkg.name, level: "warning", tier: "action",
            message: `🔐 ${label} permission no longer matches the upgraded ${name}\n` +
              `Re-grant: open "${permissionSettingsUrl(service)}", then turn ${name} off and on (remove and re-add it if that does not stick)` });
        }
      } catch (error) {
        diagnostics.push({ packageName: pkg.name, level: "warning", tier: "important",
          message: `🔐 Could not check privacy permissions for ${name}: ${error instanceof Error ? error.message : String(error)}` });
      }
    }

    // On failure, recovery was handled above. Do not restart a service whose
    // rollback state is unknown. Continue quarantine and later targets.
    if (upgradeFailed) { console.log(""); continue; }
    if (alreadyUpdated && !app && earlierApp) {
      outstandingRestarts.add(pkg.name);
      console.log(chalk.yellow(`  ${pkg.name}: check earlier running process; restart manually if still running.`));
    }
    // Restart immediately if this package had a running process
    if (app) {
      if (executionProtected || identityChanged) {
        renderExecutionManualRestart(app);
        outstandingRestarts.add(pkg.name);
      } else if (isManualRestartOnly(app)) {
        const pids = app.pids.length > 0 ? ` (PID ${app.pids.join(", ")})` : "";
        console.log(chalk.dim(`  ${app.displayName}${pids}: restart manually`));
        outstandingRestarts.add(pkg.name);
      } else if (restartPolicy === "no") {
        restartSkippedCount++;
        outstandingRestarts.add(pkg.name);
      } else if (restartRequested) {
        if (app.kind === "formula-service") {
          const current = (await runningFor([pkg]))[0];
          if (probeFailures.has(pkg.name)) {
            console.log(chalk.yellow(`  ${pkg.name}: service state could not be verified; check/restart manually.`));
            continue;
          }
          if (current?.kind !== "formula-service") {
            console.log(chalk.dim(`  ${app.displayName}: service is no longer running; leaving it stopped`));
            console.log("");
            continue;
          }
          const context = await contextFor(pkg, current);
          if (!planExecutionSafety(pkg, current, context, assessExecutionTarget(current, context)).allowAutomaticLifecycle) {
            renderExecutionManualRestart(current);
            outstandingRestarts.add(pkg.name);
            console.log("");
            continue;
          }
        }
        const restartTarget = app;
        const ok = await perform(`${pkg.name}: ${stoppedBeforeUpgrade ? "reopen" : "restart"} failed`, () => stoppedBeforeUpgrade
          ? doReopen(restartTarget, true)
          : doRestart(restartTarget));
        if (ok) restartedCount++;
        else {
          outstandingRestarts.add(pkg.name);
        }
      } else {
        console.log(chalk.dim(`  Skipped ${app.displayName}`));
        restartSkippedCount++;
        outstandingRestarts.add(pkg.name);
      }
    } else if (executionProtected && suppressHomebrewQuit) {
      outstandingRestarts.add(pkg.name);
      console.log(chalk.yellow(
        `  ${pkg.name}: check for affected processes and restart them manually after Brew Bouncer exits.`,
      ));
    }

    console.log("");
  }

  // Summary
  const results: string[] = [];
  results.push(`✅ ${counted(successfulRequests, "successful upgrade request")}`);
  results.push(`📦 ${counted(observedChanges.size, "observed package version change")}`);
  if (dependencyUpdated.size) results.push(`🔗 ${counted(dependencyUpdated.size, "target")} updated by earlier operations`);
  if (noVersionChangeCount) results.push(`➖ ${noVersionChangeCount} with no version change observed`);
  if (quarantineCheckedCount) results.push(`🔍 ${counted(quarantineCheckedCount, "path")} checked for quarantine`);
  if (unquarantinedCount > 0) results.push(chalk.green(`🧼 ${unquarantinedCount} unquarantined`));
  if (restartedCount > 0) results.push(chalk.cyan(`🔄 ${restartedCount} restarted`));
  if (recoveredReopenCount > 0) results.push(`🚪 ${recoveredReopenCount} reopened after failed upgrades`);
  if (skippedWork.length) results.push(`⏩ ${skippedWork.length} skipped`);
  if (restartSkippedCount > 0) results.push(chalk.dim(`🚧 ${restartSkippedCount} restart skipped`));
  if (outstandingRestarts.size > 0) {
    results.push(chalk.dim(`👉 ${outstandingRestarts.size} manual restart/check required`));
  }
  if (failCount > 0) results.push(chalk.yellow(`❌ ${failCount} failed`));
  if (lifecycleFailures.length) results.push(`💥 ${counted(lifecycleFailures.length, "lifecycle failure")}`);
  console.log(chalk.bold("Upgrade results"));
  for (const result of results) console.log(`  ${result}`);

  for (const failure of failedRequests) console.log(chalk.red(`  Failed upgrade: ${failure}`));
  for (const failure of lifecycleFailures) console.log(chalk.red(`  Recovery failure: ${failure}`));
  for (const skipped of skippedWork) console.log(chalk.yellow(`  Skipped: ${skipped}`));
  if (dependencyUpdated.size) console.log(`  Updated by earlier operations: ${[...dependencyUpdated].join(", ")}`);
  if (extraChanges.size) console.log(`  Additional dependency changes observed: ${[...extraChanges.values()].map((p) => `${p.name} (${p.installedVersions.join(", ") || "new"} → ${p.currentVersion})`).join(", ")}`);
  if (outstandingRestarts.size) console.log(chalk.yellow(`  Manual restart/check required: ${[...outstandingRestarts].join(", ")}`));
  if (observationFailed) console.log(chalk.yellow("  Package change accounting is incomplete; inspect installed state manually."));
  renderDiagnosticsSummary(diagnostics);
  return { exitCode: failCount || lifecycleFailures.length || observationFailed ? 1 : 0 };
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

function renderPermissionPreview(permissions: PermissionInspection): void {
  const atRisk = permissions.apps.filter((a) => a.pinned.length > 0 || a.adhocUnverified);
  if (atRisk.length === 0) return;

  console.log(chalk.yellow("🔐 Privacy permissions at risk:"));
  for (const app of atRisk) {
    const detail = app.adhocUnverified
      ? "ad-hoc signed; any privacy permissions it holds will likely need re-granting"
      : `${[...new Set(app.pinned.map(permissionLabel))].join(", ")} pinned to this build; will likely need re-granting`;
    console.log(chalk.yellow(`  ${appDisplayName(app.appPath)}: ${detail}`));
  }
  console.log(chalk.dim("  Brew Bouncer confirms after the upgrade and lists how to re-grant.\n"));
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

function renderExecutionUpgradeFailure(
  packageName: string,
  app: DetectedApp | undefined,
): void {
  const target = app?.displayName ?? packageName;
  const action = app
    ? "restart it manually"
    : "check for affected processes and restart them manually";
  console.log(chalk.yellow(
    `  ${target}: Homebrew failed, so Brew Bouncer cannot confirm whether the installation changed. If it did, ${action} after Brew Bouncer exits.`,
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
  console.log(status === "already-stopped"
    ? chalk.dim("already closed; will stay closed")
    : status === "stopped" ? chalk.green("done") : chalk.red("failed"));
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

function renderDiagnosticsSummary(diagnostics: UpgradeDiagnostic[]): void {
  if (diagnostics.length === 0) return;

  console.log(chalk.bold("\nWarnings and errors"));

  let currentTier = "";
  for (const group of groupDiagnostics(diagnostics)) {
    if (group.tier !== currentTier) {
      currentTier = group.tier;
      console.log(`\n${TIER_HEADINGS[group.tier]}`);
    }
    const repeats = group.count > 1 ? chalk.dim(` (×${group.count})`) : "";
    const text = `  ${chalk.bold(group.packages.join(", "))}${repeats}\n    ${group.message.replace(/\n/g, "\n    ")}`;
    console.log(group.tier === "noise" ? chalk.dim(text) : text);
  }
}

const TIER_HEADINGS: Record<DiagnosticTier, string> = {
  action: chalk.bold.red("🛑 Action needed"),
  important: chalk.bold.yellow("⚠️  Important"),
  noise: chalk.bold.dim("💤 Noise"),
};
