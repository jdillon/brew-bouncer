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
import { getLogger } from "@logtape/logtape";
import { BREW_PATH } from "./paths.ts";

const log = getLogger(["brew-bouncer", "brew"]);

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  diagnosticsIncomplete?: boolean;
}

/**
 * Format a failed subprocess result for unconditional user-facing output.
 *
 * Diagnostic logging is intentionally optional, but a command failure must
 * always explain itself. Some commands write failures to stdout, so use that
 * when stderr is empty and fall back to the exit code when both are empty.
 */
export function formatExecFailure(command: string, result: ExecResult): string {
  const detail = result.stderr.trim() || result.stdout.trim();
  const summary = `${command} exited with status ${result.exitCode}`;
  return detail ? `${summary}:\n${detail}` : `${summary} without an error message.`;
}

export async function exec(args: string[]): Promise<ExecResult> {
  log.debug("exec: brew {args}", { args: args.join(" ") });

  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    log.debug("exec: brew {args} failed (exit {exitCode}): {stderr}", {
      args: args.join(" "),
      exitCode,
      stderr: stderr.trim(),
    });
  } else {
    log.debug("exec: brew {args} ok ({bytes} bytes)", {
      args: args.join(" "),
      bytes: stdout.length,
    });
  }

  return { stdout, stderr, exitCode };
}

/** Capture redirected streams only; terminal descriptors remain inherited. */
async function execRedirected(command: string[]): Promise<ExecResult> {
  const captureOut = !process.stdout.isTTY;
  const captureErr = !process.stderr.isTTY;
  const proc = Bun.spawn(command, {
    stdin: "inherit",
    stdout: captureOut ? "pipe" : "inherit",
    stderr: captureErr ? "pipe" : "inherit",
  });
  async function forward(stream: ReadableStream<Uint8Array> | null | undefined, target: NodeJS.WriteStream): Promise<string> {
    if (!stream) return "";
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream) {
      text += decoder.decode(chunk, { stream: true });
      target.write(chunk);
    }
    return text + decoder.decode();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    forward(proc.stdout, process.stdout), forward(proc.stderr, process.stderr), proc.exited,
  ]);
  return { stdout, stderr, exitCode, diagnosticsIncomplete: !captureOut || !captureErr };
}

/**
 * A controlling PTY preserves isatty, /dev/tty prompts and echo-off passwords.
 * Forward input without recording it, and keep the caller's raw mode/flow state.
 * stdout holds the combined terminal output; stderr is not separable on a PTY.
 */
export async function execTerminal(command: string[]): Promise<ExecResult> {
  // Never turn redirected input/output into a terminal: that changes prompts,
  // isatty and EOF behavior. Mixed terminal/redirected descriptors stay mixed.
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY) {
    return execRedirected(command);
  }
  const input = process.stdin;
  const wasRaw = input.isRaw;
  const wasFlowing = input.readableFlowing;
  let stdout = "";
  const decoder = new TextDecoder();
  let endOutput!: () => void;
  const outputEnded = new Promise<void>((resolve) => { endOutput = resolve; });
  const terminalOptions: Bun.TerminalOptions = {
    name: process.env.TERM || "xterm-256color",
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    data(_terminal, data) {
      stdout += decoder.decode(data, { stream: true });
      process.stdout.write(data);
    },
    exit() { endOutput(); },
  };
  let terminal: Bun.Terminal | undefined;
  let suspend = () => {};
  const forward = (data: Buffer) => {
    let start = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] !== 0x1a) continue;
      terminal?.write(data.subarray(start, i));
      suspend();
      start = i + 1;
    }
    terminal?.write(data.subarray(start));
  };
  const resize = () => terminal?.resize(process.stdout.columns || 80, process.stdout.rows || 24);
  try {
    const proc = Bun.spawn(command, { terminal: terminalOptions });
    terminal = proc.terminal!;
    // The PTY child owns its own session/process group. Stop that group and
    // the outer foreground job together; `fg` resumes both via SIGCONT.
    const signalChild = (signal: NodeJS.Signals) => {
      try { process.kill(-proc.pid, signal); }
      catch { if (proc.exitCode === null) proc.kill(signal); }
    };
    suspend = () => {
      input.setRawMode(Boolean(wasRaw));
      signalChild("SIGSTOP");
      process.kill(process.pid, "SIGSTOP");
    };
    const resume = () => {
      input.setRawMode(true);
      resize();
      signalChild("SIGCONT");
    };
    process.on("SIGTSTP", suspend);
    process.on("SIGCONT", resume);
    input.on("data", forward);
    const endInput = () => { terminal?.write("\x04"); };
    input.once("end", endInput);
    if (input.readableEnded) endInput();
    if (input.isTTY) input.setRawMode(true);
    input.resume();
    process.stdout.on("resize", resize);
    process.on("SIGWINCH", resize);
    try {
      const exitCode = await proc.exited;
      await outputEnded;
      stdout += decoder.decode();
      return { stdout, stderr: "", exitCode };
    } finally {
      process.off("SIGTSTP", suspend);
      process.off("SIGCONT", resume);
      input.off("end", endInput);
      process.stdout.off("resize", resize);
      process.off("SIGWINCH", resize);
    }
  } finally {
    input.off("data", forward);
    if (input.isTTY) input.setRawMode(Boolean(wasRaw));
    if (wasFlowing !== true) input.pause();
    terminal?.close();
  }
}

