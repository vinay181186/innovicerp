export const JC_PRIORITIES = ['normal', 'high'] as const;

export type JcPriority = (typeof JC_PRIORITIES)[number];
