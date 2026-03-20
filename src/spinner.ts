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
import chalk from "chalk";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  /** Update the detail line below the spinner */
  update(detail: string): void;
  /** Stop the spinner and show a final message (green checkmark) */
  done(message?: string): void;
  /** Stop the spinner and show a failure message (red cross) */
  fail(message?: string): void;
}

/**
 * Show an animated spinner with a title and an updating detail line.
 *
 *   ⠋ Checking running processes...
 *     gathering system state
 *
 * Resolves to:
 *   ✓ 12 packages checked, 6 need restart
 */
export function spinner(title: string): Spinner {
  let frame = 0;
  let detail = "";
  let stopped = false;

  const render = () => {
    const cols = process.stderr.columns || 80;
    const symbol = chalk.cyan(FRAMES[frame % FRAMES.length]);
    // Truncate detail to fit in one terminal line (2 chars indent + content)
    const maxDetail = cols - 4;
    const truncated = detail.length > maxDetail
      ? detail.slice(0, maxDetail - 1) + "…"
      : detail;
    const detailLine = truncated ? `  ${chalk.dim(truncated)}` : "";
    process.stderr.write(`\x1b[?25l`); // hide cursor
    process.stderr.write(`\r\x1b[K${symbol} ${title}\n\x1b[K${detailLine}\x1b[A`);
  };

  // Reserve detail line and position cursor
  process.stderr.write(`\n\x1b[A`);
  render();

  const interval = setInterval(() => {
    if (stopped) return;
    frame++;
    render();
  }, 80);

  const stop = (symbol: string, message: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    // Clear both lines, write final single line, show cursor
    process.stderr.write(`\r\x1b[K${symbol} ${message}\n\x1b[K\x1b[?25h`);
  };

  return {
    update(msg: string) {
      detail = msg;
    },
    done(message?: string) {
      stop(chalk.green("✓"), message ?? title.replace(/\.{3}$/, ""));
    },
    fail(message?: string) {
      stop(chalk.red("✗"), message ?? title.replace(/\.{3}$/, " failed"));
    },
  };
}
