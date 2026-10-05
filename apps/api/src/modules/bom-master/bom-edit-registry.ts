// BOM Master entry for the edit-approval engine (ADR-202). A BOM has CHILD LINES,
// so this mirrors the PurchaseOrder LINE-level pattern, not the record-only master
// pattern: header fields PLUS per-line field edits, approved PER CHANGE.
//
// Line identity. A BOM lists each child part exactly once (assertNoDuplicateChild-
// Items) and the shared line input carries no row id, so a line's stable identity
// here is its child item id. Diff keys are `line:<childItemId>:<attr>`. Because the
// child item IS the identity, changing a line's component reads as remove + add and
// is refused by the divert in service.ts; only qty / type / raw-material edits on an
// existing line are staged. Adding or removing a line is refused too.
//
// applyEdit reconstructs the FULL BOM input from the CURRENT header + lines,
// overwrites ONLY the approved fields, then replays updateBomMasterTx — so every BOM
// guard (optimistic lock, status-move check, line reconcile, revision bump, audit)
// runs exactly as a direct edit, with no second writer.

import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type {
  AccessFormKey,
  CreateBomMasterLineInput,
  UpdateBomMasterInput,
} from '@innovic/shared';
import { bomMasterLines, bomMasters, items, materialGrades, materialSizes } from '../../db/schema';
import type { DbTransaction } from '../../db/with-user-context';
import type { DiffField } from '../../lib/audit-trail';
import { NotFoundError } from '../../lib/errors';
import { BOM_TYPE_WORD } from './audit';
import type { DocEditRegistryEntry, DocEditTarget } from '../document-edits/registry';
import { updateBomMasterTx } from './service';

const BOM_FORM_KEY: AccessFormKey = 'bom_create';

// Header fields updateBomMaster writes. Parent is compared / displayed by item
// CODE on both sides (like PO's vendor), so the inbox reads a code and the drift
// check never compares a uuid to a code. The revision bump is a system field, not
// something the user edits, so it is not an editable diff field.
const BOM_HEADER_DIFF_FIELDS: readonly DiffField[] = [
  { key: 'bomNo', label: 'BOM No.' },
  { key: 'bomName', label: 'BOM Name' },
  { key: 'parentItemId', label: 'Parent Item' },
  { key: 'status', label: 'BOM Status' },
];

// The editable attrs of an existing line. The component item is the line identity
// (see header note) so it is NOT editable here. Labels use the BOM screen's own
// names (docs/NAMING.md): Qty per Set, BOM Type, RM Grade, RM Size.
type LineAttr = 'qty' | 'bomType' | 'rmGrade' | 'rmSize';
const LINE_ATTR_LABEL: Record<LineAttr, string> = {
  qty: 'Qty per Set',
  bomType: 'BOM Type',
  rmGrade: 'RM Grade',
  rmSize: 'RM Size',
};
const lineFieldKey = (childItemId: string, attr: LineAttr): string => `line:${childItemId}:${attr}`;

const fmtBomType = (v: unknown): string | null =>
  v ? (BOM_TYPE_WORD[String(v)] ?? String(v)) : null;

/** A BOM line projected into target.doc — just what diffFields / snapshots need.
 *  Raw material is carried as both id and text; the snapshots display the name. */
interface BomEditLine {
  childItemId: string;
  lineNo: number;
  childItemCode: string | null;
  qtyPerSet: string;
  bomType: string;
  rawMaterialGradeText: string | null;
  rawMaterialSizeText: string | null;
}

/** Master item codes for a set of ids (id → code), company-scoped. */
async function itemCodesByIds(
  tx: DbTransaction,
  companyId: string,
  ids: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return map;
  const rows = await tx
    .select({ id: items.id, code: items.code })
    .from(items)
    .where(and(eq(items.companyId, companyId), inArray(items.id, unique)));
  for (const r of rows) map.set(r.id, r.code);
  return map;
}

/** Grade + size names for the ids a proposed line set references (id → name),
 *  so the after-snapshot shows the SAME names the stored lines show (the input
 *  carries ids; its text is only a fallback). */
