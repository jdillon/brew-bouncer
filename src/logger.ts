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
import { configureSync, getConsoleSink, getLogger } from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

export const log = getLogger(["brew-bouncer"]);

/**
 * Set log level from CLI flags.
 *   --debug   → "debug" (everything)
 *   --verbose → "info"  (info + warn + error)
 *   --quiet   → "error" (errors only, suppress warn)
 *   default   → "warning"  (warn + error)
 *
 * Without calling this, LogTape loggers are no-ops (silent by default).
 */
export function setLogLevel(flags: { debug?: boolean; verbose?: boolean; quiet?: boolean }): void {
  // No flags = stay silent (LogTape loggers are no-ops without configure)
  if (!flags.debug && !flags.verbose && !flags.quiet) return;

  let lowestLevel: "debug" | "info" | "warning" | "error";

  if (flags.debug) {
    lowestLevel = "debug";
  } else if (flags.verbose) {
    lowestLevel = "info";
  } else {
    lowestLevel = "error";
  }

  const formatter = getPrettyFormatter({
    timestamp: "time",
    icons: false,
  });

  configureSync({
    sinks: {
      console: getConsoleSink({ formatter }),
    },
    loggers: [
      { category: ["brew-bouncer"], lowestLevel, sinks: ["console"] },
      { category: ["logtape", "meta"], lowestLevel: "warning", sinks: ["console"] },
    ],
  });
}
