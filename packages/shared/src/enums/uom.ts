export const UOMS = ['NOS', 'KGS', 'SET', 'MTR'] as const;

export type Uom = (typeof UOMS)[number];
