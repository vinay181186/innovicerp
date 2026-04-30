// Fixed namespace for UUIDv5 generation across the migration. NEVER change
// this value once data has been loaded — every UUID derived from a legacy id
// would shift, breaking already-loaded rows and any FK references.
//
// Generated once via crypto.randomUUID() on 2026-04-30; treated as a constant.
export const MIGRATION_UUID_NAMESPACE = 'f5b8a3a4-1c2d-4e3f-8a5b-6c7d8e9f0a1b';
