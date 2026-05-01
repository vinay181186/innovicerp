export const RUNNING_OP_STATUSES = ['running', 'done', 'stopped'] as const;

export type RunningOpStatus = (typeof RUNNING_OP_STATUSES)[number];
