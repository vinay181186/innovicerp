// QC Documents service (QC Wave 5). Mirrors legacy renderQCDocuments L23039.
// CRUD over qc_documents (migration 0039). Files themselves live in the
// `qc-docs` Storage bucket — the client uploads direct, then registers metadata.
// ADR-252: an upload belongs to its QC entry / report folder / order line
// (resolved here from the entry or the card); the QC Matrix is matrix.ts, the
// QC Dossier dossier.ts.

import { ActivityAction } from '@innovic/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type {
  CreateQcDocumentInput,
  ListQcDocumentsQuery,
  ListQcDocumentsResponse,
  QcDocument,
} from '@innovic/shared';
import { items, jobCards, jobWorkOrderLines, qcDocuments, salesOrderLines } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireDeleteRight, requireFormAccess } from '../../lib/access';
import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors';
import { softDeleteStamp } from '../../lib/audit-trail';
import { readSf, sfOrderBy, sfWhere } from '../../lib/list-query';
import { polOf } from '../../lib/pol';
import { assertCompanyStoragePath } from '../../lib/storage-path';
import { emitActivityLog } from '../activity-log/service';
import { QC_DOC_SF_COLUMNS } from './sf-columns';
import { resolveUploadTarget, sqlOne } from './upload-target';

function requireCompany(user: AuthContext): string {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
}

type Row = typeof qcDocuments.$inferSelect;

/** Exactly the qc_documents columns `toItem` reads. Narrower than the whole
 *  row on purpose: the register's list query now joins three more tables, so it
 *  names its columns explicitly instead of selecting everything, and this type
 *  is what makes the compiler prove the two shapes still agree. */
type DocRow = Pick<
  Row,
  | 'id'
  | 'companyId'
  | 'jobCardId'
  | 'jcCodeText'
  | 'salesOrderId'
  | 'soCodeText'
  | 'category'
  | 'docType'
  | 'fileName'
  | 'storagePath'
  | 'uploadedByText'
  | 'createdAt'
>;

/** The item facts that belong beside a JC number. A job-card number says WHICH
 *  JOB, not which part, so every list that prints one names the part too. They
 *  are passed in rather than read off the qc_documents row because the table
 *  holds no item at all — they come from the joined job card. */
interface DocItem {
  itemCode: string | null;
  itemRevision: string | null;
  clientPoLineNo: string | null;
  itemName: string | null;
  /** ADR-207: the document's SO's Internal SO No., read live off sales_orders. */
  soInternalNo?: string | null;
}

/** Used when there is no joined job card to read the item from — the register
 *  row for a document filed against an SO only, and the echo returned by the
 *  upload registration, which the browser discards in favour of refetching the
 *  list. Nulls here mean "not known on this path", never "no item". */
const NO_DOC_ITEM: DocItem = {
  itemCode: null,
  itemRevision: null,
  clientPoLineNo: null,
  itemName: null,
};

/** Escape the ILIKE metacharacters in a user's search term. Without this a
 *  user typing "a_b" — or a bare "%", which listed every registered document —
 *  gets a wildcard pattern instead of a literal search. The SQL side pairs it
 *  with an ESCAPE '\' clause on every ILIKE, or the escapes themselves start
 *  matching literally.
 *  Deliberately a local copy of the sales-orders / clients helper rather than
 *  an export across modules: it is three lines, and each list must stay free to
 *  change its own search behaviour without dragging the others. */
