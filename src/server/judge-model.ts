// Judge model selection and calls. Stub from Task 0; Task 6 implements it.

import type { Plugin } from '@opencode/plugin';
import type { ModelRef, Settings } from '../core/types.ts';

type Ctx = Plugin.Context;

export type JudgeResult = { text: string; ms: number; costUSD?: number };

/** `settings.judge.model` → OpenCode `small_model` → cheapest tool-capable model of the session's provider. */
export async function resolveJudgeModel(
  _ctx: Ctx,
  sessionModel: ModelRef,
  _settings: Settings,
): Promise<ModelRef> {
  return { providerID: sessionModel.providerID, id: sessionModel.id };
}

/** Runs the judge with a timeout. Returns `null` on timeout or error. */
export async function runJudge(
  _ctx: Ctx,
  _model: ModelRef,
  _prompt: string,
  _timeoutMs: number,
): Promise<JudgeResult | null> {
  return null;
}
