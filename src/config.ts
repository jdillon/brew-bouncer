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
import { parse } from "yaml";

const log = getLogger(["brew-bouncer", "config"]);

const CONFIG_DIR = join(homedir(), ".config", "brew-bouncer");
const CONFIG_YAML = join(CONFIG_DIR, "config.yaml");
const CONFIG_JSON = join(CONFIG_DIR, "config.json");

export interface BouncerConfig {
  ignore: string[];
}

const DEFAULT_CONFIG: BouncerConfig = {
  ignore: [],
};

export async function loadConfig(): Promise<BouncerConfig> {
  const yamlExists = await Bun.file(CONFIG_YAML).exists();
  const jsonExists = await Bun.file(CONFIG_JSON).exists();

  if (yamlExists && jsonExists) {
    throw new Error(
      `Ambiguous config: both ${CONFIG_YAML} and ${CONFIG_JSON} exist. Remove one.`,
    );
  }

  if (yamlExists) {
    try {
      const text = await Bun.file(CONFIG_YAML).text();
      const data = parse(text) ?? {};
      const config = { ...DEFAULT_CONFIG, ...data };
      log.debug("Loaded config from {path} (ignore: {ignore})", {
        path: CONFIG_YAML,
        ignore: config.ignore.join(", ") || "none",
      });
      return config;
    } catch (e) {
      throw new Error(`Failed to parse ${CONFIG_YAML}: ${e}`);
    }
  }

  if (jsonExists) {
    try {
      const data = await Bun.file(CONFIG_JSON).json();
      const config = { ...DEFAULT_CONFIG, ...data };
      log.debug("Loaded config from {path} (ignore: {ignore})", {
        path: CONFIG_JSON,
        ignore: config.ignore.join(", ") || "none",
      });
      log.warn("{path} is deprecated, rename to config.yaml", { path: CONFIG_JSON });
      return config;
    } catch (e) {
      throw new Error(`Failed to parse ${CONFIG_JSON}: ${e}`);
    }
  }

  log.debug("Using default config (no ignore list)");
  return DEFAULT_CONFIG;
}

export function configPath(): string {
  return CONFIG_YAML;
}
