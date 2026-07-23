import type { UserRole } from '../enums/user-role';

export interface MeResponse {
  id: string;
  email: string;
  fullName?: string | null;
  companyId: string | null;
  role: UserRole;
  isActive: boolean;
}
