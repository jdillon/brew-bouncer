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
import type { DetectedApp } from "./matcher.ts";
import { extractOutermostAppBundlePath } from "./bundles.ts";

export interface ProcessIdentity {
  pid: number;
  ppid: number;
  state: string;
  executable: string;
}

export type ExecutionFrameSource = "direct" | "tmux-client";
export type ExecutionFrameRole = "runtime" | "wrapper" | "multiplexer" | "gui-host";

export interface ExecutionFrame extends ProcessIdentity {
  source: ExecutionFrameSource;
  role: ExecutionFrameRole;
  bundlePath?: string;
  tmuxClientPid?: number;
}

export interface GuiExecutionHost {
  bundlePath: string;
  bundleName: string;
  pids: number[];
  evidence: ExecutionFrameSource[];
}

export interface ExecutionContextHints {
  termProgram?: string;
  lcTerminal?: string;
  tmux: boolean;
  tmuxPane?: string;
}

export interface ExecutionContext {
  status: "known" | "unknown";
  rootPid: number;
  frames: ExecutionFrame[];
  guiHosts: GuiExecutionHost[];
  hints: ExecutionContextHints;
  issues: string[];
}

export type ExecutionTargetMembership = "host" | "not-host" | "unknown";

export interface ExecutionTargetAssessment {
  membership: ExecutionTargetMembership;
  evidence: string[];
}

interface ExecutionContextDependencies {
  currentPid: number;
  environment: Record<string, string | undefined>;
  readProcesses: () => Promise<ProcessIdentity[]>;
  readTmuxClientPids: (
    paneId: string,
    tmuxExecutable: string,
  ) => Promise<number[]>;
}

export type ExecutionContextDependencyOverrides = Partial<ExecutionContextDependencies>;

const defaultExecutionContextDependencies: ExecutionContextDependencies = {
  currentPid: process.pid,
  environment: process.env,
  readProcesses: readSystemProcesses,
  readTmuxClientPids: readAttachedTmuxClientPids,
};

/**
 * Inspect the live ancestry of Brew Bouncer. When running under tmux, bridge
 * from the server to every client attached to the current session and inspect
 * each client's ancestry as a possible GUI host path.
 */
export async function inspectExecutionContext(
  dependencyOverrides: ExecutionContextDependencyOverrides = {},
): Promise<ExecutionContext> {
  const dependencies = {
    ...defaultExecutionContextDependencies,
    ...dependencyOverrides,
  };
  const hints = contextHints(dependencies.environment);

  let processList: ProcessIdentity[];
  try {
    processList = await dependencies.readProcesses();
  } catch (error) {
    return unknownContext(
      dependencies.currentPid,
      hints,
      `process inspection failed: ${errorMessage(error)}`,
    );
  }

  let processMap = new Map(processList.map((identity) => [identity.pid, identity]));
  let direct = traceAncestry(dependencies.currentPid, processMap);
  const issues = [...direct.issues];
  const tmuxFrame = direct.processes.find((identity) =>
    isTmuxExecutable(identity.executable)
  );
  const tmuxClientPids: number[] = [];

  if (tmuxFrame) {
    if (!hints.tmuxPane) {
      issues.push("tmux is in the process ancestry but TMUX_PANE is unavailable");
    } else {
      try {
        tmuxClientPids.push(
          ...await dependencies.readTmuxClientPids(
            hints.tmuxPane,
            executableForTmuxClient(tmuxFrame.executable),
          ),
        );
      } catch (error) {
        issues.push(`tmux client inspection failed: ${errorMessage(error)}`);
      }

      if (tmuxClientPids.length === 0 && issues.length === direct.issues.length) {
        issues.push("the current tmux session has no attached clients");
      }
    }
  }

  // Client PIDs may change while tmux is queried. Re-read the process table and
  // rebuild every branch so stale PIDs never become authoritative identities.
  if (tmuxClientPids.length > 0) {
    try {
      processList = await dependencies.readProcesses();
      processMap = new Map(processList.map((identity) => [identity.pid, identity]));
      direct = traceAncestry(dependencies.currentPid, processMap);
      issues.push(...direct.issues);
    } catch (error) {
      issues.push(`process revalidation failed: ${errorMessage(error)}`);
    }
  }

  const frames = toFrames(direct.processes, "direct", dependencies.currentPid);
  for (const clientPid of new Set(tmuxClientPids)) {
    const client = traceAncestry(clientPid, processMap);
    issues.push(...client.issues.map((issue) => `tmux client ${clientPid}: ${issue}`));
    frames.push(...toFrames(client.processes, "tmux-client", dependencies.currentPid, clientPid));
  }

  const uniqueIssues = [...new Set(issues)];
  const context: ExecutionContext = {
    status: uniqueIssues.length === 0 ? "known" : "unknown",
    rootPid: dependencies.currentPid,
    frames,
    guiHosts: collectGuiHosts(frames),
    hints,
    issues: uniqueIssues,
  };

  return context;
}

