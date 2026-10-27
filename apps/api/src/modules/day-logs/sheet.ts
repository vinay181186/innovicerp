// Day Log — ONE SHEET (owner 2026-10-27): several new rows saved together,
// all or nothing. Under ONE day lock (openDay, FOR UPDATE) in ONE
// transaction (§20.3): the first row starts at the day's nextStart, each
// next row where the previous one stopped; every row passes the same
// validateEntry as a single add, judged against the day's lines PLUS the
// rows before it (so strict order, overlaps and the break limit count the
// whole batch). The first failing row refuses the lot with "Row N: …".
// A resent batch is the Idempotency-Key plugin's (ADR-172).

import {
  type AddDayLogEntriesInput,
  type DayLogDetail,
  DAY_LOG_RULES,
  summarizeDay,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireCanWrite } from '../../lib/access';
import { AppError, ValidationError } from '../../lib/errors';
import { loadViewer } from './access';
import { type DayLine, loadLines, nextLineNo, openDay, spansOf, touchDay } from './day';
import { type Row, guardUnique, label, log, prepare } from './entries';
import { type DayLogClock, dmy, istClock } from './rules';
import { guardOwnerWrite, hoursOf, ownerDetail, requireCompany } from './writes';

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
  await requireCanWrite(user);
  const v = await loadViewer(user); // before the tx (ADR-229)
  const companyId = requireCompany(user);
  if (input.date > clock.today) throw new ValidationError(`${dmy(input.date)} has not come yet`);
  return guardUnique(() =>
    withUserContext(user, async (tx) => {
      // The day lock (§20.3): every write on this day queues here.
      const h = await openDay(tx, companyId, user.id, input.date, user);
      await guardOwnerWrite(tx, companyId, h, clock.today);
      const lines = await loadLines(tx, companyId, h.id);
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
        const r = await prepare(
          tx,
          companyId,
          h,
          before,
          { ...row, startTime: start },
          null,
          clock,
        ).catch((e: unknown) => rowError(n, e));
        rows.push(r);
        if (r.toTime) start = r.toTime;
      }
      let lineNo = await nextLineNo(tx, h.id);
      for (const r of rows) {
        await tx.execute(sql`
          INSERT INTO public.daily_report_lines
            (company_id, daily_report_id, line_no, description, kind, from_time, to_time,
             status, hours, remarks, sales_order_id, job_work_order_id, created_by, updated_by)
          VALUES (${companyId}::uuid, ${h.id}::uuid, ${lineNo}, ${r.description},
                  ${r.kind}, ${r.fromTime}::time, ${r.toTime}::time,
                  ${r.toTime ? 'completed' : 'in_progress'}, ${hoursOf(r.fromTime, r.toTime)},
                  ${r.remarks}, ${r.soId}::uuid, ${r.jwId}::uuid, ${user.id}::uuid, ${user.id}::uuid)
        `);
        lineNo += 1;
      }
      await touchDay(tx, h.id, user);
      const names = rows.map((r) => `${label(r)}${r.orderCode ? ` (${r.orderCode})` : ''}`);
      await log(tx, companyId, user, h, 'CREATE', `added ${rows.length} rows: ${names.join('; ')}`);
      return ownerDetail(tx, companyId, v, user, h.date, clock);
    }),
  );
}
