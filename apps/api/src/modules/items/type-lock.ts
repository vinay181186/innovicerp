// Item Type / Track by Serial No. rules (ADR-193 P15 / P17 / P23, phase 4).
//
//   - Track by Serial No. is only for Tool / Instrument items.
//   - Once stock has moved, the type may not be switched to or from 'tool'.
//   - Once stock has moved or instruments are registered, Track by Serial No.
//     may not be turned on or off (the register and the ledger would disagree).

import type { ItemType } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import type { DbTransaction } from '../../db/with-user-context';
import { ConflictError, ValidationError } from '../../lib/errors';

export const SERIAL_ONLY_FOR_TOOLS = 'Track by Serial No. is only for Tool / Instrument items';

/** Create: the value to store (false unless asked for on a tool item). */
export function trackSerialForCreate(itemType: ItemType, trackSerial?: boolean): boolean {
  if (trackSerial && itemType !== 'tool') throw new ValidationError(SERIAL_ONLY_FOR_TOOLS);
  return trackSerial === true;
}

async function hasLedgerRows(tx: DbTransaction, itemId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.store_transactions WHERE item_id = ${itemId}::uuid LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

async function hasInstruments(tx: DbTransaction, itemId: string): Promise<boolean> {
  const rows = (await tx.execute(sql`
    SELECT 1 FROM public.instruments WHERE item_id = ${itemId}::uuid AND deleted_at IS NULL LIMIT 1
  `)) as unknown as unknown[];
  return rows.length > 0;
}

/**
 * Update: refuse a forbidden type / serial change, and return the
 * trackSerial value to write (undefined = leave it alone).
 */
export async function checkTypeAndSerialChange(
  tx: DbTransaction,
  itemId: string,
  cur: { code: string; itemType: ItemType; trackSerial: boolean },
  input: { itemType?: ItemType | undefined; trackSerial?: boolean | undefined },
): Promise<boolean | undefined> {
  const nextType = input.itemType ?? cur.itemType;
  if (
    input.itemType !== undefined &&
    input.itemType !== cur.itemType &&
    (input.itemType === 'tool' || cur.itemType === 'tool') &&
    (await hasLedgerRows(tx, itemId))
  ) {
    throw new ConflictError(
      `${cur.code}: Item Type cannot be changed to or from Tool / Instrument once stock has moved. Create a new item instead.`,
    );
  }
  if (input.trackSerial === true && nextType !== 'tool') {
    throw new ValidationError(SERIAL_ONLY_FOR_TOOLS);
  }
  // Leaving 'tool' (already proved stock never moved) clears the flag.
  const nextSerial = nextType !== 'tool' ? false : (input.trackSerial ?? cur.trackSerial);
  if (nextSerial === cur.trackSerial)
    return input.trackSerial === undefined ? undefined : nextSerial;
  if ((await hasLedgerRows(tx, itemId)) || (await hasInstruments(tx, itemId))) {
    throw new ConflictError(
      `${cur.code}: Track by Serial No. cannot be changed once stock has moved or instruments are registered. Create a new item instead.`,
    );
  }
  return nextSerial;
}
