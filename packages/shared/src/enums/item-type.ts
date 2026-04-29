export const ITEM_TYPES = ['component', 'assembly'] as const;

export type ItemType = (typeof ITEM_TYPES)[number];
