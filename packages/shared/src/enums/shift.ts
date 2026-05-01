export const SHIFTS = ['day', 'night'] as const;

export type Shift = (typeof SHIFTS)[number];
