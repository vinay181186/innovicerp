import { z } from 'zod';
import { activityReasonSchema } from '@innovic/shared';
export {
  bulkCreateVendorsInputSchema,
  createVendorInputSchema,
  listVendorsQuerySchema,
  updateVendorImportRowSchema,
  updateVendorInputSchema,
  vendorSchema,
} from '@innovic/shared';
export type {
  BulkCreateVendorsInput,
  BulkCreateVendorsResponse,
  BulkVendorSkip,
  CreateVendorInput,
  ListVendorsQuery,
  ListVendorsResponse,
  UpdateVendorInput,
  Vendor,
  VendorSaveResponse,
} from '@innovic/shared';

// ADR-197: moving a vendor to Trash needs a reason (REASON_REQUIRED_ACTIONS).
// Hosted here, not in @innovic/shared (frozen for this build) — the web sends
// `{ reason }` as the DELETE body.
export const deleteVendorInputSchema = z.object({ reason: activityReasonSchema });
