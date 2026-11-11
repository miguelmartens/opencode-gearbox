// Checks the task suite without a model: every check must fail on the untouched fixture and pass
// on the fixture with `reference/` laid over it.
//
//   bun bench/verify-tasks.ts [id ...]

import { copyFixture, loadTasks, runCheck } from './lib/tasks.ts';
import type { Task } from './lib/tasks.ts';

export type TaskVerdict = { id: string; ok: boolean; fixture: boolean; reference: boolean };

export function verifyTask(
  task: Task,
): TaskVerdict & { fixtureOutput: string; referenceOutput: string } {
  const plain = copyFixture(task);
  const solved = copyFixture(task, { reference: true });
  try {
    const before = runCheck(task, plain.work);
    const after = runCheck(task, solved.work);
    return {
      id: task.id,
      ok: !before.pass && after.pass,
      fixture: before.pass,
      reference: after.pass,
      fixtureOutput: before.output,
      referenceOutput: after.output,
    };
  } finally {
    plain.cleanup();
    solved.cleanup();
  }
}

if (import.meta.main) {
  const only = process.argv.slice(2);
  const tasks = loadTasks().filter((t) => only.length === 0 || only.includes(t.id));
  let bad = 0;
  for (const task of tasks) {
    const v = verifyTask(task);
    const line = `${v.ok ? 'ok  ' : 'FAIL'} ${task.id.padEnd(28)} ${task.meta.difficulty.padEnd(6)} fixture ${v.fixture ? 'passes (should fail)' : 'fails'} · reference ${v.reference ? 'passes' : 'fails (should pass)'}`;
    console.log(line);
    if (!v.ok) {
      bad++;
      if (v.reference === false) console.log(v.referenceOutput.split('\n').slice(-25).join('\n'));
    }
  }
  const byDifficulty = tasks.reduce<Record<string, number>>((acc, t) => {
    acc[t.meta.difficulty] = (acc[t.meta.difficulty] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\n${tasks.length} tasks ${JSON.stringify(byDifficulty)}; ${bad} failing`);
  process.exit(bad === 0 ? 0 : 1);
}
