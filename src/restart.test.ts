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
import { expect, mock, test } from "bun:test";
import { createGuiProcessScanner } from "./detect/gui-processes.ts";
import {
  quitGuiApp,
  waitForFreshStableProcesses,
  waitForNoProcesses,
} from "./restart.ts";

function createFakeClock() {
  let currentTime = 0;
  return {
    clock: {
      now: () => currentTime,
      sleep: async (milliseconds: number) => {
        currentTime += milliseconds;
      },
    },
  };
}

test("tracks a conventional app by its observed main executable", async () => {
  const resolveMainExecutable = mock(async () =>
    "/Applications/Raycast.app/Contents/MacOS/Raycast"
  );
  const scanExecutable = mock(async () => [101]);
  const scanBundle = mock(async () => [101, 102]);

  const scanner = await createGuiProcessScanner(
    [101, 102],
    "/Applications/Raycast.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("main");
  expect(await scanner.scan()).toEqual([101]);
  expect(scanBundle).not.toHaveBeenCalled();
});

test("falls back to the bundle when the main executable cannot be resolved", async () => {
  const resolveMainExecutable = mock(async () => undefined);
  const scanExecutable = mock(async () => []);
  const scanBundle = mock(async () => [201]);

  const scanner = await createGuiProcessScanner(
    [201],
    "/Applications/Netbird UI.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("bundle");
  expect(await scanner.scan()).toEqual([201]);
  expect(scanExecutable).not.toHaveBeenCalled();
});

test("retains bundle tracking when the declared executable is an absent launcher", async () => {
  const resolveMainExecutable = mock(async () =>
    "/Applications/Scripted.app/Contents/MacOS/launcher"
  );
  const scanExecutable = mock(async () => []);
  const scanBundle = mock(async () => [301]);

  const scanner = await createGuiProcessScanner(
    [301],
    "/Applications/Scripted.app",
    { resolveMainExecutable, scanExecutable, scanBundle },
  );

  expect(scanner.mode).toBe("bundle");
  expect(await scanner.scan()).toEqual([301]);
  expect(scanBundle).toHaveBeenCalled();
});

test("excludes known helpers when an absent main has no alternate app process", async () => {
  const scanBundle = mock(async () => [301]);
  const scanner = await createGuiProcessScanner([301], "/Applications/Example.app", {
    resolveMainExecutable: async () => "/Applications/Example.app/Contents/MacOS/Example",
    scanExecutable: async () => [],
    scanBundle,
    scanAppBundle: async () => [],
  });
  expect(await scanner.scan()).toEqual([]);
  expect(scanBundle).not.toHaveBeenCalled();
});

test("retains alternate app processes while ignoring known helper locations", async () => {
  const scanner = await createGuiProcessScanner([301, 302], "/Applications/Scripted.app", {
    resolveMainExecutable: async () => "/Applications/Scripted.app/Contents/MacOS/launcher",
    scanExecutable: async () => [],
    scanBundle: async () => [301, 302],
    scanAppBundle: async () => [302],
  });
  expect(await scanner.scan()).toEqual([302]);
});

test("a name-only detection cannot send a quit request", async () => {
  const requestQuit = mock(async () => ({ stderr: "", exitCode: 0 }));
  expect(await quitGuiApp({
    packageName: "example", oldVersion: "1", newVersion: "2",
    kind: "cask-gui", displayName: "Example.app", pids: [],
  }, { requestQuit })).toBe("unknown");
  expect(requestQuit).not.toHaveBeenCalled();
});

test("checks once more at the shutdown timeout boundary", async () => {
  const { clock } = createFakeClock();
  const results = [[101], [101], []];
  const scan = mock(async () => results.shift() ?? []);

  expect(await waitForNoProcesses(scan, 1_000, clock)).toEqual([]);
  expect(scan).toHaveBeenCalledTimes(3);
});

test("accepts a quit-request error when process shutdown is verified", async () => {
  const scan = mock(async () => [101]);
  const waitForExit = mock(async () => []);
  const sleep = mock(async () => {});

  const quit = await quitGuiApp(
    {
      packageName: "raycast",
      oldVersion: "2.1.2.0",
      newVersion: "2.2.0.0",
      kind: "cask-gui",
      displayName: "Raycast.app",
      bundlePath: "/Applications/Raycast.app",
      pids: [101],
    },
    {
      createScanner: async () => ({ mode: "main", scan }),
      requestQuit: async () => ({
        exitCode: 1,
        stderr: "execution error: Raycast got an error: User canceled. (-128)",
      }),
      waitForExit,
      sleep,
    },
  );

  expect(quit).toBe("stopped");
  expect(waitForExit).toHaveBeenCalledTimes(1);
  expect(sleep).toHaveBeenCalledWith(500);
});

test("does not force-stop an app that rejects its quit request", async () => {
  const scan = mock(async () => [101]);
  const waitForExit = mock(async () => [101]);
  const sleep = mock(async () => {});

  const quit = await quitGuiApp(
    {
      packageName: "example",
      oldVersion: "1.0",
      newVersion: "2.0",
      kind: "cask-gui",
      displayName: "Example.app",
      bundlePath: "/Applications/Example.app",
      pids: [101],
    },
    {
      createScanner: async () => ({ mode: "main", scan }),
      requestQuit: async () => ({
        exitCode: 1,
        stderr: "execution error: quit rejected",
      }),
      waitForExit,
      sleep,
    },
  );

  expect(quit).toBe("running");
  expect(waitForExit).toHaveBeenCalledTimes(1);
  expect(sleep).not.toHaveBeenCalled();
});

test("reports an unknown quit state when shutdown cannot be inspected", async () => {
  const quit = await quitGuiApp(
    {
      packageName: "example",
      oldVersion: "1.0",
      newVersion: "2.0",
      kind: "cask-gui",
      displayName: "Example.app",
      bundlePath: "/Applications/Example.app",
      pids: [101],
    },
    {
      createScanner: async () => {
        throw new Error("process inspection failed");
      },
    },
  );

  expect(quit).toBe("unknown");
});

test("does not send a quit request for an app that has already closed", async () => {
  const requestQuit = mock(async () => ({ stderr: "", exitCode: 0 }));
  const waitForExit = mock(async () => []);
  const sleep = mock(async () => {});
  const status = await quitGuiApp({
    packageName: "example", oldVersion: "1", newVersion: "2",
    kind: "cask-gui", displayName: "Example.app",
    bundlePath: "/Applications/Example.app", pids: [101],
  }, {
    createScanner: async () => ({ mode: "main", scan: async () => [] }),
    requestQuit, waitForExit, sleep,
  });
  expect(status).toBe("already-stopped");
  expect(requestQuit).not.toHaveBeenCalled();
  expect(waitForExit).not.toHaveBeenCalled();
  expect(sleep).not.toHaveBeenCalled();
});

test("does not send a quit request when the initial process scan fails", async () => {
  const requestQuit = mock(async () => ({ stderr: "", exitCode: 0 }));
  const status = await quitGuiApp({
    packageName: "example", oldVersion: "1", newVersion: "2",
    kind: "cask-gui", displayName: "Example.app",
    bundlePath: "/Applications/Example.app", pids: [101],
  }, {
    createScanner: async () => ({ mode: "main", scan: async () => {
      throw new Error("ps failed");
    } }),
    requestQuit,
  });
  expect(status).toBe("unknown");
  expect(requestQuit).not.toHaveBeenCalled();
});

test("does not count a terminating PID as a successful relaunch", async () => {
  const { clock } = createFakeClock();
  const results = [[101], [101], [], [202], [202], [202]];
  const scan = mock(async () => results.shift() ?? [202]);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [101],
    retryLaunch,
    { timeoutMs: 5_000, stabilityMs: 1_000, clock },
  );

  expect(launched).toBe(true);
  expect(retryLaunch).toHaveBeenCalledTimes(1);
});

test("does not retry when the first launch produced a fresh process", async () => {
  const { clock } = createFakeClock();
  const results = [[101], [202], [202], [202]];
  const scan = mock(async () => results.shift() ?? [202]);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [101],
    retryLaunch,
    { timeoutMs: 3_000, stabilityMs: 1_000, clock },
  );

  expect(launched).toBe(true);
  expect(retryLaunch).not.toHaveBeenCalled();
});

