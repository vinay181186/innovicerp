// ADR-261 — the Party GRN list, ONE ROW PER LINE (GET /party-grn/lines).
//
// The document list (listPartyGrn, GET /party-grn) is unchanged — pickers and
// other screens read it. This read takes the SAME query params, the same read
// gate, the same company scope and the same "lines of this header as it
// stands" rule (PGL_OF_HEADER_SQL: a live GRN's live lines; a Cancelled GRN's
// lines cancelled with it, listed only with includeCancelled), and pages on
// LINES. Each row also carries the GRN's own list row (`header`, the very
// toListItem shape GET /party-grn returns) so the screen's row actions act on
// the whole document exactly as before.
//
// Item on the row = what the line RECEIVED: the JWSO line's customer RM
// (party_material_code_text / _name, snapshotted at gate-in), with the JWSO
// line's drawing revision. JWSO No. / POL come from the GRN header and the
// JWSO line (LEFT JOIN on the line's primary key — never multiplies rows; no
// deleted_at filter, matching loadPartyGrnDetail).

import { sql } from 'drizzle-orm';
import type {
  ListPartyGrnLinesResponse,
  ListPartyGrnQuery,
  PartyGrnLineListRow,
} from '@innovic/shared';
import { withUserContext, type AuthContext } from '../../db/with-user-context';
import { day, iso } from '../../lib/list-line-values';
import { likeEscape, readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { QC_PENDING_QTY_SQL } from './qc-state';
import {
  LINE_AGG_SQL,
  PGL_OF_HEADER_SQL,
  headerScopeSql,
  requireCompany,
  requirePartyGrnRead,
  toListItem,
} from './service';
import { PARTY_GRN_LINE_SF_COLUMNS } from './sf-columns';

export async function listPartyGrnLines(
  input: ListPartyGrnQuery,
  user: AuthContext,
): Promise<ListPartyGrnLinesResponse> {
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const term = input.search ? `%${likeEscape(input.search)}%` : null;
    // The header fields the old list searched, plus THIS line's own fields.
    const searchFrag = term
      ? sql`AND (
          pg.code ILIKE ${term} ESCAPE '\\'
          OR pg.jw_code_text ILIKE ${term} ESCAPE '\\'
          OR pg.client_code_text ILIKE ${term} ESCAPE '\\'
          OR pg.client_po_no ILIKE ${term} ESCAPE '\\'
          OR pg.dc_no ILIKE ${term} ESCAPE '\\'
          OR c.name ILIKE ${term} ESCAPE '\\'
          OR pgl.party_material_code_text ILIKE ${term} ESCAPE '\\'
          OR pgl.party_material_name ILIKE ${term} ESCAPE '\\'
          OR jwl.client_po_line_no ILIKE ${term} ESCAPE '\\'
        )`
      : sql``;
    const jwFrag = input.jobWorkOrderId
      ? sql`AND pg.job_work_order_id = ${input.jobWorkOrderId}::uuid`
      : sql``;
    const clientFrag = input.clientId ? sql`AND pg.client_id = ${input.clientId}::uuid` : sql``;
    const fromFrag = input.fromDate ? sql`AND pg.grn_date >= ${input.fromDate}::date` : sql``;
    const toFrag = input.toDate ? sql`AND pg.grn_date <= ${input.toDate}::date` : sql``;
    const scopeFrag = headerScopeSql(input.includeCancelled === true);
    const sf = readSf(input.sf);
    const sfFrag = sfWhere(PARTY_GRN_LINE_SF_COLUMNS, sf);
    const orderBy = sfOrderBy(
      PARTY_GRN_LINE_SF_COLUMNS,
      sf,
      sql`pg.grn_date DESC, pg.code DESC, pgl.line_no ASC`,
    );

    // One FROM-joins + WHERE for the page and the count, so `total` counts
    // what the pages show (the page adds the GRN roll-up for `header`).
    const joins = sql`
      FROM public.party_grn_lines pgl
      JOIN public.party_grn pg ON pg.id = pgl.party_grn_id
      LEFT JOIN public.clients c ON c.id = pg.client_id AND c.deleted_at IS NULL
      LEFT JOIN public.job_work_order_lines jwl ON jwl.id = pgl.jw_line_id`;
    const where = sql`
      WHERE pg.company_id = ${companyId}::uuid
        AND pgl.company_id = ${companyId}::uuid
        AND ${scopeFrag}
        AND ${PGL_OF_HEADER_SQL}
        ${searchFrag} ${jwFrag} ${clientFrag} ${fromFrag} ${toFrag} ${sfFrag}`;

    const result = (await tx.execute(sql`
      SELECT
        pgl.id AS "lineId", pgl.line_no AS "lineNo",
        pgl.party_material_code_text AS "itemCode",
        pgl.party_material_name AS "itemName",
        NULLIF(btrim(jwl.revision), '') AS "itemRevision",
        jwl.client_po_line_no AS "clientPoLineNo",
        COALESCE(pgl.created_at, pg.created_at) AS "lineCreatedAt",
        pgl.received_qty AS "lineReceivedQty",
        pgl.accepted_qty AS "lineAcceptedQty",
        pgl.rejected_qty AS "lineRejectedQty",
        GREATEST(0, ${QC_PENDING_QTY_SQL})::int AS "lineQcPendingQty",
        pgl.qc_at AS "lineQcAt",
        pg.id, pg.company_id AS "companyId", pg.code,
        pg.grn_date AS "grnDate",
        pg.job_work_order_id AS "jobWorkOrderId",
        pg.jw_code_text AS "jwCodeText",
        pg.client_id AS "clientId",
        pg.client_code_text AS "clientCodeText",
        pg.client_po_no AS "clientPoNo",
        pg.dc_no AS "dcNo",
        pg.remarks,
        pg.received_by_text AS "receivedByText",
        pg.created_at AS "createdAt", pg.created_by AS "createdBy",
        pg.updated_at AS "updatedAt", pg.updated_by AS "updatedBy",
        pg.deleted_at AS "deletedAt",
        pg.cancel_reason AS "cancelReason", pg.cancelled_at AS "cancelledAt",
        c.name AS "clientName",
        COALESCE(agg.total_received, 0)::int AS "totalReceivedQty",
        COALESCE(agg.total_accepted, 0)::int AS "totalAcceptedQty",
        COALESCE(agg.qc_pending_lines, 0)::int AS "qcPendingLines",
        COALESCE(agg.total_qc_pending, 0)::int AS "totalQcPendingQty",
        COALESCE(agg.lines_count, 0)::int AS "linesCount"
      ${joins}
      ${LINE_AGG_SQL}
      ${where}
      ORDER BY ${orderBy}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `)) as unknown as Array<Record<string, unknown>>;

    // Pager total = matching LINES. The tiles = the per-GRN list's figures
    // (same rules as listPartyGrn: live GRNs only — a Cancelled GRN received
    // nothing), over the WHOLE GRNs those lines belong to: GRN count and
    // received qty both read every live line of each matched GRN (LINE_AGG_SQL),
    // so the two tiles are in the same unit.
    const sumRows = (await tx.execute(sql`
      WITH m AS (SELECT pg.id AS grn_id ${joins} ${where})
      SELECT
        (SELECT COUNT(*)::int FROM m) AS total_rows,
        COUNT(*) FILTER (WHERE pg.deleted_at IS NULL)::int AS total_grns,
        COALESCE(SUM(agg.total_received) FILTER (WHERE pg.deleted_at IS NULL), 0)::int
          AS total_received,
        COUNT(*) FILTER (
          WHERE pg.deleted_at IS NULL
            AND pg.grn_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
        )::int AS today_count
      FROM public.party_grn pg
      ${LINE_AGG_SQL}
      WHERE pg.company_id = ${companyId}::uuid
        AND pg.id IN (SELECT grn_id FROM m)
    `)) as unknown as Array<Record<string, unknown>>;
    const sum = sumRows[0] ?? {};

    const items: PartyGrnLineListRow[] = result.map((r) => {
      const header = toListItem(r);
      const cancelled = Boolean(header.cancelledAt ?? header.deletedAt);
      return {
        lineId: String(r['lineId']),
        docId: header.id,
        docCode: header.code,
        docDate: day(r['grnDate']),
        docStatus: cancelled ? 'cancelled' : 'live',
        lineNo: Number(r['lineNo']),
        jwCode: header.jwCodeText,
        clientPoLineNo: (r['clientPoLineNo'] as string | null) ?? null,
        createdAt: iso(r['lineCreatedAt']),
        itemCode: (r['itemCode'] as string | null) ?? null,
        itemRevision: (r['itemRevision'] as string | null) ?? null,
        itemName: (r['itemName'] as string | null) ?? null,
        customerName: header.clientName ?? header.clientCodeText,
        clientPoNo: header.clientPoNo,
        dcNo: header.dcNo,
        receivedQty: Number(r['lineReceivedQty'] ?? 0),
        acceptedQty: Number(r['lineAcceptedQty'] ?? 0),
        rejectedQty: Number(r['lineRejectedQty'] ?? 0),
        // A cancelled GRN waits for nothing (same as the detail read).
        qcPendingQty: cancelled ? 0 : Number(r['lineQcPendingQty'] ?? 0),
        qcAt: r['lineQcAt'] != null ? iso(r['lineQcAt']) : null,
        header,
      };
    });
    return {
      items,
      total: Number(sum['total_rows'] ?? 0),
      limit: input.limit,
      offset: input.offset,
      summary: {
        totalGrns: Number(sum['total_grns'] ?? 0),
        totalReceived: Number(sum['total_received'] ?? 0),
        today: Number(sum['today_count'] ?? 0),
      },
    };
  });
}
