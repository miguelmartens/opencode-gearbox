// Benchmark arms: the setups compared. Every arm uses the same chat model, provider, tasks and
// order; only effort control differs.

import { resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
export const OBSERVER_DIR = resolve(import.meta.dirname, '..', 'observer');

export const ARM_IDS = ['low', 'medium', 'high', 'xhigh', 'max', 'auto', 'auto-effort'] as const;
export type ArmId = (typeof ARM_IDS)[number];

/** The arms a run uses unless `--arms` says otherwise; `low` is optional. */
export const DEFAULT_ARMS: ArmId[] = ['medium', 'high', 'xhigh', 'max', 'auto', 'auto-effort'];

export type Arm = {
  id: ArmId;
  label: string;
  kind: 'fixed' | 'gearbox';
  /** Fixed arms: the variant pinned on the session, which its subagents inherit. */
  variant: string | null;
  /** Gearbox arms: subagent model switching. */
  subagentSwitch: boolean;
};

export const ARMS: Record<ArmId, Arm> = {
  low: { id: 'low', label: 'always low', kind: 'fixed', variant: 'low', subagentSwitch: false },
  medium: {
    id: 'medium',
    label: 'always medium',
    kind: 'fixed',
    variant: 'medium',
    subagentSwitch: false,
  },
  high: { id: 'high', label: 'always high', kind: 'fixed', variant: 'high', subagentSwitch: false },
  xhigh: {
    id: 'xhigh',
    label: 'always xhigh',
    kind: 'fixed',
    variant: 'xhigh',
    subagentSwitch: false,
  },
  max: { id: 'max', label: 'always max', kind: 'fixed', variant: 'max', subagentSwitch: false },
  auto: { id: 'auto', label: 'gearbox auto', kind: 'gearbox', variant: null, subagentSwitch: true },
  'auto-effort': {
    id: 'auto-effort',
    label: 'gearbox · effort only',
    kind: 'gearbox',
    variant: null,
    subagentSwitch: false,
  },
};

export function isArmId(v: string): v is ArmId {
  return (ARM_IDS as readonly string[]).includes(v);
}

export type ModelRef = { providerID: string; id: string; variant?: string };

/** `provider/model[#variant]`; the model part may contain `/`. */
export function parseModel(s: string): ModelRef {
  const m = /^([^\s/#]+)\/([^\s#]+)(?:#([^\s#]+))?$/.exec(s);
  if (!m) throw new Error(`not a provider/model[#variant]: ${s}`);
  return { providerID: m[1], id: m[2], ...(m[3] ? { variant: m[3] } : {}) };
}

/**
 * The model a session is created with. Fixed arms pin the variant on the session: OpenCode then
 * sends that variant's settings on every request, and subagent sessions inherit model and variant
 * (bench/VERIFY.md). Gearbox arms leave the variant unset, as a user who lets Gearbox drive does.
 */
export function sessionModel(arm: Arm, model: string): ModelRef {
  const ref = parseModel(model);
  return {
    providerID: ref.providerID,
    id: ref.id,
    ...(arm.variant ? { variant: arm.variant } : {}),
  };
}

/** Gearbox's plugin options for an arm. */
export function gearboxOptions(arm: Arm, judge: string): Record<string, unknown> {
  return {
    judge: { model: judge },
    ...(arm.subagentSwitch ? {} : { modelSwitch: { subagents: false } }),
  };
}

/** The `opencode.jsonc` for one task run of an arm. */
export function armConfig(arm: Arm, opts: { model: string; judge: string; observerLog: string }) {
  const plugins: unknown[] = [{ package: OBSERVER_DIR, options: { log: opts.observerLog } }];
  if (arm.kind === 'gearbox')
    plugins.unshift({ package: REPO_ROOT, options: gearboxOptions(arm, opts.judge) });
  return {
    $schema: 'https://opencode.ai/config.json',
    model: parseModelBase(opts.model),
    // Unattended: allow every tool, but no question tool, which would wait for a person.
    permissions: [
      { action: '*', resource: '*', effect: 'allow' },
      { action: 'question', resource: '*', effect: 'deny' },
    ],
    plugins,
  };
}

function parseModelBase(model: string): string {
  const ref = parseModel(model);
  return `${ref.providerID}/${ref.id}`;
}
