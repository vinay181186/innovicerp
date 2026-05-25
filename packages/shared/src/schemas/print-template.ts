// Print Templates shared schemas + defaults + variable catalogue.
//
// Single source of truth for the customisable print blocks on the three
// printed documents (PO / OSP DC / JW DC). The API falls back to
// PRINT_TEMPLATE_DEFAULTS when a company has no customised row; the web
// editor uses the same defaults for preview and the print windows use
// `substituteTemplateVars` to inject real data.
//
// Mirror of legacy _PT_DEFAULTS / _PT_META / _PT_VARS / _substituteVariables
// (renderPrintTemplates infra, HTML L14439-14541). See
// docs/PARITY/print-templates.md. Backed by migration 0042.

import { z } from 'zod';

// ── Document types (the only 3 with customisable templates) ──
export const PRINT_DOC_TYPES = ['PO', 'OSP DC', 'JW DC'] as const;
export type PrintDocType = (typeof PRINT_DOC_TYPES)[number];

// ── The 5 editable blocks per document (in print order) ──
export const PRINT_TEMPLATE_BLOCKS = [
  'header_note',
  'special_notes',
  'terms',
  'footer',
  'signature',
] as const;
export type PrintTemplateBlock = (typeof PRINT_TEMPLATE_BLOCKS)[number];

// docType → template-key prefix
export const PRINT_DOC_KEY_PREFIX: Record<PrintDocType, string> = {
  PO: 'po',
  'OSP DC': 'ospdc',
  'JW DC': 'jwdc',
};

// ── Per-block metadata (drives the editor list) ──
export interface PrintTemplateMeta {
  key: string;
  doc: PrintDocType;
  block: PrintTemplateBlock;
  name: string;
  position: string;
}

const BLOCK_NAME: Record<PrintTemplateBlock, string> = {
  header_note: 'Header Note',
  special_notes: 'Special Notes',
  terms: 'Terms & Conditions',
  footer: 'Footer',
  signature: 'Signature Block',
};
const BLOCK_POSITION: Record<PrintTemplateBlock, string> = {
  header_note: 'Top of document, above line items',
  special_notes: 'Below totals, above Terms & Conditions',
  terms: 'Below Special Notes',
  footer: 'Bottom of page (jurisdiction, E.&O.E.)',
  signature: 'Bottom-right corner',
};

export const PRINT_TEMPLATE_META: readonly PrintTemplateMeta[] = PRINT_DOC_TYPES.flatMap((doc) =>
  PRINT_TEMPLATE_BLOCKS.map((block) => ({
    key: `${PRINT_DOC_KEY_PREFIX[doc]}_${block}`,
    doc,
    block,
    name: BLOCK_NAME[block],
    position: BLOCK_POSITION[block],
  })),
);

export const PRINT_TEMPLATE_KEYS: readonly string[] = PRINT_TEMPLATE_META.map((m) => m.key);

export function isPrintTemplateKey(key: string): boolean {
  return PRINT_TEMPLATE_KEYS.includes(key);
}

export function printTemplateDocType(key: string): PrintDocType | null {
  if (key.startsWith('po_')) return 'PO';
  if (key.startsWith('ospdc_')) return 'OSP DC';
  if (key.startsWith('jwdc_')) return 'JW DC';
  return null;
}

// ── Factory defaults (verbatim from legacy _PT_DEFAULTS L14439-14459) ──
export const PRINT_TEMPLATE_DEFAULTS: Record<string, string> = {
  // PURCHASE ORDER
  po_header_note:
    'Please supply the items as per specifications mentioned in this Purchase Order. Quote our PO number {poNo} on all correspondence, invoices and delivery challans.',
  po_special_notes: '',
  po_terms:
    '1. Goods supplied must conform to our specifications strictly.\n2. Payment will be made as per agreed terms ({paymentTerms}).\n3. Delivery as per the agreed schedule. Late delivery may attract penalty.\n4. Test certificates and inspection reports must accompany the supply where applicable.\n5. Goods rejected during inspection shall be replaced at vendor’s cost.\n6. All disputes are subject to V.U. Nagar jurisdiction only.',
  po_footer:
    'E. & O.E.   |   Subject to V.U. Nagar (Anand) Jurisdiction   |   This is a computer generated document.',
  po_signature: 'For Innovic Technology\n\n\n\nAuthorised Signatory',

  // OSP DELIVERY CHALLAN
  ospdc_header_note:
    'Material is being sent to the vendor for the process specified below. Vendor must acknowledge receipt by signing and returning a copy of this challan.',
  ospdc_special_notes: '',
  ospdc_terms:
    '1. Material is sent on a returnable basis for processing only.\n2. Material to be returned within agreed timeline along with processed output.\n3. Any rejection or scrap during processing must be returned with finished goods.\n4. Vendor is responsible for material damage or loss during transit and processing.\n5. Any subcontracting or outsourcing of this work without prior written consent is prohibited.',
  ospdc_footer:
    'E. & O.E.   |   Subject to V.U. Nagar (Anand) Jurisdiction   |   This is a computer generated document.',
  ospdc_signature: 'For Innovic Technology\n\n\n\nAuthorised Signatory',

  // JOB WORK DELIVERY CHALLAN
  jwdc_header_note:
    'Material is being sent to the job-work vendor for the operation specified below. This is a returnable gate pass under the Job Work provisions of GST.',
  jwdc_special_notes: '',
  jwdc_terms:
    '1. Material is sent on returnable basis under GST Job Work provisions.\n2. Material to be returned within the timeline mandated by GST law.\n3. All scrap, waste and rejections must be returned along with the finished goods.\n4. Vendor must not use this material for any purpose other than the specified job work.\n5. Subcontracting of this job work without prior written consent is prohibited.\n6. Loss or damage during transit and processing is the vendor’s responsibility.',
  jwdc_footer:
    'E. & O.E.   |   Subject to V.U. Nagar (Anand) Jurisdiction   |   This is a computer generated document.',
  jwdc_signature: 'For Innovic Technology\n\n\n\nAuthorised Signatory',
};

