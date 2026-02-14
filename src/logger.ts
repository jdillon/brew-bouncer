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
