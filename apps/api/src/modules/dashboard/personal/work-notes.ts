// Owner rule 4 (2-Nov-2026) — new-work notes for documents whose writers keep
// NO activity_log row (capa/service.ts and design-projects/service.ts never
// call emitActivityLog), so the note is read off the document's own
// created_at / created_by instead:
//   CAPA          created → its Responsible person when that name is a login
//                 (the capa_mine list's name match), else the CAPA Edit tick
//                 holders (capa_create edit — the right that works a CAPA)
//   Design issue  raised  → Design Issues Edit tick holders (updateDesignIssue
//                 demands dsnissue_create edit — resolving is an edit)
//   DCR           created → Design DCR/DCN Edit tick holders (updateDesignDcr)
// Someone else's document only; inside the window; open = still in a state
// that needs the work. Super Admin / Full Access get every one (owner rule
// 1). Each read: company_id, deleted_at IS NULL, LIMIT, own savepoint.

import { type AccessFormKey, docNavPage } from '@innovic/shared';
import { type SQL, sql } from 'drizzle-orm';
import { type DashAccess, hasTick } from '../access';
import type { ExtraNote, NoteSource } from './note-sources';
import { codePart, str } from './util';

const WORK_SCAN = 200;

export interface WorkRow {
  kind: 'capa' | 'dsn_issue' | 'dcr';
  id: string;
  code: string;
  href: string;
  actor: string;
  ts: string;
  open: boolean;
  /** CAPA: the caller is its Responsible person. */
  mine: boolean;
  /** CAPA: the Responsible person, when that name is a login (owner rule 1 —
   *  a Super Admin reads "made Parth Responsible"). */
  responsible: string | null;
}

/** The caller's note for one work row. Pure. */
export function workNote(r: WorkRow): ExtraNote {
  let lead: string;
  let tail: string;
  if (r.kind === 'capa') {
    if (r.mine) {
      lead = `${r.actor} made you Responsible for `;
      tail = ' — CAPA to work on';
    } else if (r.responsible) {
      lead = `${r.actor} made ${r.responsible} Responsible for `;
      tail = ' — CAPA to work on';
    } else {
      lead = `${r.actor} raised `;
      tail = ' — no Responsible login, to follow up';
    }
  } else if (r.kind === 'dsn_issue') {
    lead = `${r.actor} raised design issue `;
    tail = ' — to resolve';
  } else {
    lead = `${r.actor} submitted `;
    tail = ' — DCR waiting for review';
  }
  return {
    key: `work:${r.kind}:${r.id}`,
    ts: r.ts,
    tone: 'due',
    actorName: r.actor,
    open: r.open,
    unseen: false,
    // Done: the past fact only ("Rakesh raised CAPA-0012").
    text: [{ text: lead }, codePart(r.code, r.href), ...(r.open ? [{ text: tail }] : [])],
  };
}

const iso = (v: unknown): string => (v instanceof Date ? v : new Date(String(v))).toISOString();
const actorOf = sql.raw(`COALESCE(NULLIF(btrim(u.full_name), ''), u.email, 'Someone')`);

/** The caller's work sources (only those their rights open). Read with
 *  readSources (one statement). */
export function workSources(
  a: DashAccess,
  cid: string,
  me: string,
  since: SQL,
  seeAll = false,
): NoteSource[] {
  // Owner rule 1: Super Admin / Full Access get every work note.
  const may = (form: AccessFormKey): boolean => seeAll || hasTick(a, form, 'edit');
  const capaHolder = may('capa_create');
  const reads: Array<[WorkRow['kind'], SQL]> = [];
  // CAPA: always read — a Responsible person needs no tick.
  const myName = sql`(SELECT lower(btrim(COALESCE(mu.full_name, ''))) FROM public.users mu
    WHERE mu.id = ${me}::uuid)`;
  const resp = sql`lower(btrim(COALESCE(c.responsible, '')))`;
  const isMine = sql`(${myName} <> '' AND ${resp} = ${myName})`;
  const noLogin = sql`NOT EXISTS (SELECT 1 FROM public.users ru
    WHERE ru.company_id = ${cid}::uuid AND ${resp} <> ''
      AND lower(btrim(COALESCE(ru.full_name, ''))) = ${resp})`;
  reads.push([
    'capa',
    sql`SELECT c.id::text AS id, c.code, NULL::text AS project_id, ${actorOf} AS actor,
        c.created_at AS ts, (lower(c.status) NOT IN ('closed', 'verified')) AS open,
        ${isMine} AS mine,
        (CASE WHEN ${noLogin} THEN NULL ELSE btrim(c.responsible) END) AS responsible
      FROM public.capa_records c
      LEFT JOIN public.users u ON u.id = c.created_by
      WHERE c.company_id = ${cid}::uuid AND c.deleted_at IS NULL
        AND c.created_by <> ${me}::uuid AND c.created_at >= ${since}
        ${seeAll ? sql`` : sql`AND (${isMine} ${capaHolder ? sql`OR ${noLogin}` : sql``})`}
      ORDER BY c.created_at DESC, c.id DESC LIMIT ${WORK_SCAN}`,
  ]);
  if (may('dsnissue_create')) {
    reads.push([
      'dsn_issue',
      sql`SELECT i.id::text AS id, i.title AS code, i.design_project_id::text AS project_id,
          ${actorOf} AS actor, i.created_at AS ts,
          (i.status IN ('Open', 'In Progress')) AS open, false AS mine
        FROM public.design_issues i
        LEFT JOIN public.users u ON u.id = i.created_by
        WHERE i.company_id = ${cid}::uuid AND i.deleted_at IS NULL
          AND i.created_by <> ${me}::uuid AND i.created_at >= ${since}
        ORDER BY i.created_at DESC, i.id DESC LIMIT ${WORK_SCAN}`,
    ]);
  }
  if (may('dsndcr_create')) {
    reads.push([
      'dcr',
      sql`SELECT d.id::text AS id, d.code, d.design_project_id::text AS project_id,
          ${actorOf} AS actor, d.created_at AS ts,
          (d.status IN ('Submitted', 'Under Review')) AS open, false AS mine
        FROM public.design_dcrs d
        LEFT JOIN public.users u ON u.id = d.created_by
        WHERE d.company_id = ${cid}::uuid AND d.deleted_at IS NULL
          AND d.created_by <> ${me}::uuid AND d.created_at >= ${since}
        ORDER BY d.created_at DESC, d.id DESC LIMIT ${WORK_SCAN}`,
    ]);
  }
  return reads.map(([kind, query]) => ({
    source: `work:${kind}`,
    query,
    orderCol: 'ts' as const,
    toNotes: (rows) =>
      rows.map(
        (r): ExtraNote =>
          workNote({
            kind,
            id: String(r['id']),
            code: String(r['code'] ?? ''),
            href:
              kind === 'capa'
                ? `/nc-register?tab=capa&capa=${encodeURIComponent(String(r['code'] ?? ''))}`
                : docNavPage('design-project', str(r['project_id']) ?? ''),
            actor: String(r['actor'] ?? 'Someone'),
            ts: iso(r['ts']),
            open: r['open'] === true,
            mine: r['mine'] === true,
            responsible: str(r['responsible']),
          }),
      ),
  }));
}
