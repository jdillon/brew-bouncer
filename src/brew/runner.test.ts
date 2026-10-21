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
import { expect, test } from "bun:test";
import { brewUpgradeArgs, execTerminal, formatExecFailure } from "./runner.ts";

test("formatExecFailure includes stderr", () => {
  expect(formatExecFailure("brew update", {
    stdout: "",
    stderr: "fatal: unable to access remote\n",
    exitCode: 1,
  })).toBe("brew update exited with status 1:\nfatal: unable to access remote");
});

test("formatExecFailure uses stdout when stderr is empty", () => {
  expect(formatExecFailure("brew update", {
    stdout: "update failed\n",
    stderr: "",
    exitCode: 2,
  })).toBe("brew update exited with status 2:\nupdate failed");
});

test("formatExecFailure always provides an exit-code reason", () => {
  expect(formatExecFailure("brew update", {
    stdout: "",
    stderr: "",
    exitCode: 3,
  })).toBe("brew update exited with status 3 without an error message.");
});

test("brewUpgradeArgs adds --no-quit only when requested", () => {
  expect(brewUpgradeArgs("cmux")).toEqual(["upgrade", "cmux"]);
  expect(brewUpgradeArgs("cmux", { noQuit: true })).toEqual([
    "upgrade",
    "--no-quit",
    "cmux",
  ]);
});

// Harmless commands only: these exercise the real macOS terminal forwarding.
test.skipIf(process.platform !== "darwin")("redirected recording preserves nonterminal descriptors, both streams and nonzero status", async () => {
  const runner = new URL("./runner.ts", import.meta.url).pathname;
  const command = ["/bin/sh", "-c",
    "! test -t 0 && ! test -t 1 && ! test -t 2 || exit 92; printf '\\033[33mWarning: fixture\\033[0m\\n  context\\n'; printf 'Error: fixture failure\\n' >&2; exit 7"];
  const code = `import { execTerminal } from ${JSON.stringify(runner)};
    const result = await execTerminal(${JSON.stringify(command)});
    console.log("RECORDED:" + JSON.stringify(result));`;
  const proc = Bun.spawn([process.execPath, "--eval", code], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect({ exit, stderr }).toMatchObject({ exit: 0 });
  const record = stdout.slice(stdout.indexOf("RECORDED:") + "RECORDED:".length).trim();
  const result = JSON.parse(record);
  expect(result.exitCode).toBe(7);
  expect(result.stdout).toContain("Warning: fixture");
  expect(result.stdout).toContain("context");
  expect(result.stderr).toContain("Error: fixture failure");
  expect(stderr).toContain("Error: fixture failure");
});

test.skipIf(process.platform !== "darwin")("terminal recording preserves /dev/tty input, echo-off prompts and live output", async () => {
  const runner = new URL("./runner.ts", import.meta.url).pathname;
  const command = ["/bin/sh", "-c",
    "test -t 0 && test -t 1 && test -t 2 || exit 92; stty -echo; printf 'Fixture password: '; IFS= read -r answer </dev/tty; stty echo; test \"$answer\" = fixture-secret || exit 93; printf '\\naccepted\\n'"];
  const code = `import { execTerminal } from ${JSON.stringify(runner)};
    const result = await execTerminal(${JSON.stringify(command)});
    console.log("RECORDED:" + JSON.stringify(result));`;
  let output = "";
  let replied = false;
  const proc = Bun.spawn([process.execPath, "--eval", code], {
    terminal: { cols: 90, rows: 30, data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!replied && output.includes("Fixture password: ")) {
        replied = true;
        terminal.write("fixture-secret\n");
      }
    } },
  });
  try {
    const exit = await proc.exited;
    expect({ exit, output }).toMatchObject({ exit: 0 });
    expect(replied).toBe(true);
    expect(output).toContain("accepted");
    expect(output).toContain('"exitCode":0');
    expect(output).not.toContain("fixture-secret");
  } finally { proc.terminal?.close(); }
}, 10000);

