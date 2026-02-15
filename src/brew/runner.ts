import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface TeeResult {
  exitCode: number;
  logFile: string;
  /** Lines matching warning/error/caveat patterns */
  importantLines: string[];
}

export type TeeProgress = (line: string) => void;

const BREW_PATH = "/opt/homebrew/bin/brew";

export async function exec(args: string[]): Promise<ExecResult> {
  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Run a brew command with stdout/stderr streaming directly to the terminal.
 * Use for --verbose passthrough where the user wants to see everything.
 */
export async function execStreaming(args: string[]): Promise<number> {
  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc.exited;
}

/**
 * Important line patterns that should be surfaced to the user
 * even when brew output is hidden behind a spinner.
 */
const IMPORTANT_PATTERNS = [
  /^Error:/i,
  /^Warning:/i,
  /^==> Caveats$/,
  /^==> .*caveat/i,
  /already installed/i,
  /Not upgrading/i,
  /Download failed/i,
  /sha256 mismatch/i,
];

const CAVEAT_END = /^==>/; // Next section header ends caveat block

/**
 * Run a brew command, capture full output to a log file, and surface
 * important lines (errors, warnings, caveats) via callback.
 *
 * This is the default mode for brew upgrade — shows a spinner while
 * capturing everything. Use execStreaming for --verbose passthrough.
 */
export async function execTee(
  args: string[],
  opts: { logFile: string; onLine?: TeeProgress }
): Promise<TeeResult> {
  mkdirSync(dirname(opts.logFile), { recursive: true });

  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const importantLines: string[] = [];
  let inCaveatBlock = false;

  async function processStream(
    stream: ReadableStream<Uint8Array>,
    prefix: string
  ) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);

        appendFileSync(opts.logFile, `${prefix}${line}\n`);

        // Track caveat blocks (multi-line)
        if (/^==> Caveats$/.test(line)) {
          inCaveatBlock = true;
          importantLines.push(line);
          opts.onLine?.(line);
          continue;
        }
        if (inCaveatBlock) {
          if (CAVEAT_END.test(line) && !/Caveats/.test(line)) {
            inCaveatBlock = false;
          } else {
            importantLines.push(line);
            continue;
          }
        }

        // Check for important patterns
        if (IMPORTANT_PATTERNS.some((p) => p.test(line))) {
          importantLines.push(line);
          opts.onLine?.(line);
        }
      }
    }

    // Flush remaining buffer
    if (buffer.length > 0) {
      appendFileSync(opts.logFile, `${prefix}${buffer}\n`);
    }
  }

  // Write header to log
  const timestamp = new Date().toISOString();
  appendFileSync(opts.logFile, `\n--- brew ${args.join(" ")} [${timestamp}] ---\n`);

  await Promise.all([
    processStream(proc.stdout as ReadableStream<Uint8Array>, ""),
    processStream(proc.stderr as ReadableStream<Uint8Array>, "[stderr] "),
  ]);

  const exitCode = await proc.exited;

  appendFileSync(opts.logFile, `--- exit ${exitCode} ---\n`);

  return { exitCode, logFile: opts.logFile, importantLines };
}

export async function brewUpdate(): Promise<ExecResult> {
  return exec(["update"]);
}

export async function brewOutdated(): Promise<ExecResult> {
  return exec(["outdated", "--greedy", "--json"]);
}

/**
 * Run brew upgrade with explicit package names and output capture.
 * Always pass the exact list of packages to upgrade — never --greedy
 * without a package list, to ensure only previewed packages are upgraded.
 */
export async function brewUpgrade(
  packages: string[],
  opts: { logFile: string; onLine?: TeeProgress; verbose?: boolean }
): Promise<TeeResult | { exitCode: number }> {
  const args = ["upgrade", ...packages];

  if (opts.verbose) {
    const exitCode = await execStreaming(args);
    return { exitCode };
  }

  return execTee(args, { logFile: opts.logFile, onLine: opts.onLine });
}

export async function brewInfoJson(names: string[]): Promise<ExecResult> {
  return exec(["info", "--json=v2", ...names]);
}

export async function brewList(formula: string): Promise<ExecResult> {
  return exec(["list", formula]);
}

export async function brewServicesList(): Promise<ExecResult> {
  return exec(["services", "list"]);
}

/**
 * Query macOS pkg receipt for installed files.
 * Returns top-level .app bundle names found in the receipt.
 */
export async function pkgutilAppNames(pkgId: string): Promise<string[]> {
  const proc = Bun.spawn(["pkgutil", "--files", pkgId], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) return [];

  // Find top-level .app entries (e.g., "zoom.us.app" not nested ones)
  const apps: string[] = [];
  for (const line of stdout.trim().split("\n")) {
    if (/^[^/]+\.app$/.test(line)) {
      apps.push(line);
    }
  }

  return apps;
}
