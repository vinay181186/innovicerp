// Lookup-registry helpers for Phase 3 transforms (T-024c).
//
// Phase 3 source data references master rows by business key (e.g. itemCode,
// machineId, jcNo) rather than by short-id, so transforms need code → uuid
// maps. The orchestrator builds these incrementally from in-memory transform
// results AND can pre-load them from disk when only a subset of transforms
// runs (e.g. `--only=jobCards`).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LookupRegistry } from './types';

export function emptyRegistry(): LookupRegistry {
  return { byCode: {}, byName: {}, byCompositeKey: {} };
}

export function getOrCreate<K, V>(map: Map<K, V> | undefined, init: () => Map<K, V>): Map<K, V> {
  if (map) return map;
  return init();
}

// Read a transform output JSON file from disk and rebuild a code→uuid map.
// Used when a Phase 3 transform runs without its dependencies in memory.
export function loadCodeLookupFromDisk(
  transformDir: string,
  table: string,
  codeField: string,
): Map<string, string> | null {
  try {
    const path = join(transformDir, `${table}.json`);
    const data = JSON.parse(readFileSync(path, 'utf8')) as { rows?: Array<Record<string, unknown>> };
    const rows = data.rows ?? [];
    const map = new Map<string, string>();
    for (const r of rows) {
      const code = r[codeField];
      const id = r['id'];
      if (typeof code === 'string' && typeof id === 'string') {
        map.set(code, id);
      }
    }
    return map;
  } catch {
    return null;
  }
}

// Same as loadCodeLookupFromDisk but for name-based lookups (e.g. operators).
export function loadNameLookupFromDisk(
  transformDir: string,
  table: string,
  nameField: string,
): Map<string, string> | null {
  try {
    const path = join(transformDir, `${table}.json`);
    const data = JSON.parse(readFileSync(path, 'utf8')) as { rows?: Array<Record<string, unknown>> };
    const rows = data.rows ?? [];
    const map = new Map<string, string>();
    for (const r of rows) {
      const name = r[nameField];
      const id = r['id'];
      if (typeof name === 'string' && typeof id === 'string') {
        map.set(name.trim().toLowerCase(), id);
      }
    }
    return map;
  } catch {
    return null;
  }
}

export function ensureLookup(
  registry: LookupRegistry,
  bucket: 'byCode' | 'byName' | 'byCompositeKey',
  table: string,
  loader: () => Map<string, string> | null,
): Map<string, string> | null {
  if (registry[bucket][table]) return registry[bucket][table];
  const m = loader();
  if (m) registry[bucket][table] = m;
  return m;
}