test("accepts one stable fresh process while helper PIDs change", async () => {
  const { clock } = createFakeClock();
  const results = [[202, 203], [202], [202, 204]];
  const scan = mock(async () => results.shift() ?? [202]);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [],
    retryLaunch,
    { timeoutMs: 3_000, stabilityMs: 1_000, clock },
  );

  expect(launched).toBe(true);
  expect(retryLaunch).not.toHaveBeenCalled();
});

test("accepts a process Homebrew already reopened after the old one stopped", async () => {
  const { clock } = createFakeClock();
  const scan = mock(async () => [202]);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [],
    retryLaunch,
    { timeoutMs: 2_000, stabilityMs: 1_000, clock },
  );

  expect(launched).toBe(true);
  expect(retryLaunch).not.toHaveBeenCalled();
});

test("does not retry without time to verify the result", async () => {
  const { clock } = createFakeClock();
  const results = [[101], []];
  const scan = mock(async () => results.shift() ?? []);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [101],
    retryLaunch,
    { timeoutMs: 1_000, stabilityMs: 500, clock },
  );

  expect(launched).toBe(false);
  expect(retryLaunch).not.toHaveBeenCalled();
});

test("rejects a fresh process that exits before becoming stable", async () => {
  const { clock } = createFakeClock();
  const results = [[202], [], [], [], [], []];
  const scan = mock(async () => results.shift() ?? []);
  const retryLaunch = mock(async () => true);

  const launched = await waitForFreshStableProcesses(
    scan,
    [],
    retryLaunch,
    { timeoutMs: 3_000, stabilityMs: 1_000, retryDelayMs: 1_000, clock },
  );

  expect(launched).toBe(false);
  expect(retryLaunch).toHaveBeenCalledTimes(1);
});

