import { brewUpdate, brewOutdated } from "../brew/runner.ts";
import { parseOutdated, filterOutdated, type OutdatedPackage } from "../brew/parser.ts";
import { detectRunningUpgrades, type DetectedApp } from "../detect/matcher.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";
import chalk from "chalk";
import Table from "cli-table3";

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

  const { actionable, skipped } = filterOutdated(allOutdated, config.ignore);

  // Detect which outdated packages have running processes
  const s3 = spinner("Checking running processes...");
  const detected = await detectRunningUpgrades(actionable, (msg) => s3.update(msg));
  s3.done(`Checked ${actionable.length} packages against running processes`);

  const detectedMap = new Map(detected.map((d) => [d.packageName, d]));

  console.log("");

  const formulae = actionable.filter((p) => p.type === "formula");
  const casks = actionable.filter((p) => p.type === "cask");

  // Render package tables
  if (formulae.length > 0) {
    console.log(chalk.bold(`Outdated Formulae (${formulae.length})`));
    console.log(renderPackageTable(formulae, detectedMap));
  }

  if (casks.length > 0) {
    console.log(chalk.bold(`Outdated Casks (${casks.length})`));
    console.log(renderPackageTable(casks, detectedMap));
  }

  if (actionable.length === 0 && skipped.length > 0) {
    console.log("Everything is up to date (after filtering).");
  }

  if (skipped.length > 0) {
    console.log(chalk.dim(`Skipped (${skipped.length})`));
    for (const s of skipped) {
      console.log(chalk.dim(`  ${s.name}  (${s.skipped!.reason})`));
    }
    console.log("");
  }

  // Summary
  const parts: string[] = [];
  parts.push(`${chalk.bold(String(actionable.length))} outdated`);
  if (detectedMap.size > 0) {
    parts.push(`${chalk.yellow.bold(String(detectedMap.size))} need restart`);
  }
  if (skipped.length > 0) {
    parts.push(`${chalk.dim(String(skipped.length))} skipped`);
  }
  console.log(parts.join(chalk.dim(" · ")));
}

function renderPackageTable(
  packages: OutdatedPackage[],
  detectedMap: Map<string, DetectedApp>
): string {
  const table = new Table({
    chars: borderlessChars,
    style: { "padding-left": 1, "padding-right": 1, head: [] },
  });

  for (const pkg of packages) {
    const detected = detectedMap.get(pkg.name);
    const statusCell = detected ? formatStatus(detected) : "";

    table.push([
      chalk.white(pkg.name),
      chalk.red(shortVersion(pkg.installedVersions[0] ?? "")),
      chalk.dim("→"),
      chalk.green(shortVersion(pkg.currentVersion)),
      statusCell,
    ]);
  }

  return table.toString() + "\n";
}

/**
 * Shorten brew version strings for display.
 * Casks often use "version,build_hash" — strip the hash.
 * Truncate anything over 16 chars.
 */
function shortVersion(v: string): string {
  // Strip build hash after comma (e.g., "1.1.2321,495628f91f..." → "1.1.2321")
  const base = v.includes(",") ? v.split(",")[0]! : v;
  if (base.length > 20) return base.slice(0, 18) + "…";
  return base;
}

function formatStatus(app: DetectedApp): string {
  switch (app.kind) {
    case "cask-gui":
      return chalk.yellow("⟳ restart needed");
    case "formula-service":
      return chalk.yellow("⟳ service restart");
    case "formula-cli":
      return chalk.blue("● running");
  }
}

const borderlessChars = {
  top: "", "top-mid": "", "top-left": "", "top-right": "",
  bottom: "", "bottom-mid": "", "bottom-left": "", "bottom-right": "",
  left: "", "left-mid": "", mid: "", "mid-mid": "",
  right: "", "right-mid": "", middle: "",
};
