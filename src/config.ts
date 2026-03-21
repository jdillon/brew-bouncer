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
import { homedir } from "node:os";
import { join } from "node:path";
import { getLogger } from "@logtape/logtape";

const log = getLogger(["brew-bouncer", "config"]);

const CONFIG_DIR = join(homedir(), ".config", "brew-bouncer");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface BouncerConfig {
  ignore: string[];
}

const DEFAULT_CONFIG: BouncerConfig = {
  ignore: [],
};

export async function loadConfig(): Promise<BouncerConfig> {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (await file.exists()) {
      const data = await file.json();
      const config = { ...DEFAULT_CONFIG, ...data };
      log.debug("Loaded config from {path} (ignore: {ignore})", {
        path: CONFIG_FILE,
        ignore: config.ignore.join(", ") || "none",
      });
      return config;
    }
  } catch {
    log.debug("Config not found or invalid at {path}, using defaults", { path: CONFIG_FILE });
  }
  log.debug("Using default config (no ignore list)");
  return DEFAULT_CONFIG;
}

export function configPath(): string {
  return CONFIG_FILE;
}