async function rawMaterialNames(
  tx: DbTransaction,
  companyId: string,
  lines: readonly CreateBomMasterLineInput[],
): Promise<{ grades: Map<string, string>; sizes: Map<string, string> }> {
  const gradeIds = [
    ...new Set(lines.flatMap((l) => (l.rawMaterialGradeId ? [l.rawMaterialGradeId] : []))),
  ];
  const sizeIds = [
    ...new Set(lines.flatMap((l) => (l.rawMaterialSizeId ? [l.rawMaterialSizeId] : []))),
  ];
  const grades = new Map<string, string>();
  const sizes = new Map<string, string>();
  if (gradeIds.length > 0) {
    const rows = await tx
      .select({ id: materialGrades.id, name: materialGrades.name })
      .from(materialGrades)
      .where(and(eq(materialGrades.companyId, companyId), inArray(materialGrades.id, gradeIds)));
    for (const r of rows) grades.set(r.id, r.name);
  }
  if (sizeIds.length > 0) {
    const rows = await tx
      .select({ id: materialSizes.id, name: materialSizes.name })
      .from(materialSizes)
      .where(and(eq(materialSizes.companyId, companyId), inArray(materialSizes.id, sizeIds)));
    for (const r of rows) sizes.set(r.id, r.name);
  }
  return { grades, sizes };
}

const gradeDisplay = (l: CreateBomMasterLineInput, names: Map<string, string>): string | null =>
  l.rawMaterialGradeId
    ? (names.get(l.rawMaterialGradeId) ?? null)
    : l.rawMaterialGradeText?.trim() || null;
const sizeDisplay = (l: CreateBomMasterLineInput, names: Map<string, string>): string | null =>
  l.rawMaterialSizeId
    ? (names.get(l.rawMaterialSizeId) ?? null)
    : l.rawMaterialSizeText?.trim() || null;