test.skipIf(process.platform !== "darwin")("terminal child launch failure is nonzero even without an Error prefix", async () => {
  await expect(execTerminal(["/nonexistent/brew-bouncer-fixture"])).rejects.toThrow();
});

test.skipIf(process.platform !== "darwin")("terminal recording forwards resize and keyboard interrupts to the foreground child", async () => {
  const runner = new URL("./runner.ts", import.meta.url).pathname;
  const command = ["/bin/sh", "-c",
    "trap 'exit 42' INT; stty size; printf 'resize-ready\\n'; IFS= read -r line; stty size; printf 'interrupt-ready\\n'; IFS= read -r line"];
  const code = `import { execTerminal } from ${JSON.stringify(runner)};
    const result = await execTerminal(${JSON.stringify(command)});
    console.log("RECORDED:" + JSON.stringify(result));`;
  let output = "";
  let resized = false;
  let interrupted = false;
  const proc = Bun.spawn([process.execPath, "--eval", code], {
    terminal: { cols: 90, rows: 30, data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!resized && output.includes("resize-ready")) {
        resized = true;
        terminal.resize(120, 40);
        proc.kill("SIGWINCH");
        setTimeout(() => terminal.write("continue\n"), 50);
      }
      if (!interrupted && output.includes("interrupt-ready")) {
        interrupted = true;
        terminal.write("\x03");
      }
    } },
  });
  try {
    const exit = await proc.exited;
    expect({ exit, output }).toMatchObject({ exit: 0 });
    expect(output).toContain("30 90");
    expect(output).toContain("40 120");
    expect(output).toContain('"exitCode":42');
  } finally { proc.terminal?.close(); }
}, 10000);

test("redirected stdin reaches EOF without creating an interactive terminal", async () => {
  const runner = new URL("./runner.ts", import.meta.url).pathname;
  const command = ["/bin/sh", "-c", "! test -t 0 && ! test -t 1 && ! test -t 2 || exit 92; cat; printf eof-reached"];
  const code = `import { execTerminal } from ${JSON.stringify(runner)};
    const result = await execTerminal(${JSON.stringify(command)});
    console.log("RECORDED:" + JSON.stringify(result));`;
  const proc = Bun.spawn([process.execPath, "--eval", code], {
    stdin: "pipe", stdout: "pipe", stderr: "pipe",
  });
  proc.stdin.end();
  const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  expect({ exit, stderr }).toMatchObject({ exit: 0 });
  expect(stdout).toContain("eof-reached");
  expect(stdout).toContain('"exitCode":0');
}, 5000);

test.skipIf(process.platform !== "darwin")("Ctrl-Z suspends the outer job and foreground resume continues the child", async () => {
  const runner = new URL("./runner.ts", import.meta.url).pathname;
  const command = ["/bin/sh", "-c", "printf 'stop-ready\\n'; IFS= read -r line; printf 'child-resumed\\n'"];
  const code = `import { execTerminal } from ${JSON.stringify(runner)};
    const result = await execTerminal(${JSON.stringify(command)});
    console.log("RECORDED:" + JSON.stringify(result));`;
  let output = "";
  let stoppedState = "";
  let sent = false;
  const proc = Bun.spawn([process.execPath, "--eval", code], {
    terminal: { data(terminal, data) {
      output += new TextDecoder().decode(data);
      if (!sent && output.includes("stop-ready")) {
        sent = true;
        terminal.write("\x1a");
        setTimeout(() => {
          const state = Bun.spawnSync(["ps", "-o", "state=", "-p", String(proc.pid)], { stdout: "pipe", stderr: "pipe" });
          stoppedState = state.stdout.toString();
          process.kill(proc.pid, "SIGCONT");
          setTimeout(() => terminal.write("continue\n"), 20);
        }, 100);
      }
    } },
  });
  try {
    const exit = await proc.exited;
    expect({ exit, output }).toMatchObject({ exit: 0 });
    expect(stoppedState).toContain("T");
    expect(output).toContain("child-resumed");
    expect(output).toContain('"exitCode":0');
  } finally { proc.terminal?.close(); }
}, 5000);
