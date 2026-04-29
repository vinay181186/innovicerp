export const USER_ROLES = [
  'admin',
  'manager',
  'operator',
  'qc',
  'procurement',
  'dispatch',
  'design',
  'viewer',
] as const;

export type UserRole = (typeof USER_ROLES)[number];
