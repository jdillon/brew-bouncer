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

/**
 * Run a brew command with stdout/stderr streaming directly to the terminal.
 * Use for --verbose passthrough where the user wants to see everything.
 */
export async function execStreaming(args: string[]): Promise<ExecResult> {
  log.debug("execStreaming: brew {args}", { args: args.join(" ") });

  const proc = Bun.spawn([BREW_PATH, ...args], {
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await proc.exited;

  log.debug("execStreaming: brew {args} exit {exitCode}", {
    args: args.join(" "),
    exitCode,
  });
  return { stdout: "", stderr: "", exitCode };
}

export async function brewUpdate(): Promise<ExecResult> {
  return exec(["update"]);
}

export async function brewOutdated(): Promise<ExecResult> {
  return exec(["outdated", "--greedy", "--json"]);
}

/**
 * Upgrade a single package with full terminal passthrough.
 * Brew owns stdout/stderr so the user sees all output including
 * prompts, caveats, and progress.
 */
export async function brewUpgrade(name: string): Promise<ExecResult> {
  return execStreaming(["upgrade", name]);
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