test("an app closed before AppleScript runs is not credited as stopped by this invocation", async () => {
  const waitForExit = mock(async () => []);
  const requestQuit = mock(async () => ({ exitCode: 0, stderr: "", alreadyStopped: true }));
  const status = await quitGuiApp({
    packageName: "example", oldVersion: "1", newVersion: "2", kind: "cask-gui",
    displayName: "Example.app", bundlePath: "/Applications/Example.app", pids: [101],
  }, {
    createScanner: async () => ({ mode: "main", scan: async () => [101] }),
    requestQuit, waitForExit,
  });
  expect(status).toBe("already-stopped");
  expect(requestQuit).toHaveBeenCalledWith("/Applications/Example.app");
  expect(waitForExit).not.toHaveBeenCalled();
});

test("an observed launcher handing off to an alternate executable remains running", async () => {
  const results = [[101], []];
  const scanAppBundle = mock(async () => [202]);
  const scanner = await createGuiProcessScanner([101], "/Applications/Scripted.app", {
    resolveMainExecutable: async () => "/Applications/Scripted.app/Contents/MacOS/launcher",
    scanExecutable: async () => results.shift() ?? [],
    scanBundle: async () => [202, 303],
    scanAppBundle,
  });
  expect(scanner.mode).toBe("main");
  expect(await scanner.scan()).toEqual([202]);
  expect(scanAppBundle).toHaveBeenCalledTimes(1);
});

test("an exited main with only known helpers is still considered stopped", async () => {
  const results = [[101], []];
  const scanBundle = mock(async () => [303]);
  const scanner = await createGuiProcessScanner([101, 303], "/Applications/Example.app", {
    resolveMainExecutable: async () => "/Applications/Example.app/Contents/MacOS/Example",
    scanExecutable: async () => results.shift() ?? [],
    scanBundle,
    scanAppBundle: async () => [],
  });
  expect(await scanner.scan()).toEqual([]);
  expect(scanBundle).not.toHaveBeenCalled();
});
