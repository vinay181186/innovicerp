// Instrument register — ADR-193 phase 4a.
//
// A Tool / Instrument item with `trackSerial` has one register row per piece
// (Instrument Serial No.). Registering never moves stock: it names a piece already
// received (GRN / Stock Count), so In Store + At Calibration ≤ On Hand.
// An instrument past its Calibration Due date cannot be issued.

import { z } from 'zod';

export const INSTRUMENT_STATUSES = [
  'in_store',
  'issued',
  'at_calibration',
  'lost',
  'scrapped',
] as const;
export type InstrumentStatus = (typeof INSTRUMENT_STATUSES)[number];
export const INSTRUMENT_STATUS_LABELS: Record<InstrumentStatus, string> = {
  in_store: 'In Store',
  issued: 'Issued',
  at_calibration: 'At Calibration',
  lost: 'Lost',
  scrapped: 'Scrapped',
};

export const CALIBRATION_RESULTS = ['pass', 'fail'] as const;
export type CalibrationResult = (typeof CALIBRATION_RESULTS)[number];

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const INSTRUMENT_REASON_MIN = 10;
const reason = z
  .string()
  .trim()
  .min(INSTRUMENT_REASON_MIN, `Give a reason (at least ${INSTRUMENT_REASON_MIN} characters)`)
  .max(500);

// ─── Write inputs ──────────────────────────────────────────────────────────

export const createInstrumentInputSchema = z.object({
  itemId: z.string().uuid(),
  serialNo: z.string().trim().min(1, 'Enter the Instrument Serial No.').max(80),
  /** Days between calibrations; null = not calibrated (e.g. a plain fixture). */
  calibrationIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  lastCalibratedOn: isoDate.optional(),
  /** Defaults to lastCalibratedOn + interval when both are given. */
  calibrationDueOn: isoDate.optional(),
  location: z.string().trim().max(100).optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type CreateInstrumentInput = z.infer<typeof createInstrumentInputSchema>;

export const updateInstrumentInputSchema = z.object({
  /** Correct a mistyped Instrument Serial No. — only while it was never issued. */
  serialNo: z.string().trim().min(1).max(80).optional(),
  calibrationIntervalDays: z.number().int().positive().max(3650).nullable().optional(),
  location: z.string().trim().max(100).nullable().optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
});
export type UpdateInstrumentInput = z.infer<typeof updateInstrumentInputSchema>;

/** Send an in-store instrument to the calibration agency (no stock move). */
export const sendForCalibrationInputSchema = z.object({
  sentOn: isoDate,
  agency: z.string().trim().min(1, 'Enter the calibration agency').max(120),
});
export type SendForCalibrationInput = z.infer<typeof sendForCalibrationInputSchema>;

/** Record a calibration. Pass → due = nextDueOn ?? calibratedOn + interval;
 *  Fail → due = calibratedOn (blocked from issue until a Pass or a Scrap). */
export const recordCalibrationInputSchema = z.object({
  calibratedOn: isoDate,
  result: z.enum(CALIBRATION_RESULTS),
  certificateNo: z.string().trim().max(80).optional(),
  agency: z.string().trim().max(120).optional(),
  nextDueOn: isoDate.optional(),
  remarks: z.string().trim().max(500).optional(),
});
export type RecordCalibrationInput = z.infer<typeof recordCalibrationInputSchema>;

/** Ask to scrap an in-store instrument → a pending write-off (approve tier). */
export const scrapInstrumentInputSchema = z.object({ reason });
export type ScrapInstrumentInput = z.infer<typeof scrapInstrumentInputSchema>;

/** An In Store piece that cannot be found (stock count) → a pending Lost
 *  write-off; on approval it becomes Lost and leaves stock (OUT 1). */
export const markMissingInstrumentInputSchema = z.object({ reason });
export type MarkMissingInstrumentInput = z.infer<typeof markMissingInstrumentInputSchema>;

// ─── Read shapes ───────────────────────────────────────────────────────────

export interface InstrumentCalibration {
  id: string;
  calibratedOn: string;
  result: CalibrationResult;
  certificateNo: string | null;
  agency: string | null;
  nextDueOn: string | null;
  remarks: string | null;
  recordedByName: string | null;
}

export interface InstrumentListItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string | null;
  serialNo: string;
  status: InstrumentStatus;
  calibrationIntervalDays: number | null;
  lastCalibratedOn: string | null;
  calibrationDueOn: string | null;
  /** calibrationDueOn < today (IST). */
  isCalibrationOverdue: boolean;
  location: string | null;
  remarks: string | null;
  /** Holder when Issued: operator name or typed name, and the TIS- code. */
  heldBy: string | null;
  toolIssueCode: string | null;
  /** A Scrap / Damaged / Lost write-off waits for approval (blocks issue). */
  writeoffPending: boolean;
}

export interface InstrumentDetail extends InstrumentListItem {
  calibrations: InstrumentCalibration[];
}

export const listInstrumentsQuerySchema = z.object({
  search: z.string().min(1).max(100).optional(),
  itemId: z.string().uuid().optional(),
  status: z.enum(INSTRUMENT_STATUSES).optional(),
  /** overdue = due before today; week = due within the next 7 days (incl. overdue). */
  due: z.enum(['overdue', 'week']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type ListInstrumentsQuery = z.infer<typeof listInstrumentsQuerySchema>;

export interface ListInstrumentsResponse {
  items: InstrumentListItem[];
  total: number;
  limit: number;
  offset: number;
}

/** Per serial item: pieces received but not yet registered. */
export interface UnregisteredCount {
  itemId: string;
  itemCode: string;
  onHandQty: number;
  registeredInStoreQty: number;
  unregisteredQty: number;
}
