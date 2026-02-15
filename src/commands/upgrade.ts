import { brewUpdateStreaming, brewOutdated, brewUpgradeStreaming } from "../brew/runner.ts";
import { parseOutdated, filterOutdated, type OutdatedPackage } from "../brew/parser.ts";
import { detectRunningUpgrades } from "../detect/matcher.ts";
import { formatReport } from "../output/reporter.ts";
import { restartApp } from "../restart.ts";
import { confirm, confirmRestart } from "../prompt.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import chalk from "chalk";

function shortVersion(v: string): string {
  const base = v.includes(",") ? v.split(",")[0]! : v;
  if (base.length > 20) return base.slice(0, 18) + "…";
  return base;
}

interface UpgradeOptions {
  yes: boolean;
  only?: string[];
}

export async function upgrade(options: UpgradeOptions): Promise<void> {
  const config = await loadConfig();

  // Step 1: Update
  console.log(chalk.bold("Updating Homebrew...\n"));
  const updateExitCode = await brewUpdateStreaming();
  if (updateExitCode !== 0) {
    log.error("brew update failed");
    process.exit(1);
  }
  console.log("");

  // Step 2: Get outdated list
  const s1 = spinner("Checking for outdated packages...");
  const outdatedResult = await brewOutdated();

  if (outdatedResult.exitCode !== 0 || !outdatedResult.stdout.trim()) {
    s1.done("Everything is up to date.");
    return;
  }

  const allOutdated = parseOutdated(outdatedResult.stdout);
  if (allOutdated.length === 0) {
    s1.done("Everything is up to date.");
    return;
  }
  s1.done(`${allOutdated.length} outdated packages found`);

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
          console.log(chalk.yellow(`${name} was skipped (${wasSkipped.skipped!.reason})`));
        } else {
          console.log(chalk.yellow(`${name} is not outdated or not installed.`));
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

  console.log(chalk.bold("\nThe following packages will be upgraded:\n"));

  if (formulae.length > 0) {
    console.log(chalk.bold(`  Formulae (${formulae.length}):`));
    for (const f of formulae) {
      console.log(
        `    ${chalk.white(f.name)}  ${chalk.red(shortVersion(f.installedVersions[0] ?? ""))} ${chalk.dim("→")} ${chalk.green(shortVersion(f.currentVersion))}`
      );
    }
    console.log("");
  }

  if (casks.length > 0) {
    console.log(chalk.bold(`  Casks (${casks.length}):`));
    for (const c of casks) {
      console.log(
        `    ${chalk.white(c.name)}  ${chalk.red(shortVersion(c.installedVersions[0] ?? ""))} ${chalk.dim("→")} ${chalk.green(shortVersion(c.currentVersion))}`
      );
    }
    console.log("");
  }

  if (skipped.length > 0 && !options.only) {
    console.log(chalk.dim(`  Skipped (${skipped.length}):`));
    for (const s of skipped) {
      console.log(chalk.dim(`    ${s.name}  (${s.skipped!.reason})`));
    }
    console.log("");
  }

  console.log(
    `${chalk.bold(String(targets.length))} package(s) to upgrade.`
  );

  if (!options.yes) {
    const proceed = await confirm("Proceed with upgrade?");
    if (!proceed) {
      console.log("Aborted.");
      return;
    }
  }

  // Step 4: Upgrade
  console.log(chalk.bold("\nUpgrading...\n"));
  const upgradeExitCode = await brewUpgradeStreaming(options.only);

  if (upgradeExitCode !== 0) {
    log.error("brew upgrade failed");
    process.exit(1);
  }

  console.log("");

  // Step 5: Detect running processes
  const s2 = spinner("Checking running processes...");
  const detected = await detectRunningUpgrades(targets, (msg) => s2.update(msg));
  if (detected.length === 0) {
    s2.done("No running apps or processes were affected");
  } else {
    s2.done(`${detected.length} running app(s) need restarting`);
  }

  // Step 6: Report
  console.log("");
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