/** Match one detected upgrade target against a freshly inspected context. */
export function assessExecutionTarget(
  app: DetectedApp,
  context: ExecutionContext,
): ExecutionTargetAssessment {
  const targetPids = new Set(app.pids);
  const targetBundlePath = app.bundlePath
    ? normalizeBundlePath(app.bundlePath)
    : undefined;
  const executablePaths = new Set(app.executablePaths ?? []);

  for (const frame of context.frames) {
    if (
      targetBundlePath &&
      frame.bundlePath &&
      normalizeBundlePath(frame.bundlePath) === targetBundlePath
    ) {
      const evidence = [`bundle ${targetBundlePath}`, `${frame.source} ancestry`];
      if (targetPids.has(frame.pid)) evidence.push(`PID ${frame.pid}`);
      return { membership: "host", evidence };
    }

    if (executablePaths.has(frame.executable)) {
      const evidence = [`executable ${frame.executable}`, `${frame.source} ancestry`];
      if (targetPids.has(frame.pid)) evidence.push(`PID ${frame.pid}`);
      return { membership: "host", evidence };
    }
  }

  // Some GUI apps are detected only through System Events and have no path or
  // PID. A matching bundle name from current ancestry is sufficient to protect
  // it from an automatic quit, even though it cannot prove an install location.
  if (!targetBundlePath && app.kind === "cask-gui") {
    const nameMatch = context.guiHosts.find(
      (host) => host.bundleName.toLowerCase() === app.displayName.toLowerCase(),
    );
    if (nameMatch) {
      return {
        membership: "host",
        evidence: [`bundle name ${nameMatch.bundleName}`, ...nameMatch.evidence],
      };
    }
  }

  // A PID match without executable or bundle identity may be recycled. It is
  // enough to make the result uncertain, never enough to assert host identity.
  if (context.frames.some((frame) => targetPids.has(frame.pid))) {
    return {
      membership: "unknown",
      evidence: ["PID matched but executable identity could not be revalidated"],
    };
  }

  if (context.status === "unknown") {
    return {
      membership: "unknown",
      evidence: context.issues,
    };
  }

  return { membership: "not-host", evidence: [] };
}

export function parseProcessIdentities(output: string): ProcessIdentity[] {
  const identities: ProcessIdentity[] = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/);
    if (!match) continue;
    const pid = Number.parseInt(match[1]!, 10);
    const ppid = Number.parseInt(match[2]!, 10);
    const state = match[3]!;
    const executable = match[4]!;
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || state.startsWith("Z")) {
      continue;
    }
    identities.push({ pid, ppid, state, executable });
  }
  return identities;
}

async function readSystemProcesses(): Promise<ProcessIdentity[]> {
  const proc = Bun.spawn(
    ["ps", "-ww", "-A", "-o", "pid=,ppid=,state=,comm="],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `ps exited ${exitCode}`);
  }
  return parseProcessIdentities(stdout);
}

