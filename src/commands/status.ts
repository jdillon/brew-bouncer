import { brewUpdate, brewOutdated } from "../brew/runner.ts";
import { parseOutdated, filterOutdated } from "../brew/parser.ts";
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

  const { actionable, skipped } = filterOutdated(allOutdated, config.ignore);

  // Detect which outdated packages have running processes
  const s3 = spinner("Checking running processes...");
  const detected = await detectRunningUpgrades(actionable, (msg) => s3.update(msg));
  s3.done(`Checked ${actionable.length} packages against running processes`);

  const detectedMap = new Map(detected.map((d) => [d.packageName, d]));

  console.log("");

  const formulae = actionable.filter((p) => p.type === "formula");
  const casks = actionable.filter((p) => p.type === "cask");

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

  renderSkipped(skipped);
  renderSummary(actionable.length, detectedMap.size, skipped.length);
}
