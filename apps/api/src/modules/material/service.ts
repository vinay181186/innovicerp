// Material view — ADR-193 phase 3b (spec §11 "Read model").
//
//   GET /material/job-cards/:id       → JcMaterial
//   GET /material/sales-orders/:id    → SoMaterial
//
// Derived on every read from lib/material-requirement.ts — the same numbers
// the Item Issue guard caps against. Reversed slips never count.

import type { JcMaterial, JcMaterialLine, SoMaterial, SoMaterialLine } from '@innovic/shared';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAnyFormAccess, STORE_VIEW_FORMS } from '../../lib/access';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import {
  balanceOf,
  type BomPart,
  jcRequirement,
  readBomParts,
  readBookedForOthers,
  readIssuedReturned,
  readItemInfo,
  readJcHead,
  readSlipsFor,
  readSoHead,
} from '../../lib/material-requirement';
import { roundQty } from '../../lib/stock-ledger';
import { readStockPositions } from '../../lib/stock-reservation';

const MATERIAL_VIEW_FORMS = [
  ...STORE_VIEW_FORMS,
  ['jc_create', 'view'],
  ['so_create', 'view'],
] as const;

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

export async function getJcMaterial(jobCardId: string, user: AuthContext): Promise<JcMaterial> {
  await requireAnyFormAccess(user, MATERIAL_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const jc = await readJcHead(tx, companyId, jobCardId);
    if (!jc) throw new NotFoundError('Job Card not found.');
    const req = jcRequirement(jc);
    const got = await readIssuedReturned(tx, companyId, { jobCardId: jc.id });

    const itemIds = [...new Set([...(req ? [req.itemId] : []), ...got.keys()])];
    // Sequential on purpose — one transaction, one connection.
    const info = await readItemInfo(tx, companyId, itemIds);
    const pos = await readStockPositions(tx, companyId, itemIds);

    const lineFor = (itemId: string, required: number | null): JcMaterialLine => {
      const g = got.get(itemId);
      const it = info.get(itemId);
      return {
        itemId,
        itemCode: it?.code ?? '',
        itemName: it?.name ?? null,
        uom: it?.uom ?? null,
        requiredQty: required,
        issuedQty: g?.issued ?? 0,
        returnedQty: g?.returned ?? 0,
        toIssueQty: required == null ? null : balanceOf(required, g),
        availableQty: roundQty(pos.get(itemId)?.availableQty ?? 0),
      };
    };

    const lines: JcMaterialLine[] = [];
    if (req) lines.push(lineFor(req.itemId, req.required));
    const others = [...got.keys()]
      .filter((id) => id !== req?.itemId)
      .map((id) => lineFor(id, null))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    lines.push(...others);

    return {
      jobCardId: jc.id,
      jcCode: jc.code,
      orderQty: jc.orderQty,
      planned: req != null,
      lines,
      issues: await readSlipsFor(tx, companyId, { jobCardId: jc.id }),
    };
  });
}

export async function getSoMaterial(salesOrderId: string, user: AuthContext): Promise<SoMaterial> {
  await requireAnyFormAccess(user, MATERIAL_VIEW_FORMS);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const so = await readSoHead(tx, companyId, salesOrderId);
    if (!so) throw new NotFoundError('Sales Order not found.');
    const issues = await readSlipsFor(tx, companyId, { salesOrderId: so.id });
    const base = { salesOrderId: so.id, soCode: so.code, units: so.units, issues };
    // No (longer a) BOM: nothing is required, but parts still out on its
    // slips stay listed as "not in BOM" so the store can take them back.
    const hasBom = so.isEquipment && so.bomId != null;
    const parts = hasBom
      ? await readBomParts(tx, companyId, so.bomId!, so.units)
      : new Map<string, BomPart>();
    const got = await readIssuedReturned(tx, companyId, { salesOrderId: so.id });
    const notInBom = [...got.keys()].filter((id) => !parts.has(id));
    const itemIds = [...parts.keys(), ...notInBom];
    const info = await readItemInfo(tx, companyId, itemIds);
    const pos = await readStockPositions(tx, companyId, itemIds);
    const others = await readBookedForOthers(tx, companyId, itemIds, so.id);

    const lineFor = (itemId: string, part: BomPart | null): SoMaterialLine => {
      const g = got.get(itemId);
      const it = info.get(itemId);
      const issued = g?.issued ?? 0;
      const returned = g?.returned ?? 0;
      // Consumption (assembly Complete) and assembly bookings arrive in
      // phase 3c; until then both are 0 and Still Out = Issued − Returned.
      const fitted = 0;
      const reserved = 0;
      return {
        itemId,
        itemCode: it?.code ?? '',
        itemName: it?.name ?? null,
        uom: it?.uom ?? null,
        qtyPerSet: part?.qtyPerSet ?? 0,
        requiredQty: part?.required ?? 0,
        reservedQty: reserved,
        issuedQty: issued,
        returnedQty: returned,
        fittedQty: fitted,
        // A part no longer in the BOM has nothing left to issue.
        toIssueQty: part ? balanceOf(part.required, g) : 0,
        stillOutQty: roundQty(issued - returned - fitted),
        availableQty: roundQty(pos.get(itemId)?.availableQty ?? 0),
        reservedForOthers: others.get(itemId) ?? [],
        notInBom: part == null,
      };
    };

    const lines = [
      ...[...parts.values()].map((p) => lineFor(p.itemId, p)),
      ...notInBom
        .map((id) => lineFor(id, null))
        .sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    ];
    return { ...base, hasBom, lines };
  });
}
