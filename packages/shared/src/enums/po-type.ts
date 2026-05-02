// Purchase Order type. Legacy seen value: 'Job Work'. The other 3 values
// (standard / outsource / service) are forward — explicit beats derived
// for filtering and reporting (ADR-015 #6).
export const PO_TYPES = ['standard', 'job_work', 'outsource', 'service'] as const;
export type PoType = (typeof PO_TYPES)[number];