export const bomEditRegistryEntry: DocEditRegistryEntry = {
  formKey: BOM_FORM_KEY,

  diffFields(target) {
    const lines = (target.doc['lines'] as BomEditLine[] | undefined) ?? [];
    const lineFields: DiffField[] = [];
    for (const l of lines) {
      lineFields.push({
        key: lineFieldKey(l.childItemId, 'qty'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.qty}`,
      });
      lineFields.push({
        key: lineFieldKey(l.childItemId, 'bomType'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.bomType}`,
        format: fmtBomType,
      });
      lineFields.push({
        key: lineFieldKey(l.childItemId, 'rmGrade'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.rmGrade}`,
      });
      lineFields.push({
        key: lineFieldKey(l.childItemId, 'rmSize'),
        label: `Line ${l.lineNo} · ${LINE_ATTR_LABEL.rmSize}`,
      });
    }
    return [...BOM_HEADER_DIFF_FIELDS, ...lineFields];
  },

  async loadForDiff(tx, companyId, id): Promise<DocEditTarget | null> {
    const rows = await tx
      .select()
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1)
      .for('update');
    const bom = rows[0];
    if (!bom) return null;

    // Lines locked under the SAME FOR UPDATE scope. Selected WITHOUT a join (a
    // FOR UPDATE cannot touch the nullable side of an outer join), so the child
    // codes are resolved in a second company-scoped query.
    const lineRows = await tx
      .select({
        childItemId: bomMasterLines.childItemId,
        lineNo: bomMasterLines.lineNo,
        qtyPerSet: bomMasterLines.qtyPerSet,
        bomType: bomMasterLines.bomType,
        rawMaterialGradeText: bomMasterLines.rawMaterialGradeText,
        rawMaterialSizeText: bomMasterLines.rawMaterialSizeText,
      })
      .from(bomMasterLines)
      .where(
        and(
          eq(bomMasterLines.bomMasterId, id),
          eq(bomMasterLines.companyId, companyId),
          isNull(bomMasterLines.deletedAt),
        ),
      )
      .orderBy(asc(bomMasterLines.lineNo))
      .for('update');

    const codeIds = lineRows.map((l) => l.childItemId);
    if (bom.parentItemId) codeIds.push(bom.parentItemId);
    const codeById = await itemCodesByIds(tx, companyId, codeIds);
    const parentCode = bom.parentItemId ? (codeById.get(bom.parentItemId) ?? null) : null;

    const lines: BomEditLine[] = lineRows.map((l) => ({
      childItemId: l.childItemId,
      lineNo: l.lineNo,
      childItemCode: codeById.get(l.childItemId) ?? null,
      qtyPerSet: l.qtyPerSet,
      bomType: l.bomType,
      rawMaterialGradeText: l.rawMaterialGradeText,
      rawMaterialSizeText: l.rawMaterialSizeText,
    }));

    return {
      doc: { ...bom, parentCode, lines },
      updatedAt: bom.updatedAt,
      docCode: bom.bomNo,
      // Any existing (not-Trash) BOM is a LIVE document whose edits are staged;
      // loadForDiff already returns null when it is gone / in Trash.
      isLive: true,
    };
  },

  beforeSnapshot(target) {
    const d = target.doc;
    const out: Record<string, unknown> = {
      bomNo: d['bomNo'],
      bomName: d['bomName'],
      parentItemId: d['parentCode'] ?? null,
      status: d['status'],
    };
    const lines = (d['lines'] as BomEditLine[] | undefined) ?? [];
    for (const l of lines) {
      out[lineFieldKey(l.childItemId, 'qty')] = l.qtyPerSet;
      out[lineFieldKey(l.childItemId, 'bomType')] = l.bomType;
      out[lineFieldKey(l.childItemId, 'rmGrade')] = l.rawMaterialGradeText;
      out[lineFieldKey(l.childItemId, 'rmSize')] = l.rawMaterialSizeText;
    }
    return out;
  },

  async afterSnapshot(tx, companyId, input, _user) {
    const i = input as UpdateBomMasterInput;
    const out: Record<string, unknown> = {
      bomNo: i.bomNo,
      bomName: i.bomName,
      status: i.status,
    };
    // Parent compared by CODE on both sides (matches beforeSnapshot).
    out['parentItemId'] =
      (await itemCodesByIds(tx, companyId, [i.parentItemId])).get(i.parentItemId) ?? null;

    // Line changes keyed by child item id. A proposed child that is not a current
    // line (add / swap) has no diffField and is harmlessly dropped — the divert
    // refuses add/remove before anything is staged.
    const { grades, sizes } = await rawMaterialNames(tx, companyId, i.lines);
    for (const l of i.lines) {
      out[lineFieldKey(l.childItemId, 'qty')] = l.qtyPerSet;
      out[lineFieldKey(l.childItemId, 'bomType')] = l.bomType;
      out[lineFieldKey(l.childItemId, 'rmGrade')] = gradeDisplay(l, grades);
      out[lineFieldKey(l.childItemId, 'rmSize')] = sizeDisplay(l, sizes);
    }
    return out;
  },

  buildFilteredInput(proposedPayload, approvedFields) {
    const input = proposedPayload as UpdateBomMasterInput;
    const header: Record<string, unknown> = {};
    const approvedLineFields: string[] = [];
    const record = input as unknown as Record<string, unknown>;
    for (const field of approvedFields) {
      if (field.startsWith('line:')) {
        approvedLineFields.push(field);
      } else if (
        field === 'bomNo' ||
        field === 'bomName' ||
        field === 'parentItemId' ||
        field === 'status'
      ) {
        header[field] = record[field];
      }
    }
    if (Object.keys(header).length === 0 && approvedLineFields.length === 0) return null;
    // Carry the proposed lines so applyEdit can rebuild each line from the CURRENT
    // values, overwriting only the approved attrs.
    return {
      header,
      approvedLineFields,
      proposedLines: input.lines,
      expectedUpdatedAt: input.expectedUpdatedAt,
    };
  },

  async applyEdit(tx, companyId, id, filteredInput, expectedUpdatedAt, user) {
    const filtered = filteredInput as {
      header: Record<string, unknown>;
      approvedLineFields: string[];
      proposedLines: CreateBomMasterLineInput[];
      expectedUpdatedAt?: string | null;
    };
    const approvedLineFields = new Set(filtered.approvedLineFields);

    // Reload CURRENT header + lines (the engine already holds the BOM row lock).
    const headerRows = await tx
      .select()
      .from(bomMasters)
      .where(
        and(
          eq(bomMasters.id, id),
          eq(bomMasters.companyId, companyId),
          isNull(bomMasters.deletedAt),
        ),
      )
      .limit(1);
    const header = headerRows[0];
    if (!header) throw new NotFoundError('BOM not found. It may have been moved to Trash.');

    const currentLines = await tx
      .select()
      .from(bomMasterLines)
      .where(
        and(
          eq(bomMasterLines.bomMasterId, id),
          eq(bomMasterLines.companyId, companyId),
          isNull(bomMasterLines.deletedAt),
        ),
      )
      .orderBy(asc(bomMasterLines.lineNo));

    const proposedByItem = new Map(filtered.proposedLines.map((l) => [l.childItemId, l]));

    // Rebuild the FULL line set from CURRENT values, overwriting ONLY the approved
    // attr(s). Every current child is resubmitted, so none is dropped, and an
    // unapproved / superseded attr keeps its current value (add/remove is refused
    // upstream, so the child set is unchanged here).
    const lines: CreateBomMasterLineInput[] = currentLines.map((c) => {
      const line: CreateBomMasterLineInput = {
        childItemId: c.childItemId,
        qtyPerSet: Number(c.qtyPerSet),
        bomType: c.bomType,
        rawMaterialGradeId: c.rawMaterialGradeId,
        rawMaterialGradeText: c.rawMaterialGradeText,
        rawMaterialSizeId: c.rawMaterialSizeId,
        rawMaterialSizeText: c.rawMaterialSizeText,
      };
      const proposed = proposedByItem.get(c.childItemId);
      if (proposed) {
        if (approvedLineFields.has(lineFieldKey(c.childItemId, 'qty'))) {
          line.qtyPerSet = proposed.qtyPerSet;
        }
        if (approvedLineFields.has(lineFieldKey(c.childItemId, 'bomType'))) {
          line.bomType = proposed.bomType;
        }
        if (approvedLineFields.has(lineFieldKey(c.childItemId, 'rmGrade'))) {
          line.rawMaterialGradeId = proposed.rawMaterialGradeId ?? null;
          line.rawMaterialGradeText = proposed.rawMaterialGradeText ?? null;
        }
        if (approvedLineFields.has(lineFieldKey(c.childItemId, 'rmSize'))) {
          line.rawMaterialSizeId = proposed.rawMaterialSizeId ?? null;
          line.rawMaterialSizeText = proposed.rawMaterialSizeText ?? null;
        }
      }
      return line;
    });

    const h = filtered.header;
    const payload: UpdateBomMasterInput = {
      bomNo: ('bomNo' in h ? h['bomNo'] : header.bomNo) as string,
      bomName: ('bomName' in h ? h['bomName'] : header.bomName) as string,
      parentItemId: ('parentItemId' in h ? h['parentItemId'] : header.parentItemId) as string,
      status: ('status' in h ? h['status'] : header.status) as UpdateBomMasterInput['status'],
      lines,
      revisionNote: null,
      // The engine resolved per-change drift under this tx's BOM row lock, so the
      // whole-row updated_at check inside updateBomMasterTx must see the CURRENT
      // token (a no-op match), not the request's original.
      expectedUpdatedAt: expectedUpdatedAt ?? undefined,
    };

    await updateBomMasterTx(tx, id, payload, user);
  },

  async loadUpdatedAts(tx, companyId, ids) {
    const map = new Map<string, Date | string | null>();
    if (ids.length === 0) return map;
    const rows = await tx
      .select({ id: bomMasters.id, updatedAt: bomMasters.updatedAt })
      .from(bomMasters)
      .where(and(inArray(bomMasters.id, ids), eq(bomMasters.companyId, companyId)));
    for (const r of rows) map.set(r.id, r.updatedAt);
    return map;
  },
};
