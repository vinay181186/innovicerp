// Legal copy of the customer on a legal paper (plan v3 Step 4, owner decision
// D7 — ERPNext "address_display"; migration 0186).
//
// The Tax Invoice, JW Invoice, customer Dispatch (delivery challan) and JW
// Return Challan save the customer's name, address, GSTIN and State when they
// are made. Their prints read THIS copy, so a later edit of the customer master
// never changes a paper already issued. Working screens keep reading the live
// master.
//
// `clientCopy` is null only for a row made by code older than 0186 (no copy
// taken) — the print then falls back to the live customer master.

import { z } from 'zod';

export const clientCopySchema = z.object({
  name: z.string().nullable(),
  /** GSTIN as billed (NAMING: gstNumber). */
  gstNumber: z.string().nullable(),
  addressLine1: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  stateCode: z.string().nullable(),
  pincode: z.string().nullable(),
  /** Place of Supply — GST State Code billed / shipped to. Null = unknown. */
  placeOfSupply: z.string().nullable(),
});
export type ClientCopy = z.infer<typeof clientCopySchema>;
