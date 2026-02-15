import { brewUpdateStreaming, brewOutdated, brewUpgradeStreaming } from "../brew/runner.ts";
import { parseOutdated, filterOutdated, type OutdatedPackage } from "../brew/parser.ts";
import { detectRunningUpgrades } from "../detect/matcher.ts";
import { formatReport } from "../output/reporter.ts";
import { restartApp } from "../restart.ts";
import { confirm, confirmRestart } from "../prompt.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";

interface UpgradeOptions {
  yes: boolean;
  only?: string[];
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  const config = await loadConfig();

  // Step 1: Update
  console.log("Updating Homebrew...\n");
  const updateExitCode = await brewUpdateStreaming();
  if (updateExitCode !== 0) {
    log.error("brew update failed");
    process.exit(1);
  }
  console.log("");

  // Step 2: Get outdated list
  log.debug("Running brew outdated");
  const outdatedResult = await brewOutdated();

  if (outdatedResult.exitCode !== 0 || !outdatedResult.stdout.trim()) {
    console.log("Everything is up to date.");
    return;
  }

  const allOutdated = parseOutdated(outdatedResult.stdout);
  if (allOutdated.length === 0) {
    console.log("Everything is up to date.");
    return;
  }

  const { actionable, skipped } = filterOutdated(allOutdated, config.ignore);

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
          console.log(`${name} was skipped (${wasSkipped.skipped!.reason})`);
        } else {
          console.log(`${name} is not outdated or not installed.`);
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

  // Step 3: Show what will be upgraded and confirm
  const formulae = targets.filter((p) => p.type === "formula");
  const casks = targets.filter((p) => p.type === "cask");

  console.log("The following packages will be upgraded:\n");

  if (formulae.length > 0) {
    console.log(`  Formulae (${formulae.length}):`);
    for (const f of formulae) {
      console.log(
        `    ${f.name}  ${f.installedVersions.join(", ")} -> ${f.currentVersion}`
      );
    }
    console.log("");
  }

  if (casks.length > 0) {
    console.log(`  Casks (${casks.length}):`);
    for (const c of casks) {
      console.log(
        `    ${c.name}  ${c.installedVersions.join(", ")} -> ${c.currentVersion}`
      );
    }
    console.log("");
  }

  if (skipped.length > 0 && !options.only) {
    console.log(`  Skipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`    ${s.name}  (${s.skipped!.reason})`);
    }
    console.log("");
  }

  console.log(
    `${targets.length} package(s) to upgrade.`
  );

  if (!options.yes) {
    const proceed = await confirm("Proceed with upgrade?");
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
  }

  // Step 4: Upgrade
  console.log("\nUpgrading...\n");
  const upgradeExitCode = await brewUpgradeStreaming(options.only);

  if (upgradeExitCode !== 0) {
    log.error("brew upgrade failed");
    process.exit(1);
  }

  console.log("\nDone.\n");

  // Step 5: Detect running processes
  const progressLine = (msg: string) => {
    process.stdout.write(`\r\x1b[KChecking running processes... ${msg}`);
  };
  progressLine("starting");
  const detected = await detectRunningUpgrades(targets, progressLine);
  process.stdout.write(`\r\x1b[KChecking running processes... done\n`);

  // Step 6: Report
  const report = formatReport(
    targets.length,
    formulae.length,
    casks.length,
    detected
  );
  console.log(report);

  if (detected.length === 0) return;

  // Step 7: Restart
  console.log("");

  let restartAll = options.yes;

  for (const app of detected) {
    if (restartAll) {
      process.stdout.write(`Restarting ${app.displayName}... `);
      const ok = await restartApp(app);
      console.log(ok ? "done" : "failed");
    } else {
      const choice = await confirmRestart(app.displayName);

      if (choice === "all") {
        restartAll = true;
        process.stdout.write(`Restarting ${app.displayName}... `);
        const ok = await restartApp(app);
        console.log(ok ? "done" : "failed");
      } else if (choice === "yes") {
        process.stdout.write(`Restarting ${app.displayName}... `);
        const ok = await restartApp(app);
        console.log(ok ? "done" : "failed");
      } else {
        console.log(`Skipped ${app.displayName}`);
      }
    }
  }
}
