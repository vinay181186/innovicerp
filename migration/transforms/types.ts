// Shared types for the per-collection transform layer (T-014, T-024c).

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

// Business-key → uuid lookups built incrementally as transforms run.
// Phase 3 transforms (T-024c) need to FK-resolve by code/jcNo because legacy
// data references master rows by business key, not by short-id. Each entry is
// a Map<business-key, uuid>. Composite keys use `${jcNo}::${opSeq}` form.
export interface LookupRegistry {
  byCode: Record<string, Map<string, string>>;
  byName: Record<string, Map<string, string>>;
  byCompositeKey: Record<string, Map<string, string>>;
}

export interface TransformContext {
  idMap: IdMap;
  lookups: LookupRegistry;
}
