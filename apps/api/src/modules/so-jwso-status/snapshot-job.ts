// SO / JWSO status by day (ADR-325) — THE one writer of so_status_snapshots
// (§20.1). Every SO_STATUS_SNAPSHOT_INTERVAL_MS it rewrites TODAY's (IST) saved
// copy for every company; a past day is never touched, so once the day ends its
// last copy stands.
//
// One transaction per company:
//   1. pg_try_advisory_xact_lock — a second API instance (or an overlapping
//      tick) skips instead of writing the same rows twice;
//   2. rows = loadOrderStatusRows (the one reader, same as the live screen);
//   3. upsert today's row per order (ON CONFLICT on the live unique index);
//   4. soft-delete today's rows whose order left the set (cancelled / deleted
//      since the last run) — their taken_at is older than this run's.
//
// The writer is a system timer with no signed-in user: created_by /
// updated_by stay NULL (0269 header). Started from server.ts only, never under
// test, off when SO_STATUS_SNAPSHOT_ENABLED=false.

import { sfTodayIst } from '@innovic/shared';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { type Db, db as rootDb } from '../../db/client';
import { companies, soStatusSnapshots } from '../../db/schema';
import { env } from '../../lib/env';
import { type Logger, logger as rootLogger } from '../../lib/logger';
import {
  SO_STATUS_SNAPSHOT_ENABLED_ENV,
  SO_STATUS_SNAPSHOT_FIRST_RUN_MS,
  SO_STATUS_SNAPSHOT_INTERVAL_MS,
  SNAPSHOT_INSERT_CHUNK,
  SO_STATUS_SNAPSHOT_LOCK_KEY,
} from './constants';
import { loadOrderStatusRows } from './figures';

export type SnapshotResult = { status: 'written'; rows: number } | { status: 'skipped' };

/** Take (or refresh) today's saved copy for one company. */
export async function takeSoStatusSnapshot(db: Db, companyId: string): Promise<SnapshotResult> {
  return db.transaction(async (tx) => {
    const got = (await tx.execute(
      sql`SELECT pg_try_advisory_xact_lock(hashtext(${SO_STATUS_SNAPSHOT_LOCK_KEY})) AS got`,
    )) as unknown as Array<{ got: boolean }>;
    if (!got[0]?.got) return { status: 'skipped' } as const;

    const snapDate = sfTodayIst();
    const takenAt = new Date();
    const rows = await loadOrderStatusRows(tx, companyId);

    // Chunked: one statement may carry at most 65,535 parameters (~17 per row).
    for (let i = 0; i < rows.length; i += SNAPSHOT_INSERT_CHUNK) {
      const chunk = rows.slice(i, i + SNAPSHOT_INSERT_CHUNK);
      await tx
        .insert(soStatusSnapshots)
        .values(chunk.map((r) => ({ ...r, companyId, snapDate, takenAt })))
        .onConflictDoUpdate({
          target: [
            soStatusSnapshots.companyId,
            soStatusSnapshots.snapDate,
            soStatusSnapshots.orderKind,
            soStatusSnapshots.orderId,
          ],
          targetWhere: sql`deleted_at IS NULL`,
          set: {
            orderCode: sql`excluded.order_code`,
            totalLines: sql`excluded.total_lines`,
            totalPlans: sql`excluded.total_plans`,
            totalRc: sql`excluded.total_rc`,
            proReleased: sql`excluded.pro_released`,
            jcReleased: sql`excluded.jc_released`,
            jcNotStarted: sql`excluded.jc_not_started`,
            jcRunning: sql`excluded.jc_running`,
            jcClosed: sql`excluded.jc_closed`,
            proClosed: sql`excluded.pro_closed`,
            dispatchQty: sql`excluded.dispatch_qty`,
            physicalStock: sql`excluded.physical_stock`,
            takenAt: sql`excluded.taken_at`,
          },
        });
    }

    // Orders no longer in the set: every row this run wrote carries takenAt.
    await tx
      .update(soStatusSnapshots)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(soStatusSnapshots.companyId, companyId),
          eq(soStatusSnapshots.snapDate, snapDate),
          isNull(soStatusSnapshots.deletedAt),
          ne(soStatusSnapshots.takenAt, takenAt),
        ),
      );

    return { status: 'written', rows: rows.length } as const;
  });
}

let running = false;

/** One tick: every company in turn. Never throws. */
async function runAll(log: Logger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const list = await rootDb
      .select({ id: companies.id })
      .from(companies)
      .where(isNull(companies.deletedAt));
    for (const c of list) {
      try {
        const res = await takeSoStatusSnapshot(rootDb, c.id);
        log.info({ companyId: c.id, ...res }, 'SO / JWSO status snapshot');
      } catch (err) {
        log.error({ err, companyId: c.id }, 'SO / JWSO status snapshot failed');
      }
    }
  } catch (err) {
    log.error({ err }, 'SO / JWSO status snapshot: company list failed');
  } finally {
    running = false;
  }
}

let first: NodeJS.Timeout | null = null;
let tick: NodeJS.Timeout | null = null;

/** Start the 10-minute timer. server.ts only. */
export function startSoStatusSnapshotJob(log: Logger = rootLogger): void {
  if (tick || first) return;
  if (env.NODE_ENV === 'test') return;
  if (process.env[SO_STATUS_SNAPSHOT_ENABLED_ENV] === 'false') {
    log.info('SO / JWSO status snapshot timer off (SO_STATUS_SNAPSHOT_ENABLED=false)');
    return;
  }
  first = setTimeout(() => {
    first = null;
    void runAll(log);
    tick = setInterval(() => void runAll(log), SO_STATUS_SNAPSHOT_INTERVAL_MS);
    tick.unref();
  }, SO_STATUS_SNAPSHOT_FIRST_RUN_MS);
  first.unref();
  log.info({ everyMs: SO_STATUS_SNAPSHOT_INTERVAL_MS }, 'SO / JWSO status snapshot timer started');
}

export function stopSoStatusSnapshotJob(): void {
  if (first) clearTimeout(first);
  if (tick) clearInterval(tick);
  first = null;
  tick = null;
}
