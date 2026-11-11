import { describe, expect, test } from 'bun:test';
import { ARMS, armConfig, gearboxOptions, parseModel, sessionModel } from '../../bench/lib/arms.ts';
import { effortLabel, settingsProblems } from '../../bench/lib/execute.ts';
import { pluginKey } from '../../bench/lib/gearbox-stats.ts';
import { parsePrompts } from '../../bench/lib/tasks.ts';
import { pickTier, priceRequest, requestCost, stepTokens } from '../../bench/lib/usage.ts';
import { effortOf, usageOf } from '../../bench/observer/index.ts';
import { estimate, parseArgs, schedule } from '../../bench/run.ts';
import { fakeRecord } from './fake-raw.ts';

const haikuCost = [
  { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
  {
    tier: { type: 'context', size: 100000 },
    input: 0.5,
    output: 2.5,
    cache: { read: 0.05, write: 0.625 },
  },
];

describe('usage', () => {
  test('step tokens from a session.step.ended event', () => {
    expect(
      stepTokens({
        tokens: { input: 4, output: 53, reasoning: 7, cache: { read: 5972, write: 19408 } },
      }),
    ).toEqual({ input: 4, output: 53, reasoning: 7, cacheRead: 5972, cacheWrite: 19408 });
    expect(stepTokens({})).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  test('tier by context size', () => {
    expect(pickTier(haikuCost, 50_000)?.input).toBe(0.1);
    expect(pickTier(haikuCost, 150_000)?.input).toBe(0.5);
  });

  test('price bills reasoning as output; no price without a catalog cost', () => {
    const t = {
      input: 1_000_000,
      output: 1_000_000,
      reasoning: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
    };
    // 1M input → tier 2: 0.5 + 2 × 2.5
    expect(priceRequest(haikuCost, t)).toBeCloseTo(5.5);
    expect(priceRequest([], t)).toBeNull();
    expect(priceRequest(undefined, t)).toBeNull();
  });

  test('reported cost wins when above zero', () => {
    expect(requestCost(0.2, 0.1)).toBe(0.2);
    expect(requestCost(0, 0.1)).toBe(0.1);
    expect(requestCost(0, null)).toBe(0);
  });
});

describe('arms', () => {
  test('fixed arms pin the variant on the session; gearbox arms do not', () => {
    expect(sessionModel(ARMS.xhigh, 'p/m')).toEqual({ providerID: 'p', id: 'm', variant: 'xhigh' });
    expect(sessionModel(ARMS.auto, 'p/m')).toEqual({ providerID: 'p', id: 'm' });
  });

  test('config loads gearbox only for gearbox arms, observer always', () => {
    const opts = { model: 'p/m', judge: 'p/j#none', observerLog: '/tmp/x' };
    const fixed = armConfig(ARMS.high, opts);
    expect(fixed.plugins).toHaveLength(1);
    expect(fixed.model).toBe('p/m');
    const auto = armConfig(ARMS.auto, opts);
    expect(auto.plugins).toHaveLength(2);
    expect((auto.plugins[0] as any).options).toEqual({ judge: { model: 'p/j#none' } });
    expect(gearboxOptions(ARMS['auto-effort'], 'p/j')).toEqual({
      judge: { model: 'p/j' },
      modelSwitch: { subagents: false },
    });
    expect(fixed.permissions).toContainEqual({ action: 'question', resource: '*', effect: 'deny' });
  });

  test('model strings', () => {
    expect(parseModel('opencode-go/claude-haiku-5-5#none')).toEqual({
      providerID: 'opencode-go',
      id: 'claude-haiku-5-5',
      variant: 'none',
    });
    expect(() => parseModel('nope')).toThrow();
  });
});

describe('runner', () => {
  test('dry run defaults: 2 tasks, 1 run', () => {
    const a = parseArgs(['--dry-run']);
    expect(a.runs).toBe(1);
    expect(a.tasks).toHaveLength(2);
    expect(a.arms).toEqual(['medium', 'high', 'xhigh', 'max', 'auto', 'auto-effort']);
  });

  test('flags', () => {
    const a = parseArgs([
      '--runs',
      '2',
      '--arms',
      'low,auto',
      '--tasks',
      'x',
      '--max-usd',
      '5',
      '--resume',
    ]);
    expect(a).toMatchObject({
      runs: 2,
      arms: ['low', 'auto'],
      tasks: ['x'],
      maxUSD: 5,
      resume: true,
    });
    expect(() => parseArgs(['--arms', 'turbo'])).toThrow('unknown arm');
    expect(() => parseArgs(['--model', 'p/m#high'])).toThrow('variant');
    expect(() => parseArgs(['--runs', '0'])).toThrow();
  });

  const tasks = ['a', 'b', 'c'].map((id) => ({
    id,
    dir: '',
    meta: { difficulty: 'easy' as const, tags: [] },
    prompts: ['x'],
  }));

  test('schedule: every arm × task per run, shuffled per run, reproducible', () => {
    const jobs = schedule('seed', 2, ['high', 'auto'], tasks);
    expect(jobs).toHaveLength(12);
    const run1 = jobs.filter((j) => j.run === 1).map((j) => `${j.arm}/${j.task.id}`);
    expect(new Set(run1).size).toBe(6);
    expect(schedule('seed', 2, ['high', 'auto'], tasks)).toEqual(jobs);
    expect(schedule('other', 2, ['high', 'auto'], tasks).map((j) => j.task.id)).not.toEqual(
      jobs.map((j) => j.task.id),
    );
  });

  test('estimate from earlier records, judge included', () => {
    const jobs = schedule('s', 1, ['high', 'auto'], tasks);
    expect(estimate(jobs, [])).toBeNull();
    const est = estimate(jobs, [
      fakeRecord({ arm: 'high', task: 'a', run: 1, costUSD: 0.01, seconds: 20 }),
      fakeRecord({
        arm: 'auto',
        task: 'a',
        run: 1,
        costUSD: 0.004,
        judgeCostUSD: 0.001,
        seconds: 10,
      }),
    ]);
    expect(est?.usd).toBeCloseTo(3 * 0.01 + 3 * 0.005);
    expect(est?.seconds).toBe(90);
  });
});

describe('gearbox settings check', () => {
  const defaults = {
    auto: true,
    bias: 0,
    floor: 'low',
    ceiling: 'max',
    judge: { model: 'p/j#none' },
    modelSwitch: { subagents: true },
    budget: { dailyUSD: null },
    saveMode: { until: null },
  };
  test('defaults pass for auto, subagent switch must match the arm', () => {
    expect(settingsProblems(defaults, ARMS.auto, 'p/j#none')).toEqual([]);
    expect(settingsProblems(defaults, ARMS['auto-effort'], 'p/j#none')).toHaveLength(1);
  });
  test('stored overrides and save mode are refused', () => {
    expect(settingsProblems({ ...defaults, bias: -1 }, ARMS.auto, 'p/j#none')[0]).toContain('bias');
    const saving = { ...defaults, saveMode: { until: 2_000 } };
    expect(settingsProblems(saving, ARMS.auto, 'p/j#none', 1_000)).toEqual(['save mode is on']);
  });
});

describe('observer', () => {
  test('effort fields of a request body', () => {
    expect(effortOf({ model: 'x', output_config: { effort: 'high' } })).toEqual({
      output_config: { effort: 'high' },
    });
    expect(effortOf({ model: 'x' })).toBeNull();
    expect(effortLabel(effortOf({ reasoning: { effort: 'low' } }))).toBe('low');
    expect(effortLabel(effortOf({ reasoning_effort: 'max' }))).toBe('max');
    expect(effortLabel(effortOf({ thinking: { type: 'adaptive' } }))).toBe('thinking:adaptive');
    expect(effortLabel(null)).toBe('none');
  });

  test('usage merged from server-sent events', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":1}}}',
      'data: {"type":"message_delta","usage":{"output_tokens":154}}',
    ].join('\n');
    expect(usageOf(sse)).toEqual({ input_tokens: 4, output_tokens: 154 });
    expect(usageOf('nothing')).toBeNull();
  });
});

describe('misc', () => {
  test('prompt turns split on --- lines', () => {
    expect(parsePrompts('one\n---\nok, continue\n')).toEqual(['one', 'ok, continue']);
    expect(parsePrompts('a --- b')).toEqual(['a --- b']);
  });
  test('plugin storage key', () => {
    expect(pluginKey('gearbox', 'stats/x')).toBe('plugin:00670065006100720062006f0078:stats/x');
  });
});
