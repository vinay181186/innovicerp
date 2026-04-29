import type { UserRole } from '../enums/user-role';

export interface MeResponse {
  id: string;
  email: string;
  companyId: string | null;
  role: UserRole;
  isActive: boolean;
}
