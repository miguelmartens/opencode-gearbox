// Benchmark tasks: `bench/tasks/<id>/` with `fixture/`, `prompt.md`, `check.sh`, `meta.json` and
// `reference/`. The agent only ever sees a copy of `fixture/`; `check.sh` and `reference/` stay here.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

export const TASKS_DIR = resolve(import.meta.dirname, '..', 'tasks');

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type TaskMeta = {
  difficulty: Difficulty;
  tags: string[];
};

export type Task = {
  id: string;
  dir: string;
  meta: TaskMeta;
  /** One prompt per user turn, in order. */
  prompts: string[];
};

/** Splits `prompt.md` into turns: one prompt per section between lines that hold only `---`. */
export function parsePrompts(text: string): string[] {
  return text
    .split(/^---[ \t]*$/m)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function parseMeta(id: string, raw: unknown): TaskMeta {
  const m = raw as Partial<TaskMeta>;
  if (!m || !DIFFICULTIES.includes(m.difficulty as Difficulty))
    throw new Error(`${id}: meta.json needs "difficulty": easy | medium | hard`);
  if (!Array.isArray(m.tags) || !m.tags.every((t) => typeof t === 'string'))
    throw new Error(`${id}: meta.json needs "tags": string[]`);
  return { difficulty: m.difficulty as Difficulty, tags: m.tags };
}

export function loadTask(id: string, root = TASKS_DIR): Task {
  const dir = join(root, id);
  for (const part of ['fixture', 'prompt.md', 'check.sh', 'meta.json', 'reference'])
    if (!existsSync(join(dir, part))) throw new Error(`${id}: missing ${part}`);
  const meta = parseMeta(id, JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')));
  const prompts = parsePrompts(readFileSync(join(dir, 'prompt.md'), 'utf8'));
  if (prompts.length === 0) throw new Error(`${id}: prompt.md is empty`);
  return { id, dir, meta, prompts };
}

/** Every task, sorted by id. */
export function loadTasks(root = TASKS_DIR): Task[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((id) => loadTask(id, root));
}

/** A fresh temporary copy of the task's fixture, optionally with `reference/` laid over it. */
export function copyFixture(task: Task, opts: { reference?: boolean; parent?: string } = {}) {
  const parent = opts.parent ?? tmpdir();
  const root = mkdtempSync(join(parent, `gbx-bench-${task.id}-`));
  const work = join(root, 'work');
  cpSync(join(task.dir, 'fixture'), work, { recursive: true });
  if (opts.reference) cpSync(join(task.dir, 'reference'), work, { recursive: true });
  return { root, work, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export type CheckResult = { pass: boolean; code: number | null; output: string; timedOut: boolean };

/** Runs `check.sh <work>`; solved only on exit code 0. */
export function runCheck(task: Task, work: string, timeoutMs = 120_000): CheckResult {
  const r = spawnSync('sh', [join(task.dir, 'check.sh'), work], {
    cwd: work,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env, WORK_DIR: work },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  const timedOut = r.error !== undefined && (r.error as NodeJS.ErrnoException).code === 'ETIMEDOUT';
  return { pass: r.status === 0, code: r.status, output: output.slice(-4000), timedOut };
}
