// TPI Master — the third-party inspectors this company actually works with.
//
// The TPI entry screen asked for Inspector Name and Organization as free text,
// so the same inspector arrived as "Mr. Sharma", "Mr sharma" and "R. Sharma"
// on three different job cards and no TPI history could be grouped by person.
// This master is the list those two fields now pick from.
//
// Shaped as a deliberate sibling of QC Process Master (schemas/qc-process.ts),
// the master sitting next to it in the Quality menu: `code` IS the name the
// user types and reads — unique per company and permanent, because it is what
// every TPI log snapshots — and `organization` rides along so picking an
// inspector fills in who they inspect for.
//
// The TPI log itself still stores the NAME as text (op_log.tpi_inspector), not
// a foreign key. That is deliberate: a QC log is a record of what was true on
// the day, and renaming or retiring an inspector must not rewrite inspections
// they already signed off.

import { z } from 'zod';

// Same permitted characters as QC Process Master, plus '&' and ',' — inspector
// names and firm names carry them ("R. Sharma & Co.", "Bureau Veritas, Mumbai").
const nameRegex = /^[A-Za-z0-9._,&() -]+$/;

export const tpiMasterSchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
  /** The inspector's name. Labelled "Inspector Name" throughout the UI; stored
   *  in `code` so this master matches its QC Process Master sibling column for
   *  column, including the permanent-once-created rule. */
  code: z.string().min(1).max(120),
  organization: z.string().nullable(),
  contactNo: z.string().nullable(),
  email: z.string().nullable(),
  remarks: z.string().nullable(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid(),
  deletedAt: z.string().nullable(),
});
export type TpiMaster = z.infer<typeof tpiMasterSchema>;

export const createTpiMasterInputSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(120)
    .regex(
      nameRegex,
      'Inspector name may contain only letters, digits, spaces, dot, comma, ampersand, brackets, underscore, hyphen',
    ),
  organization: z.string().max(255).optional(),
  contactNo: z.string().max(32).optional(),
  email: z.string().max(255).email('Enter a valid email address').optional().or(z.literal('')),
  remarks: z.string().max(1000).optional(),
  isActive: z.boolean().default(true),
});
export type CreateTpiMasterInput = z.infer<typeof createTpiMasterInputSchema>;

/** `code` is omitted on purpose: the name is permanent once created, because
 *  every TPI log that has already snapshotted it would otherwise disagree with
 *  the master. Retire an inspector with isActive instead — same asymmetry as
 *  QC Process Master and the cost-centers master. */
export const updateTpiMasterInputSchema = createTpiMasterInputSchema.partial().omit({ code: true });
export type UpdateTpiMasterInput = z.infer<typeof updateTpiMasterInputSchema>;

export const listTpiMastersQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  isActive: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListTpiMastersQuery = z.infer<typeof listTpiMastersQuerySchema>;

export interface ListTpiMastersResponse {
  items: TpiMaster[];
  total: number;
}