function escapeLikeTerm(raw: string): string {
  return raw.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function toItem(r: DocRow, item: DocItem = NO_DOC_ITEM): QcDocument {
  return {
    id: r.id,
    companyId: r.companyId,
    jobCardId: r.jobCardId ?? null,
    jcCodeText: r.jcCodeText ?? null,
    itemCode: item.itemCode ?? null,
    itemRevision: item.itemRevision ?? null,
    clientPoLineNo: item.clientPoLineNo ?? null,
    itemName: item.itemName ?? null,
    salesOrderId: r.salesOrderId ?? null,
    soCodeText: r.soCodeText ?? null,
    soInternalNo: item.soInternalNo ?? null,
    category: r.category,
    docType: r.docType,
    fileName: r.fileName,
    storagePath: r.storagePath,
    uploadedByText: r.uploadedByText ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

export async function listQcDocuments(
  input: ListQcDocumentsQuery,
  user: AuthContext,
): Promise<ListQcDocumentsResponse> {
  await requireFormAccess(user, 'qcdocs_upload', 'view');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const conds = [eq(qcDocuments.companyId, companyId), isNull(qcDocuments.deletedAt)];
    if (input.category) conds.push(eq(qcDocuments.category, input.category));
    if (input.jobCardId) conds.push(eq(qcDocuments.jobCardId, input.jobCardId));
    if (input.search) {
      // Search covers every column the QC document register (the Register view
      // in apps/web/src/modules/qc-documents/routes/list.tsx) actually shows:
      // Doc Type, File Name, Category, JC, Item Code, Item Name, SO, Uploaded
      // By and Date. Item Code and Item Name arrived with the joins below, and
      // a column the register puts on screen has to be a column the box finds —
      // the alternative is a register that visibly shows "plunger" and then
      // hides the row when someone types it.
      // Deliberately NOT searched:
      //  - storage path, and the matrix link columns (jc op, QC op name): none
      //    of them is on this table;
      //  - the serial numbers themselves: numbers, so "2" would hit nearly
      //    every document;
      //  - money: this table holds none, and QC screens gate prices behind
      //    canSeeFormPrice — a searchable amount would let a user without that
      //    right confirm a value by guessing it.
      const term = `%${escapeLikeTerm(input.search)}%`;
      conds.push(
        sql`(
          ${qcDocuments.docType} ILIKE ${term} ESCAPE '\\'
          OR ${qcDocuments.fileName} ILIKE ${term} ESCAPE '\\'
          OR ${qcDocuments.category} ILIKE ${term} ESCAPE '\\'
          OR ${qcDocuments.jcCodeText} ILIKE ${term} ESCAPE '\\'
          OR ${qcDocuments.soCodeText} ILIKE ${term} ESCAPE '\\'
          -- ADR-207: the SO's Internal SO No. (live, via the SO FK).
          OR EXISTS (
            SELECT 1 FROM public.sales_orders sso
            WHERE sso.id = ${qcDocuments.salesOrderId}
              AND sso.internal_so_no ILIKE ${term} ESCAPE '\\'
          )
          -- The item behind the job card, reached through the joins added
          -- below. A LEFT-joined column is NULL for a document with no card,
          -- and NULL ILIKE anything is NULL, so those documents simply do not
          -- match on these two terms — they are not excluded from the list.
          OR ${items.code} ILIKE ${term} ESCAPE '\\'
          OR ${items.name} ILIKE ${term} ESCAPE '\\'
          -- POL, the customer's own PO line number, now on the register. Off
          -- the same LEFT-joined SO / JWSO lines as the revision below (ADR-236),
          -- so a document with no card behind it simply does not match rather
          -- than dropping out of the list.
          OR ${polOf(salesOrderLines.clientPoLineNo, jobWorkOrderLines.clientPoLineNo)} ILIKE ${term} ESCAPE '\\'
          OR ${qcDocuments.uploadedByText} ILIKE ${term} ESCAPE '\\'
          -- The Date cell prints createdAt.slice(0,10) — the calendar day, not
          -- the timestamp — so match the date, not "…T09:14:22.981Z".
          OR ${qcDocuments.createdAt}::date::text ILIKE ${term} ESCAPE '\\'
        )`,
      );
    }
    // Sort & Filter (ADR-200): the register's column filters + sort, AND-ed
    // onto the search / category conditions; the page and the count share them.
    const sf = readSf(input.sf);
    conds.push(sql`TRUE ${sfWhere(QC_DOC_SF_COLUMNS, sf)}`);
    // The register prints a JC number, so it must name the part too — and
    // qc_documents holds no item at all, so the item comes off the job card.
    // Every one of these joins is LEFT and every one of them has to be:
    //  - job_cards, because qc_documents.job_card_id is NULLABLE. A document
    //    filed against an SO with no job card behind it is legitimate and must
    //    still appear in the register; an inner join would silently hide it.
    //    The deleted_at test lives in the ON clause, not the WHERE, so a
    //    soft-deleted card blanks the item instead of dropping the document.
    //  - items, for the same reason: never lose a document row because its
    //    card's item went missing.
    //  - sales_order_lines, because a JW-sourced or standalone card has no SO
    //    line at all. A null drawing revision is correct and common there, and
    //    the UI renders the bare item code for it.
    // The clause shapes are copied from the TPI read (apps/api/src/modules/
    // tpi/service.ts) so the two cannot drift apart. Each join matches on a
    // primary key, so none of them can multiply the document rows.
    //
    // Columns are named one by one rather than left as a bare .select(): on a
    // joined query that would return each table nested under its own key and
    // change the shape this function's mapper reads. `DocRow` is what keeps the
    // list and the create path feeding `toItem` the same thing.
    const where = and(...conds);
    const pageQuery = tx
      .select({
        id: qcDocuments.id,
        companyId: qcDocuments.companyId,
        jobCardId: qcDocuments.jobCardId,
        jcCodeText: qcDocuments.jcCodeText,
        salesOrderId: qcDocuments.salesOrderId,
        soCodeText: qcDocuments.soCodeText,
        category: qcDocuments.category,
        docType: qcDocuments.docType,
        fileName: qcDocuments.fileName,
        storagePath: qcDocuments.storagePath,
        uploadedByText: qcDocuments.uploadedByText,
        createdAt: qcDocuments.createdAt,
        itemCode: items.code,
        itemName: items.name,
        // The CUSTOMER's drawing revision, read live off the SO line the card
        // was raised against — or the JW line for a JWSO-sourced card
        // (ADR-177). Cast to text on purpose: the contract types this as a
        // string, and the column is only text on a database that has had
        // migration 0119 — on one that has not it is still the old integer and
        // would arrive wearing a string type. It is emphatically NOT
        // items.revision, a different column about the item master; handing a
        // plausible-looking wrong revision to an inspector is worse than
        // handing them a blank.
        itemRevision: sql<
          string | null
        >`COALESCE(${salesOrderLines.revision}::text, ${jobWorkOrderLines.revision}::text)`,
        // POL — the line number on the CUSTOMER's own purchase order, off the
        // SAME two line joins as the revision above: SO line first, else the
        // JWSO line (ADR-236); a standalone card stays null.
        clientPoLineNo: polOf(salesOrderLines.clientPoLineNo, jobWorkOrderLines.clientPoLineNo),
        // ADR-207: Internal SO No., live off the document's SO (FK).
        soInternalNo: sql<string | null>`(
          SELECT so.internal_so_no FROM public.sales_orders so
          WHERE so.id = ${qcDocuments.salesOrderId}
        )`,
      })
      .from(qcDocuments)
      .leftJoin(jobCards, and(eq(jobCards.id, qcDocuments.jobCardId), isNull(jobCards.deletedAt)))
      .leftJoin(items, eq(items.id, jobCards.itemId))
      .leftJoin(
        salesOrderLines,
        and(eq(salesOrderLines.id, jobCards.sourceSoLineId), isNull(salesOrderLines.deletedAt)),
      )
      .leftJoin(
        jobWorkOrderLines,
        and(eq(jobWorkOrderLines.id, jobCards.sourceJwLineId), isNull(jobWorkOrderLines.deletedAt)),
      )
      .where(where)
      // Ends on the id so paging (ADR-201) never skips or repeats a row.
      .orderBy(
        sfOrderBy(
          QC_DOC_SF_COLUMNS,
          sf,
          sql`${qcDocuments.createdAt} DESC, ${qcDocuments.id} DESC`,
        ),
      )
      .offset(input.offset ?? 0);
    const rows = await (input.limit !== undefined ? pageQuery.limit(input.limit) : pageQuery);
    // Same joins + WHERE as the page, so the total counts what the page pages.
    const [countRow] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(qcDocuments)
      .leftJoin(jobCards, and(eq(jobCards.id, qcDocuments.jobCardId), isNull(jobCards.deletedAt)))
      .leftJoin(items, eq(items.id, jobCards.itemId))
      .leftJoin(
        salesOrderLines,
        and(eq(salesOrderLines.id, jobCards.sourceSoLineId), isNull(salesOrderLines.deletedAt)),
      )
      .leftJoin(
        jobWorkOrderLines,
        and(eq(jobWorkOrderLines.id, jobCards.sourceJwLineId), isNull(jobWorkOrderLines.deletedAt)),
      )
      .where(where);
    return {
      total: countRow?.n ?? 0,
      items: rows.map((r) =>
        toItem(r, {
          itemCode: r.itemCode,
          itemRevision: r.itemRevision,
          clientPoLineNo: r.clientPoLineNo,
          itemName: r.itemName,
          soInternalNo: r.soInternalNo,
        }),
      ),
    };
  });
}

export async function createQcDocument(
  input: CreateQcDocumentInput,
  user: AuthContext,
): Promise<QcDocument> {
  await requireFormAccess(user, 'qcdocs_upload', 'entry');
  const companyId = requireCompany(user);
  // A storage path is a guessable string; it must sit in this company's folder.
  // A blank path is not a file at all — refused here too.
  if (!input.storagePath.trim()) {
    throw new ValidationError('The file was not uploaded to this company. Upload it again.');
  }
  assertCompanyStoragePath(input.storagePath, companyId);
  return withUserContext(user, async (tx) => {
    const t = await resolveUploadTarget(tx, companyId, input);
    const inserted = await tx
      .insert(qcDocuments)
      .values({
        companyId,
        jobCardId: t.jobCardId,
        jcCodeText: t.jcCodeText,
        salesOrderId: t.salesOrderId,
        soCodeText: t.soCodeText,
        category: input.category,
        docType: t.docType,
        fileName: input.fileName,
        storagePath: input.storagePath,
        uploadedByText: user.email ?? null,
        jcOpId: t.jcOpId,
        qcOpName: t.qcOpName,
        soLineId: t.soLineId,
        jwLineId: t.jwLineId,
        opLogId: t.opLogId,
        reportTypeId: t.reportTypeId,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    const row = inserted[0] as Row;
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Create,
        entity: 'QcDocument',
        entityId: row.id,
        refId: t.jcCodeText ?? t.soCodeText ?? null,
        detail: `QC report ${t.docType} uploaded — ${input.fileName}`,
      },
      companyId,
      user,
    );
    return toItem(row);
  });
}

export async function deleteQcDocument(id: string, user: AuthContext): Promise<{ id: string }> {
  // ADR-232 — deleting any record needs L6 Super Admin.
  await requireDeleteRight(user, 'QC documents');
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // §20.2 — one conditional UPDATE; 0 rows = gone already or never existed.
    const updated = await tx
      .update(qcDocuments)
      .set({ ...softDeleteStamp(user), updatedBy: user.id, updatedAt: new Date() })
      .where(
        and(
          eq(qcDocuments.id, id),
          eq(qcDocuments.companyId, companyId),
          isNull(qcDocuments.deletedAt),
        ),
      )
      .returning({
        id: qcDocuments.id,
        docType: qcDocuments.docType,
        fileName: qcDocuments.fileName,
        jc: qcDocuments.jcCodeText,
        so: qcDocuments.soCodeText,
      });
    const row = updated[0];
    if (!row) {
      const gone = await sqlOne(
        tx,
        sql`SELECT qd.deleted_at, COALESCE(u.full_name, u.email) AS by_name
            FROM public.qc_documents qd LEFT JOIN public.users u ON u.id = qd.deleted_by
            WHERE qd.id = ${id}::uuid AND qd.company_id = ${companyId}::uuid`,
      );
      if (gone?.['deleted_at']) {
        throw new ConflictError(
          `This QC document was already deleted${gone['by_name'] ? ` by ${String(gone['by_name'])}` : ''}. Refresh the page.`,
        );
      }
      throw new NotFoundError('QC Document not found. Refresh the page.');
    }
    await emitActivityLog(
      tx,
      {
        action: ActivityAction.Delete,
        entity: 'QcDocument',
        entityId: id,
        refId: row.jc ?? row.so ?? null,
        detail: `QC report ${row.docType} deleted — ${row.fileName}`,
      },
      companyId,
      user,
    );
    return { id };
  });
}
