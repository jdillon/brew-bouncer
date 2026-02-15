import { brewUpdate, brewOutdated } from "../brew/runner.ts";
import { parseOutdated, filterOutdated } from "../brew/parser.ts";
import { detectRunningUpgrades, type DetectedApp } from "../detect/matcher.ts";
import { loadConfig } from "../config.ts";
import { log } from "../logger.ts";
import { spinner } from "../spinner.ts";

export async function status(): Promise<void> {
  const config = await loadConfig();

  const s1 = spinner("Updating Homebrew...");
  const updateResult = await brewUpdate();
  if (updateResult.exitCode !== 0) {
    s1.done("Updating Homebrew... failed");
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
  const runningSet = new Set(detected.map((d) => d.packageName));

  console.log("");

  const formulae = actionable.filter((p) => p.type === "formula");
  const casks = actionable.filter((p) => p.type === "cask");

  if (formulae.length > 0) {
    console.log(`Outdated formulae (${formulae.length}):`);
    for (const f of formulae) {
      const tag = runningSet.has(f.name) ? restartTag(detected, f.name) : "";
      console.log(
        `  ${f.name}  ${f.installedVersions.join(", ")} -> ${f.currentVersion}${tag}`
      );
    }
    console.log("");
  }

  if (casks.length > 0) {
    console.log(`Outdated casks (${casks.length}):`);
    for (const c of casks) {
      const tag = runningSet.has(c.name) ? restartTag(detected, c.name) : "";
      console.log(
        `  ${c.name}  ${c.installedVersions.join(", ")} -> ${c.currentVersion}${tag}`
      );
    }
    console.log("");
  }

  if (actionable.length === 0 && skipped.length > 0) {
    console.log("Everything is up to date (after filtering).");
  }

  if (skipped.length > 0) {
    console.log(`Skipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ${s.name}  (${s.skipped!.reason})`);
    }
    console.log("");
  }

  if (runningSet.size > 0) {
    console.log(
      `${runningSet.size} running app(s) will need restart after upgrade.`
    );
  }
}

function restartTag(detected: DetectedApp[], packageName: string): string {
  const match = detected.find((d) => d.packageName === packageName);
  if (!match) return "";

  const labels: Record<DetectedApp["kind"], string> = {
    "cask-gui": "restart needed",
    "formula-cli": "running",
    "formula-service": "service restart needed",
  };

  return `  ← ${labels[match.kind]}`;
}