export async function execStreaming(args: string[]): Promise<ExecResult> {
  log.debug("execStreaming: brew {args}", { args: args.join(" ") });
  return execTerminal([BREW_PATH, ...args]);
}

export async function brewUpdate(): Promise<ExecResult> {
  return exec(["update"]);
}

export async function brewInstalled(): Promise<ExecResult> {
  return exec(["info", "--installed", "--json=v2"]);
}

export async function brewOutdated(): Promise<ExecResult> {
  return exec(["outdated", "--greedy", "--json"]);
}

/**
 * Upgrade a single package with full terminal passthrough.
 * Brew owns stdout/stderr so the user sees all output including
 * prompts, caveats, and progress.
 */
export interface BrewUpgradeOptions {
  noQuit?: boolean;
}

export function brewUpgradeArgs(
  name: string,
  options: BrewUpgradeOptions = {},
): string[] {
  return ["upgrade", ...(options.noQuit ? ["--no-quit"] : []), name];
}

export async function brewUpgrade(
  name: string,
  options: BrewUpgradeOptions = {},
): Promise<ExecResult> {
  return execStreaming(brewUpgradeArgs(name, options));
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

/** Query a macOS package receipt for every installed path. */
export async function pkgutilFiles(pkgId: string): Promise<string[]> {
  log.debug("pkgutil --files {pkgId}", { pkgId });

  const filesProc = Bun.spawn(["pkgutil", "--files", pkgId], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const infoProc = Bun.spawn(["pkgutil", "--pkg-info", pkgId], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, info, exitCode, infoExitCode] = await Promise.all([
    new Response(filesProc.stdout).text(),
    new Response(infoProc.stdout).text(),
    filesProc.exited,
    infoProc.exited,
  ]);

  if (exitCode !== 0) {
    log.debug("pkgutil {pkgId} failed (exit {exitCode})", { pkgId, exitCode });
    return [];
  }

  const fields = new Map(
    info.trim().split("\n").map((line) => {
      const separator = line.indexOf(":");
      return separator === -1
        ? [line, ""]
        : [line.slice(0, separator), line.slice(separator + 1).trim()];
    })
  );
  const volume = infoExitCode === 0 ? fields.get("volume") || "/" : "/";
  const location = infoExitCode === 0 ? fields.get("location") || "" : "";
  const base = `${volume.replace(/\/+$/, "")}/${location.replace(/^\/+|\/+$/g, "")}`
    .replace(/\/+$/, "");
  const files = stdout.trim().split("\n").filter(Boolean).map((file) =>
    file.startsWith("/") ? file : `${base}/${file}`
  );
  log.debug("pkgutil {pkgId}: found {count} files", { pkgId, count: files.length });
  return files;
}
