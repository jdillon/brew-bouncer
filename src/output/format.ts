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
import type { OutdatedPackage } from "../brew/parser.ts";
import type { DetectedApp } from "../detect/matcher.ts";
import chalk from "chalk";
import Table from "cli-table3";

/**
 * Shorten brew version strings for display.
 * Casks often use "version,build_hash" — strip the hash.
 */
export function shortVersion(v: string): string {
  const base = v.includes(",") ? v.split(",")[0]! : v;
  if (base.length > 20) return base.slice(0, 18) + "…";
  return base;
}

export function formatStatus(app: DetectedApp): string {
  switch (app.kind) {
    case "cask-gui":
      return chalk.yellow("⟳ restart needed");
    case "formula-service":
      return chalk.yellow("⟳ service restart");
    case "cask-cli":
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

/**
 * Render a package table with optional restart status annotations.
 */
export function renderPackageTable(
  packages: OutdatedPackage[],
  detectedMap?: Map<string, DetectedApp>
): string {
  const table = new Table({
    chars: borderlessChars,
    style: { "padding-left": 1, "padding-right": 1, head: [] },
  });

  for (const pkg of packages) {
    const detected = detectedMap?.get(pkg.name);
    const statusCell = detected ? formatStatus(detected) : "";
    const typeIcon = pkg.type === "cask" ? "🍷" : "🍺";

    table.push([
      typeIcon,
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
 * Render the skipped packages list.
 */
export function renderSkipped(skipped: OutdatedPackage[]): void {
  if (skipped.length === 0) return;
  console.log(chalk.dim(`Skipped (${skipped.length})`));
  for (const s of skipped) {
    console.log(chalk.dim(`  ${s.name}  (${s.skipped!.reason})`));
  }
  console.log("");
}

/**
 * Render a summary line: "14 outdated · 6 need restart · 2 skipped"
 */
export function renderSummary(
  actionableCount: number,
  restartCount: number,
  skippedCount: number
): void {
  const parts: string[] = [];
  parts.push(`${chalk.bold(String(actionableCount))} to upgrade`);
  if (restartCount > 0) {
    parts.push(`${chalk.yellow.bold(String(restartCount))} need restart`);
  }
  if (skippedCount > 0) {
    parts.push(`${chalk.dim(String(skippedCount))} skipped`);
  }
  console.log(parts.join(chalk.dim(" · ")));
}
