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
import pino from "pino";

export const log = pino({
  level: "silent",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "HH:MM:ss",
    },
  },
});

/**
 * Set log level from CLI flags.
 *   --debug   → "debug" (everything)
 *   --verbose → "info"  (info + warn + error)
 *   --quiet   → "error" (errors only, suppress warn)
 *   default   → "warn"  (warn + error)
 */
export function setLogLevel(flags: { debug?: boolean; verbose?: boolean; quiet?: boolean }): void {
  if (flags.debug) {
    log.level = "debug";
  } else if (flags.verbose) {
    log.level = "info";
  } else if (flags.quiet) {
    log.level = "error";
  } else {
    log.level = "warn";
  }
}
