// Data Integrity Check — cross-module linkage scan.
//
// Mirror of legacy runIntegrityCheck (HTML, called from Settings page
// L13427). Each check returns a count + sample records. The Settings
// page renders a green/red panel per check.

import { z } from 'zod';

export const integrityCheckResultSchema = z.object({
  code: z.string(),
  label: z.string(),
  severity: z.enum(['ok', 'warn', 'error']),
  count: z.number().int().nonnegative(),
  detail: z.string(),
  samples: z.array(z.string()),
});
export type IntegrityCheckResult = z.infer<typeof integrityCheckResultSchema>;

export const integrityCheckResponseSchema = z.object({
  ranAt: z.string(),
  results: z.array(integrityCheckResultSchema),
});
export type IntegrityCheckResponse = z.infer<typeof integrityCheckResponseSchema>;
