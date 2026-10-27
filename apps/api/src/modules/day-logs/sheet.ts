// Day Log — ONE SHEET (owner 2026-10-27): several new rows saved together,
// all or nothing. Under ONE day lock (openDayLocked, lock.ts) in ONE
// transaction (§20.3): the first row starts at the day's nextStart, each
// next row where the previous one stopped; every row passes the same
// validateEntry as a single add, judged against the day's lines PLUS the
// rows before it (so strict order, overlaps and the break limit count the
// whole batch). The first failing row refuses the lot with "Row N: …".
// A resent batch is the Idempotency-Key plugin's (ADR-172). Every row is
// judged in memory against ONE snapshot (orders included) and all rows go in
// ONE multi-row INSERT — six round trips whatever the row count.

import {
  type AddDayLogEntriesInput,
  type DayLogDetail,
  DAY_LOG_RULES,
  summarizeDay,
} from '@innovic/shared';
import type { AuthContext } from '../../db/with-user-context';
import { AppError, ValidationError } from '../../lib/errors';
import { assertCanWrite, resolveAccess, viewerOf } from './access';
import { type DayLine, spansOf } from './day';
import {
  type Row,
  guardUnique,
  insertSql,
  label,
  lineOf,
  log,
  nextLineNo,
  ordersOf,
  prepare,
  writeLines,
} from './entry-write';
import { dayTx, openDayLocked } from './lock';
import { type DayLogClock, dmy, istClock } from './rules';
import { readSnapshot } from './snapshot';
import { guardOwnerWrite, ownerDetailAfter, requireCompany } from './writes';

/** A validated batch row as a line, so the rows after it are judged against it. */
const asLine = (r: Row, i: number, reportId: string): DayLine => ({
  id: `batch-row-${i}`,
  reportId,
  kind: r.kind,
  fromTime: r.fromTime,
  toTime: r.toTime,
  description: r.description,
  remarks: r.remarks,
  order: null,
  late: false,
  updatedAt: '',
});

/** "Row N: <reason>" — always a 400, whatever the single-add check threw. */
function rowError(n: number, e: unknown): never {
  if (e instanceof AppError) throw new ValidationError(`Row ${n}: ${e.message}`);
  throw e;
}

export async function addEntries(
  input: AddDayLogEntriesInput,
  user: AuthContext,
  clock: DayLogClock = istClock(), // tests only — routes never pass it
): Promise<DayLogDetail> {
  const companyId = requireCompany(user);
  return guardUnique(() =>
    dayTx(async (tx) => {
      // The day lock (§20.3): every write on this day queues here.
      const locked = await openDayLocked(tx, user, companyId, input.date);
      const eff = await resolveAccess(user, locked.access);
      assertCanWrite(eff);
      if (input.date > clock.today)
        throw new ValidationError(`${dmy(input.date)} has not come yet`);
      const h = locked.header;
      const snap = await readSnapshot(
        {
          companyId,
          viewerId: null,
          targetId: user.id,
          date: h.date,
          orders: ordersOf(input.rows),
        },
        tx,
      );
      guardOwnerWrite(h, snap, clock.today);
      const lines = snap.lines;
      let start = summarizeDay(spansOf(lines)).nextStart ?? DAY_LOG_RULES.workFrom;
      const rows: Row[] = [];
      for (const [i, row] of input.rows.entries()) {
        const n = i + 1;
        if (!row.stopTime && n < input.rows.length) {
          rowError(n, new ValidationError('Give a Stop time — only the last row may be left Open'));
        }
        if (!row.orderType !== !row.orderId) {
          rowError(n, new ValidationError('Pick the SO / JWSO again'));
        }
        const before = [...lines, ...rows.map((r, j) => asLine(r, j, h.id))];
        let r: Row;
        try {
          r = prepare(h, before, { ...row, startTime: start }, null, clock, snap);
        } catch (e) {
          rowError(n, e);
        }
        rows.push(r);
        if (r.toTime) start = r.toTime;
      }
      const written = await writeLines(
        tx,
        h,
        user,
        insertSql(companyId, h, user, rows, nextLineNo(lines)),
      );
      const names = rows.map((r) => `${label(r)}${r.orderCode ? ` (${r.orderCode})` : ''}`);
      await log(tx, companyId, user, h, 'CREATE', `added ${rows.length} rows: ${names.join('; ')}`);
      // RETURNING is ordered by line_no, the order the rows were given.
      const added = rows.map((r, i) => lineOf(r, written[i]!, h.id));
      return ownerDetailAfter(snap, h, [...lines, ...added], viewerOf(user, eff), clock);
    }),
  );
}
