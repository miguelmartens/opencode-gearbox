/** @jsxImportSource @opentui/solid */
// Gearbox status bar and toasts. The server part has no toast API, so it sends RPC events
// and this part shows them (docs/api-probe.md §9).

import { Plugin } from '@opencode/plugin/tui';
import { For, Show, createSignal } from 'solid-js';
import type { GearboxStatus } from '../core/types.ts';
import { Gearbox, STATUS_EVENT, TOAST_EVENT } from '../rpc.ts';
import type { ToastEvent } from '../rpc.ts';
import { ageStatus, retryDelayMs, statusSegments, toastKind } from './format.ts';
import type { Segment } from './format.ts';

type Seen = { status: GearboxStatus; at: number };

/** One bar line. A `<span>` takes its color only from `style`; a bare `fg` prop is ignored. */
export function StatusLine(props: { segments: Segment[] }) {
  return (
    <text>
      <For each={props.segments}>
        {(segment) => <span style={{ fg: segment.fg }}>{segment.text}</span>}
      </For>
    </text>
  );
}

export default Plugin.define({
  id: 'gearbox',
  setup(context) {
    const gearbox = context.client.rpc(Gearbox);
    const [statuses, setStatuses] = createSignal<Record<string, Seen>>({});
    const [now, setNow] = createSignal(Date.now());
    // Events are live only: fetch each session's status once when the bar first shows it.
    // A failed fetch is retried with a growing delay, never once per render.
    const requested = new Set<string>();
    const failures = new Map<string, { count: number; retryAt: number }>();

    const remember = (status: GearboxStatus) =>
      setStatuses((prev) => ({ ...prev, [status.sessionID]: { status, at: Date.now() } }));

    const fetchOnce = (sessionID: string, at: number) => {
      if (requested.has(sessionID)) return;
      const failed = failures.get(sessionID);
      if (failed && at < failed.retryAt) return;
      requested.add(sessionID);
      gearbox
        .status({ sessionID })
        .then((status) => {
          failures.delete(sessionID);
          if (!statuses()[sessionID]) remember(status as GearboxStatus);
        })
        .catch(() => {
          const count = (failures.get(sessionID)?.count ?? 0) + 1;
          failures.set(sessionID, { count, retryAt: Date.now() + retryDelayMs(count) });
          requested.delete(sessionID);
        });
    };

    const currentSessionID = (): string | undefined => {
      const route = context.ui.router.current();
      return route.type === 'session' ? route.sessionID : undefined;
    };

    // Catalog name of a model, for alias ids such as `claude-agent/opus`. Loads the list once.
    let catalogRequested = false;
    const modelName = (ref: GearboxStatus['model']): string | undefined => {
      if (!ref) return undefined;
      const models = context.data.location.model.list();
      if (!models && !catalogRequested) {
        catalogRequested = true;
        context.data.location.model.sync().catch(() => {});
      }
      return models?.find((m) => m.providerID === ref.providerID && m.id === ref.id)?.name;
    };

    const line = (sessionID: string | undefined): Segment[] | undefined => {
      if (!sessionID) return undefined;
      // Read the clock first: the 1 s tick re-renders the bar, so a fetch is retried once its
      // backoff expires even when no status event arrives.
      const at = now();
      fetchOnce(sessionID, at);
      const seen = statuses()[sessionID];
      if (!seen) return undefined;
      return statusSegments(ageStatus(seen.status, at - seen.at), modelName(seen.status.model));
    };

    const showToast = (t: ToastEvent) => {
      // A dialog takes over the screen: only for the session the user is looking at.
      if (toastKind(t, currentSessionID()) === 'dialog') {
        void context.ui.dialog.alert({ title: t.title ?? 'Gearbox', message: t.message });
        return;
      }
      context.ui.toast.show({
        title: t.title ?? 'Gearbox',
        message: t.message,
        variant: t.variant ?? 'info',
        sessionID: t.sessionID,
      });
    };

    // The server emits for every session, subagents included: keep only the ones the bar shows.
    const stopStatus = gearbox.events.on(STATUS_EVENT, (event) => {
      const status = event.data as unknown as GearboxStatus;
      if (requested.has(status.sessionID)) remember(status);
    });
    const stopToast = gearbox.events.on(TOAST_EVENT, (event) => {
      showToast(event.data as unknown as ToastEvent);
    });
    // The cache timer counts down between status events.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const unslot = context.ui.slot({
      append: 'prompt.footer.status',
      render: (input) => (
        <Show when={line(input.sessionID)}>
          {(segments) => <StatusLine segments={segments()} />}
        </Show>
      ),
    });

    return () => {
      clearInterval(timer);
      stopStatus();
      stopToast();
      unslot();
    };
  },
});
