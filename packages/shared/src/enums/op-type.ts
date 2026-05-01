export const OP_TYPES = ['process', 'qc', 'outsource'] as const;

export type OpType = (typeof OP_TYPES)[number];
