import { z } from 'zod';

/**
 * A true/false flag read from a URL query string.
 *
 * `z.coerce.boolean()` must NOT be used for query flags: it runs
 * `Boolean("false")`, which is `true`, so `?isActive=false` asked for the exact
 * opposite of what it said (inactive masters could never be listed). This
 * accepts the literal strings 'true' / 'false' (and a real boolean, for callers
 * that parse an already-typed object) and rejects anything else with a 400.
 */
export const queryBoolean = () =>
  z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
