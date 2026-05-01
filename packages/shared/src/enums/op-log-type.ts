export const OP_LOG_TYPES = ['start', 'complete', 'qc'] as const;

export type OpLogType = (typeof OP_LOG_TYPES)[number];
