/** @jsxImportSource @opentui/solid */
// Gearbox status bar and toasts. The server part has no toast API, so it sends RPC events
// and this part shows them (docs/api-probe.md §9).

import { Plugin } from '@opencode/plugin/tui';
import { Show, createSignal } from 'solid-js';
import type { GearboxStatus } from '../core/types.ts';
import { Gearbox, STATUS_EVENT, TOAST_EVENT } from '../rpc.ts';
import type { ToastEvent } from '../rpc.ts';
import { ageStatus, formatStatus, isLongMessage } from './format.ts';

type Seen = { status: GearboxStatus; at: number };

export default Plugin.define({
  id: 'gearbox',
  setup(context) {
    const gearbox = context.client.rpc(Gearbox);
    const [statuses, setStatuses] = createSignal<Record<string, Seen>>({});
    const [now, setNow] = createSignal(Date.now());
    // Events are live only: fetch each session's status once when the bar first shows it.
    const requested = new Set<string>();

    const remember = (status: GearboxStatus) =>
      setStatuses((prev) => ({ ...prev, [status.sessionID]: { status, at: Date.now() } }));

    const fetchOnce = (sessionID: string) => {
      if (requested.has(sessionID)) return;
      requested.add(sessionID);
      gearbox
        .status({ sessionID })
        .then((status) => {
          if (!statuses()[sessionID]) remember(status as GearboxStatus);
        })
        .catch(() => requested.delete(sessionID));
    };

    const line = (sessionID: string | undefined): string => {
      if (!sessionID) return '';
      fetchOnce(sessionID);
      const seen = statuses()[sessionID];
      return seen ? formatStatus(ageStatus(seen.status, now() - seen.at)) : '';
    };

    const showToast = (t: ToastEvent) => {
      if (isLongMessage(t.message)) {
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

    const stopStatus = gearbox.events.on(STATUS_EVENT, (event) => {
      remember(event.data as unknown as GearboxStatus);
    });
    const stopToast = gearbox.events.on(TOAST_EVENT, (event) => {
      showToast(event.data as unknown as ToastEvent);
    });
    // The cache timer counts down between status events.
    const timer = setInterval(() => setNow(Date.now()), 1000);
    const unslot = context.ui.slot({
      append: 'prompt.footer.status',
      render: (input) => (
        <Show when={line(input.sessionID)}>{(text) => <text>{text()}</text>}</Show>
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
