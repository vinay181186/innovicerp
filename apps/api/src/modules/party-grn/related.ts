// ADR-294 — Related Documents for one Party GRN (GET /party-grn/:id/related).
// Mirrors getGrnRelated (goods-receipt-notes/service.ts): one withUserContext
// transaction, an existence check that throws NotFoundError, company-scoped and
// soft-delete-filtered queries, every link a real FK.
//
// Upstream (source):
//   - party_grn.job_work_order_id                  → job_work_orders (the JWSO)
//   - party_grn.client_id                          → clients (the customer)
//   - party_grn_lines                              → the customer material received
// Downstream (raised from it):
//   - nc_register.party_grn_line_id ∈ its lines    → NCs from Incoming QC (ADR-247)
//   - customer_material_return_lines.party_grn_line_id ∈ its lines
//                                                  → Customer Material Returns (no page)
// Party Material Issues are NOT listed: they link to the JWSO line and the party
// material, never to a Party GRN, so there is no real FK to join on.
//
// No money appears here (Party GRN carries none), so the price-hidden rule has
// nothing to strip.

import type { DocumentTraceability } from '@innovic/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  clients,
  customerMaterialReturnLines,
  customerMaterialReturns,
  jobWorkOrders,
  ncRegister,
} from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { loadRelatedItems } from '../../lib/related-items';
import {
  buildTimeline,
  itemSection,
  type RelatedRow,
  section,
  toIsoDate,
} from '../../lib/traceability';
import { loadPartyGrnDetail, requireCompany, requirePartyGrnRead } from './service';

export async function getPartyGrnRelated(
  id: string,
  user: AuthContext,
): Promise<DocumentTraceability> {
  // Same read gate as GET /party-grn/:id.
  await requirePartyGrnRead(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // The same header + lines the detail page shows (ADR-235: a Cancelled GRN
    // and the lines cancelled with it) — one place for that rule.
    const header = await loadPartyGrnDetail(tx, companyId, id, { includeCancelled: true });
    const lineIds = header.lines.map((l) => l.id);
    const jwLineIds = header.lines.map((l) => l.jwLineId);

    // ── Upstream: the JWSO it was received against ──────────────────────────
    const jwoRows = header.jobWorkOrderId
      ? await tx
          .select({
            id: jobWorkOrders.id,
            code: jobWorkOrders.code,
            status: jobWorkOrders.status,
            date: jobWorkOrders.jwDate,
          })
          .from(jobWorkOrders)
          .where(
            and(
              eq(jobWorkOrders.id, header.jobWorkOrderId),
              eq(jobWorkOrders.companyId, companyId),
              isNull(jobWorkOrders.deletedAt),
            ),
          )
          .limit(1)
      : [];

    // ── Upstream: the customer (master, nullable) ───────────────────────────
    const clientRows = header.clientId
      ? await tx
          .select({ id: clients.id, code: clients.code, name: clients.name })
          .from(clients)
          .where(
            and(
              eq(clients.id, header.clientId),
              eq(clients.companyId, companyId),
              isNull(clients.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const client = clientRows[0] ?? null;

    // ── Downstream: NCs raised on its lines at Incoming QC (ADR-247) ────────
    const ncRows =
      lineIds.length === 0
        ? []
        : await tx
            .select({
              id: ncRegister.id,
              code: ncRegister.code,
              status: ncRegister.status,
              date: ncRegister.ncDate,
            })
            .from(ncRegister)
            .where(
              and(
                inArray(ncRegister.partyGrnLineId, lineIds),
                eq(ncRegister.companyId, companyId),
                isNull(ncRegister.deletedAt),
              ),
            )
            .orderBy(desc(ncRegister.ncDate));

    // ── Downstream: Customer Material Returns sending its rejected pieces back
    const cmrRows =
      lineIds.length === 0
        ? []
        : await tx
            .selectDistinct({
              id: customerMaterialReturns.id,
              code: customerMaterialReturns.code,
              status: customerMaterialReturns.status,
              date: customerMaterialReturns.returnDate,
            })
            .from(customerMaterialReturnLines)
            .innerJoin(
              customerMaterialReturns,
              eq(customerMaterialReturns.id, customerMaterialReturnLines.returnId),
            )
            .where(
              and(
                inArray(customerMaterialReturnLines.partyGrnLineId, lineIds),
                eq(customerMaterialReturnLines.companyId, companyId),
                isNull(customerMaterialReturnLines.deletedAt),
                eq(customerMaterialReturns.companyId, companyId),
                isNull(customerMaterialReturns.deletedAt),
              ),
            )
            .orderBy(desc(customerMaterialReturns.returnDate));

    const row = (
      id_: string,
      code: string,
      status: string | null,
      date: unknown,
      extra?: { linkId?: string; label?: string },
    ): RelatedRow => ({
      id: id_,
      code,
      status,
      date: toIsoDate(date),
      linkId: extra?.linkId ?? null,
      label: extra?.label ?? null,
    });

    // ── Upstream sections (what this Party GRN was received FROM) ───────────
    const jwoSection = section(
      'job-work-order',
      'Job Work Order',
      '🧾',
      'job-work-order',
      jwoRows.map((r) => row(r.id, r.code, r.status, r.date)),
      {
        items: await loadRelatedItems(
          tx,
          'jwo',
          jwoRows.map((r) => r.id),
          { column: 'id', ids: jwLineIds },
        ),
      },
    );
    const clientSection = section(
      'client',
      'Customer',
      '👤',
      'client',
      client ? [row(client.id, client.code, null, null, { label: client.name })] : [],
      { noItems: 'party', codeHeading: 'Customer Code', labelHeading: 'Customer' },
    );
    const pgrnItems = (await loadRelatedItems(tx, 'partyGrn', [id])).get(id) ?? [];
    const itemTab = itemSection('item', 'Items', '📦', pgrnItems);

    // ── Downstream sections (raised from this Party GRN) ────────────────────
    const ncSection = section(
      'nc-raised',
      'NC Raised',
      '⚠️',
      'nc',
      ncRows.map((r) => row(r.id, r.code, r.status, r.date)),
      {
        items: await loadRelatedItems(
          tx,
          'nc',
          ncRows.map((r) => r.id),
        ),
      },
    );
    const cmrSection = section(
      'customer-material-return',
      'Customer Material Return',
      '↩️',
      // No Customer Material Return detail page — reference-only.
      null,
      cmrRows.map((r) => row(r.id, r.code, r.status, r.date)),
      { noItems: 'no item lines loaded for this document' },
    );

    const upstream = [jwoSection, clientSection, itemTab];
    const downstream = [ncSection, cmrSection];
    return {
      self: { module: 'party-grn', code: header.code },
      upstream,
      downstream,
      related: [],
      timeline: buildTimeline(
        {
          ts: toIsoDate(header.grnDate),
          label: 'Party GRN created',
          code: header.code,
          routeKind: 'party-grn',
          linkId: id,
          items: pgrnItems,
        },
        [...upstream, ...downstream],
      ),
    };
  });
}
