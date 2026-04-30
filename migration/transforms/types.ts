// Shared types for the per-collection transform layer (T-014).

export interface Anomaly {
  legacyId: string;
  type: string;
  details?: unknown;
}

export interface TransformResult<T> {
  table: string;
  sourceCollection: string;
  transformedAt: string;
  rows: T[];
  anomalies: Anomaly[];
}

// Map of legacy short-id → resolved key (UUID for tables we own, or null for
// tables whose ids are assigned at load time, e.g. users via Supabase Auth).
export type IdMap = Record<string, Record<string, string | null>>;

export interface TransformContext {
  idMap: IdMap;
  // Add more context here later (e.g. seed company id when known at transform
  // time, current run timestamp, etc.).
}
