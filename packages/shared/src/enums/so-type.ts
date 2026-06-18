export const SO_TYPES = ['component_manufacturing', 'equipment', 'with_material'] as const;

export type SoType = (typeof SO_TYPES)[number];

// Types offered when creating an SO or filtering the list. 'with_material' is
// retained as a valid stored value so existing With-Material SOs still load,
// but it is no longer creatable or filterable (user decision 2026-06-18).
export const SELECTABLE_SO_TYPES = SO_TYPES.filter(
  (t): t is Exclude<SoType, 'with_material'> => t !== 'with_material',
);