export function printTemplateDefault(key: string): string {
  return PRINT_TEMPLATE_DEFAULTS[key] ?? '';
}

// ── Variables available per document type (legacy _PT_VARS L14487) ──
export const PRINT_TEMPLATE_VARS: Record<PrintDocType, readonly string[]> = {
  PO: [
    'companyName',
    'companyAddress',
    'companyGSTIN',
    'companyPhone',
    'companyEmail',
    'date',
    'currentUser',
    'poNo',
    'poDate',
    'paymentTerms',
    'deliveryTerms',
    'vendorName',
    'vendorAddress',
    'vendorGSTIN',
    'vendorContact',
    'totalValue',
    'totalQty',
  ],
  'OSP DC': [
    'companyName',
    'companyAddress',
    'companyGSTIN',
    'date',
    'currentUser',
    'dcNo',
    'dcDate',
    'purpose',
    'recipientName',
    'recipientAddress',
    'vehicleNo',
    'driverName',
    'linkedPONo',
    'totalQty',
  ],
  'JW DC': [
    'companyName',
    'companyAddress',
    'companyGSTIN',
    'date',
    'currentUser',
    'dcNo',
    'dcDate',
    'purpose',
    'recipientName',
    'recipientAddress',
    'vehicleNo',
    'driverName',
    'linkedPONo',
    'totalQty',
  ],
};

export function printTemplateVarsFor(key: string): readonly string[] {
  const doc = printTemplateDocType(key);
  return doc ? PRINT_TEMPLATE_VARS[doc] : [];
}

// ── Variable substitution (legacy _substituteVariables L14508) ──
// `{var}` → data[var] (null → ''). Unknown var → '' (blank, not the token).
const TEMPLATE_VAR_RE = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function substituteTemplateVars(
  text: string | null | undefined,
  data: Record<string, unknown>,
): string {
  if (!text) return '';
  return String(text).replace(TEMPLATE_VAR_RE, (_match, varName: string) => {
    if (Object.prototype.hasOwnProperty.call(data, varName)) {
      const v = data[varName];
      return v == null ? '' : String(v);
    }
    return '';
  });
}

// Return the list of {vars} in `text` that are not in `allowed` (legacy
// _validateTemplateVars L14520) — used for the non-blocking editor warning.
export function unknownTemplateVars(text: string, allowed: readonly string[]): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(TEMPLATE_VAR_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    const name = m[1] as string;
    if (!allowed.includes(name)) found.add(name);
  }
  return [...found];
}

// ══════════════════════════════════════════════════════════════════
// Zod schemas + API I/O types
// ══════════════════════════════════════════════════════════════════

export const printTemplateKeySchema = z
  .string()
  .refine(isPrintTemplateKey, 'unknown print template key');

// Effective template = customised-or-default content + edit metadata.
export const effectivePrintTemplateSchema = z.object({
  templateKey: z.string(),
  doc: z.enum(PRINT_DOC_TYPES),
  block: z.enum(PRINT_TEMPLATE_BLOCKS),
  name: z.string(),
  position: z.string(),
  content: z.string(),
  isCustomised: z.boolean(),
  lastEditedBy: z.string().nullable(),
  lastEditedAt: z.string().nullable(),
  revisionCount: z.number().int().nonnegative(),
});
export type EffectivePrintTemplate = z.infer<typeof effectivePrintTemplateSchema>;

export interface ListPrintTemplatesResponse {
  items: EffectivePrintTemplate[];
}

export const savePrintTemplateInputSchema = z.object({
  content: z.string().max(20000),
});
export type SavePrintTemplateInput = z.infer<typeof savePrintTemplateInputSchema>;

export const printTemplateRevisionSchema = z.object({
  id: z.string().uuid(),
  templateKey: z.string(),
  content: z.string(),
  createdAt: z.string(),
  createdBy: z.string().uuid(),
  editedByName: z.string().nullable(),
});
export type PrintTemplateRevision = z.infer<typeof printTemplateRevisionSchema>;

export interface ListPrintTemplateRevisionsResponse {
  items: PrintTemplateRevision[];
}
