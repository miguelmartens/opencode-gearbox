// RPC contract between the server part and the TUI part (docs/api-probe.md §9).
// Event names are local names: the wire type is `rpc.gearbox.<name>`.

import { Rpc } from '@opencode/plugin/rpc';
import { LEVELS } from './core/types.ts';

export const RPC_ID = 'gearbox';

/** Event emitted after each routing decision. Wire type `rpc.gearbox.status`. */
export const STATUS_EVENT = 'status';

/** Event the TUI shows as a toast (the server has no toast API). Wire type `rpc.gearbox.toast`. */
export const TOAST_EVENT = 'toast';

export type ToastEvent = {
  sessionID?: string;
  title?: string;
  message: string;
  variant?: 'info' | 'success' | 'warning' | 'error';
};

const nullable = (type: string) => ({ type: [type, 'null'] });

const level = { enum: [...LEVELS, null] };

const modelRef = {
  type: ['object', 'null'],
  properties: {
    providerID: { type: 'string' },
    id: { type: 'string' },
    variant: { type: 'string' },
  },
  required: ['providerID', 'id'],
  additionalProperties: false,
};

const status = {
  type: 'object',
  properties: {
    sessionID: { type: 'string' },
    level,
    model: modelRef,
    auto: { type: 'boolean' },
    paused: nullable('string'),
    contextRatio: nullable('number'),
    cacheRemainingMs: nullable('number'),
    judgeReason: nullable('string'),
    advice: { enum: ['handoff', 'swamped', null] },
  },
  required: [
    'sessionID',
    'level',
    'model',
    'auto',
    'paused',
    'contextRatio',
    'cacheRemainingMs',
    'judgeReason',
    'advice',
  ],
  additionalProperties: false,
} as const;

const toast = {
  type: 'object',
  properties: {
    sessionID: { type: 'string' },
    title: { type: 'string' },
    message: { type: 'string' },
    variant: { enum: ['info', 'success', 'warning', 'error'] },
  },
  required: ['message'],
  additionalProperties: false,
} as const;

export const Gearbox = Rpc.define({
  id: RPC_ID,
  methods: {
    status: {
      input: {
        type: 'object',
        properties: { sessionID: { type: 'string' } },
        required: ['sessionID'],
        additionalProperties: false,
      },
      output: status,
    },
  },
  events: {
    [STATUS_EVENT]: { schema: status },
    [TOAST_EVENT]: { schema: toast },
  },
});
