// Shared types for the load layer (T-015).

export interface LoadOptions {
  dryRun: boolean;
  only: ReadonlyArray<string> | null;
}

export interface LoadResult {
  table: string;
  attempted: number;
  inserted: number;
  conflicts: number; // rows skipped because (company_id, code) already exists
  dryRun: boolean;
  notes: string[];
}

export interface UserLoadOutcome {
  legacyId: string;
  email: string;
  newUserId: string;
  action: 'reused_existing' | 'invited_new' | 'updated_public_users' | 'skipped';
  inviteEmailSent: boolean;
  notes: string[];
}

export type IdMapPersisted = {
  version: number;
  generatedAt: string;
  note?: string;
} & Record<string, Record<string, string | null>>;
