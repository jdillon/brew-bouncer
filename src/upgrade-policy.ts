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
import type { OutdatedPackage } from "./brew/parser.ts";
import type { DetectedApp } from "./detect/matcher.ts";
import type {
  ExecutionContext,
  ExecutionTargetAssessment,
} from "./detect/execution-context.ts";

export interface ExecutionSafetyPlan {
  protected: boolean;
  suppressHomebrewQuit: boolean;
  allowAutomaticLifecycle: boolean;
  manualRestartAfterExit: boolean;
}

/**
 * Unknown context is protected as well as a confirmed host. False negatives
 * can terminate Brew Bouncer; false positives only defer an app restart.
 */
export function planExecutionSafety(
  pkg: Pick<OutdatedPackage, "type">,
  app: DetectedApp | undefined,
  context: Pick<ExecutionContext, "status">,
  assessment?: ExecutionTargetAssessment,
): ExecutionSafetyPlan {
  const protectedByAssessment = Boolean(
    assessment && assessment.membership !== "not-host",
  );
  const protectedByUnknownContext = !assessment && context.status === "unknown";
  const protectedTarget = protectedByAssessment || protectedByUnknownContext;

  return {
    protected: protectedTarget,
    suppressHomebrewQuit: pkg.type === "cask" && protectedTarget,
    allowAutomaticLifecycle: !protectedTarget,
    manualRestartAfterExit: Boolean(app) && protectedTarget,
  };
}
