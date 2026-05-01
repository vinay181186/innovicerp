export const SO_TYPES = ['component_manufacturing', 'equipment', 'with_material'] as const;

export type SoType = (typeof SO_TYPES)[number];
