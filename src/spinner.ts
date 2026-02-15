const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface Spinner {
  /** Update the detail line below the spinner */
  update(detail: string): void;
  /** Stop the spinner and show a final message */
  done(message?: string): void;
}

/**
 * Show an animated spinner with a title and an updating detail line.
 *
 *   ⠋ Checking running processes...
 *     gathering system state
 */
export function spinner(title: string): Spinner {
  let frame = 0;
  let detail = "";
  let stopped = false;

  const render = () => {
    // Move up 2 lines, clear both, redraw
    const symbol = FRAMES[frame % FRAMES.length];
    const detailLine = detail ? `  ${detail}` : "";
    process.stderr.write(`\x1b[?25l`); // hide cursor
    process.stderr.write(`\r\x1b[K${symbol} ${title}\n\x1b[K${detailLine}\x1b[A`);
  };

  // Initial render with blank detail line
  process.stderr.write(`\n`); // reserve detail line
  process.stderr.write(`\x1b[A`); // move back up
  render();

  const interval = setInterval(() => {
    if (stopped) return;
    frame++;
    render();
  }, 80);

  return {
    update(msg: string) {
      detail = msg;
      render();
    },
    done(message?: string) {
      if (stopped) return;
      stopped = true;
      clearInterval(interval);
      const finalMsg = message ?? title;
      // Clear both lines and write final result
      process.stderr.write(`\r\x1b[K✓ ${finalMsg}\n\x1b[K\x1b[?25h`);
    },
  };
}
