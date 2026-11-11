/** @jsxImportSource @opentui/solid */
import { expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { createRoot } from 'solid-js';
import plugin from '../../src/tui/index.tsx';
import type { GearboxStatus, Level } from '../../src/core/types.ts';

const status = (sessionID: string, level: Level): GearboxStatus => ({
  sessionID,
  level,
  model: null,
  auto: true,
  paused: null,
  contextRatio: null,
  cacheRemainingMs: null,
  judgeReason: null,
  advice: null,
});

/** The TUI plugin on a fake context; the `status` RPC answers `fetched`; `models` is the catalog. */
function fakeTui(fetched: Level, models?: Array<{ providerID: string; id: string; name: string }>) {
  const handlers: Record<string, (event: { data: unknown }) => void> = {};
  let render!: (input: { sessionID?: string }) => unknown;
  const context: any = {
    client: {
      rpc: () => ({
        status: async ({ sessionID }: { sessionID: string }) => status(sessionID, fetched),
        events: {
          on: (name: string, handle: (event: { data: unknown }) => void) => {
            handlers[name] = handle;
            return () => {};
          },
        },
      }),
    },
    ui: {
      router: { current: () => ({ type: 'home' }) },
      slot: (claim: { render: typeof render }) => {
        render = claim.render;
        return () => {};
      },
      toast: { show: () => {} },
      dialog: { alert: async () => {} },
    },
    data: { location: { model: { list: () => models, sync: async () => {} } } },
  };
  const dispose = (plugin as any).setup(context) as () => void;
  return {
    emit: (name: string, data: unknown) => handlers[name]!({ data }),
    bar: (sessionID: string) => render({ sessionID }) as any,
    dispose,
  };
}

test('the bar keeps statuses only for sessions it has shown', async () => {
  const tui = fakeTui('low');
  try {
    // Never shown yet: dropped, so the bar's own fetch decides.
    tui.emit('status', status('ses_bar', 'max'));
    createRoot((dispose) => {
      tui.bar('ses_bar');
      dispose();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const frame = async () => {
      // Tests resolve Solid's server build, which does not re-render: mount afresh each time.
      const t = await testRender(() => <box>{tui.bar('ses_bar')}</box>, { width: 60, height: 1 });
      await t.renderOnce();
      return t.captureCharFrame();
    };
    expect(await frame()).toContain('low');
    // Shown now: later events are kept.
    tui.emit('status', status('ses_bar', 'high'));
    expect(await frame()).toContain('high');
  } finally {
    tui.dispose();
  }
});

test('the bar names an alias model by its catalog name', async () => {
  const tui = fakeTui('low', [{ providerID: 'claude-agent', id: 'opus', name: 'Opus 5.5' }]);
  try {
    createRoot((dispose) => {
      tui.bar('ses_alias');
      dispose();
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    tui.emit('status', {
      ...status('ses_alias', 'high'),
      model: { providerID: 'claude-agent', id: 'opus' },
    });
    const t = await testRender(() => <box>{tui.bar('ses_alias')}</box>, { width: 60, height: 1 });
    await t.renderOnce();
    expect(t.captureCharFrame()).toContain('opus-5-5');
  } finally {
    tui.dispose();
  }
});
