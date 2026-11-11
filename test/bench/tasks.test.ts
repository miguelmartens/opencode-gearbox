// The task suite stays honest: every check fails on the untouched fixture and passes on the
// reference solution.

import { describe, expect, test } from 'bun:test';
import { loadTasks } from '../../bench/lib/tasks.ts';
import { verifyTask } from '../../bench/verify-tasks.ts';

const tasks = loadTasks();

describe('task suite', () => {
  test('24 tasks: 12 easy, 8 medium, 4 hard; at least 4 with a subagent, some with a follow-up', () => {
    const count = (d: string) => tasks.filter((t) => t.meta.difficulty === d).length;
    expect(tasks).toHaveLength(24);
    expect([count('easy'), count('medium'), count('hard')]).toEqual([12, 8, 4]);
    expect(tasks.filter((t) => t.meta.tags.includes('subagent')).length).toBeGreaterThanOrEqual(4);
    expect(tasks.filter((t) => t.prompts.length > 1).length).toBeGreaterThanOrEqual(3);
  });

  for (const task of tasks)
    test.concurrent(
      `${task.id}: check fails on the fixture, passes on the reference`,
      () => {
        const v = verifyTask(task);
        expect({ fixture: v.fixture, reference: v.reference }).toEqual({
          fixture: false,
          reference: true,
        });
      },
      60_000,
    );
});