async function readAttachedTmuxClientPids(
  paneId: string,
  tmuxExecutable: string,
): Promise<number[]> {
  if (!/^%\d+$/.test(paneId)) {
    throw new Error(`invalid TMUX_PANE value ${JSON.stringify(paneId)}`);
  }

  const session = await runTmux([
    tmuxExecutable,
    "display-message",
    "-p",
    "-t",
    paneId,
    "#{session_id}",
  ]);
  const sessionId = session.trim();
  if (!/^\$\d+$/.test(sessionId)) {
    throw new Error(`tmux returned invalid session id ${JSON.stringify(sessionId)}`);
  }

  const clients = await runTmux([
    tmuxExecutable,
    "list-clients",
    "-t",
    sessionId,
    "-F",
    "#{client_pid}",
  ]);
  return [...new Set(
    clients.split("\n")
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0),
  )];
}

async function runTmux(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${args.slice(0, 2).join(" ")} exited ${exitCode}`);
  }
  return stdout;
}

function traceAncestry(
  startPid: number,
  processes: Map<number, ProcessIdentity>,
): { processes: ProcessIdentity[]; issues: string[] } {
  const ancestry: ProcessIdentity[] = [];
  const visited = new Set<number>();
  let pid = startPid;

  while (pid > 0) {
    if (visited.has(pid)) {
      return { processes: ancestry, issues: [`process ancestry contains a cycle at PID ${pid}`] };
    }
    visited.add(pid);

    const identity = processes.get(pid);
    if (!identity) {
      return { processes: ancestry, issues: [`PID ${pid} disappeared during inspection`] };
    }
    ancestry.push(identity);

    if (identity.pid === 1 || identity.ppid === 0) {
      return { processes: ancestry, issues: [] };
    }
    pid = identity.ppid;
  }

  return { processes: ancestry, issues: [] };
}

function toFrames(
  identities: ProcessIdentity[],
  source: ExecutionFrameSource,
  currentPid: number,
  tmuxClientPid?: number,
): ExecutionFrame[] {
  return identities.map((identity) => {
    const bundlePath = extractOutermostAppBundlePath(identity.executable);
    let role: ExecutionFrameRole = "wrapper";
    if (identity.pid === currentPid) role = "runtime";
    else if (isTmuxExecutable(identity.executable)) role = "multiplexer";
    else if (bundlePath) role = "gui-host";

    return {
      ...identity,
      source,
      role,
      bundlePath,
      tmuxClientPid,
    };
  });
}

function collectGuiHosts(frames: ExecutionFrame[]): GuiExecutionHost[] {
  const hosts = new Map<string, {
    bundleName: string;
    pids: Set<number>;
    evidence: Set<ExecutionFrameSource>;
  }>();

  for (const frame of frames) {
    if (!frame.bundlePath) continue;
    const current = hosts.get(frame.bundlePath) ?? {
      bundleName: frame.bundlePath.split("/").pop()!,
      pids: new Set<number>(),
      evidence: new Set<ExecutionFrameSource>(),
    };
    current.pids.add(frame.pid);
    current.evidence.add(frame.source);
    hosts.set(frame.bundlePath, current);
  }

  return [...hosts.entries()].map(([bundlePath, host]) => ({
    bundlePath,
    bundleName: host.bundleName,
    pids: [...host.pids].sort((a, b) => a - b),
    evidence: [...host.evidence],
  }));
}

function contextHints(
  environment: Record<string, string | undefined>,
): ExecutionContextHints {
  return {
    termProgram: environment.TERM_PROGRAM,
    lcTerminal: environment.LC_TERMINAL,
    tmux: Boolean(environment.TMUX),
    tmuxPane: environment.TMUX_PANE,
  };
}

function unknownContext(
  rootPid: number,
  hints: ExecutionContextHints,
  issue: string,
): ExecutionContext {
  return {
    status: "unknown",
    rootPid,
    frames: [],
    guiHosts: [],
    hints,
    issues: [issue],
  };
}

function normalizeBundlePath(path: string): string {
  return path.replace(/\/+$/, "");
}

function isTmuxExecutable(executable: string): boolean {
  const basename = executable.split("/").pop() ?? executable;
  return basename === "tmux" || basename.startsWith("tmux:");
}

function executableForTmuxClient(executable: string): string {
  return executable.endsWith("/tmux") || executable === "tmux" ? executable : "tmux";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
