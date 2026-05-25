// Print Templates service — admin-only CRUD over the 15 customisable
// print blocks (PO / OSP DC / JW DC), plus revision history.
//
// A template "row" exists only when an admin has customised that block;
// otherwise the effective content is the factory default from
// PRINT_TEMPLATE_DEFAULTS (@innovic/shared). Mirror of legacy
// _ptSaveContent / _loadTemplate / _saveTemplateRevision / _ptRestoreDefault.
//
// DELTA vs legacy: we keep the FULL revision history (no hard delete — see
// CLAUDE.md Rule #8) and surface only the 5 most recent in the UI. "Reset to
// default" soft-deletes the customised row (after archiving its content to a
// revision), so the block cleanly falls back to the factory default.

import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  type EffectivePrintTemplate,
  isPrintTemplateKey,
  type ListPrintTemplateRevisionsResponse,
  type ListPrintTemplatesResponse,
  PRINT_TEMPLATE_META,
  printTemplateDefault,
  printTemplateDocType,
  type PrintTemplateRevision,
} from '@innovic/shared';
import { printTemplates, printTemplateRevisions, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';

const REVISIONS_SHOWN = 5;

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function assertKey(key: string): void {
  if (!isPrintTemplateKey(key)) throw new ValidationError(`Unknown print template key "${key}"`);
}

type Tx = Parameters<Parameters<typeof withUserContext>[1]>[0];

// Build the 15 effective templates by merging customised rows + defaults.
async function buildEffective(tx: Tx, companyId: string): Promise<EffectivePrintTemplate[]> {
  const rows = await tx
    .select()
    .from(printTemplates)
    .where(and(eq(printTemplates.companyId, companyId), isNull(printTemplates.deletedAt)));

  const revCounts = await tx
    .select({ key: printTemplateRevisions.templateKey, c: count() })
    .from(printTemplateRevisions)
    .where(eq(printTemplateRevisions.companyId, companyId))
    .groupBy(printTemplateRevisions.templateKey);

  const editorIds = [...new Set(rows.map((r) => r.updatedBy))];
  const editors = editorIds.length
    ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, editorIds))
    : [];

  const byKey = new Map(rows.map((r) => [r.templateKey, r]));
  const revCountByKey = new Map(revCounts.map((r) => [r.key, Number(r.c)]));
  const editorName = new Map(editors.map((e) => [e.id, e.name]));

  return PRINT_TEMPLATE_META.map((m) => {
    const row = byKey.get(m.key);
    return {
      templateKey: m.key,
      doc: m.doc,
      block: m.block,
      name: m.name,
      position: m.position,
      content: row ? row.content : printTemplateDefault(m.key),
      isCustomised: !!row,
      lastEditedBy: row ? (editorName.get(row.updatedBy) ?? null) : null,
      lastEditedAt: row ? row.updatedAt.toISOString() : null,
      revisionCount: revCountByKey.get(m.key) ?? 0,
    };
  });
}

function effectiveForKey(items: EffectivePrintTemplate[], key: string): EffectivePrintTemplate {
  const found = items.find((i) => i.templateKey === key);
  if (!found) throw new NotFoundError(`Print template ${key} not found`);
  return found;
}

export async function listPrintTemplates(user: AuthContext): Promise<ListPrintTemplatesResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    return { items: await buildEffective(tx, companyId) };
  });
}

export async function savePrintTemplate(
  key: string,
  content: string,
  user: AuthContext,
): Promise<EffectivePrintTemplate> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  assertKey(key);

  return withUserContext(user, async (tx) => {
    const existingRows = await tx
      .select()
      .from(printTemplates)
      .where(
        and(
          eq(printTemplates.companyId, companyId),
          eq(printTemplates.templateKey, key),
          isNull(printTemplates.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (existing) {
      // Archive the previous content before overwriting.
      await tx.insert(printTemplateRevisions).values({
        companyId,
        templateKey: key,
        content: existing.content,
        createdBy: user.id,
      });
      await tx
        .update(printTemplates)
        .set({ content, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(printTemplates.id, existing.id));
    } else {
      await tx.insert(printTemplates).values({
        companyId,
        templateKey: key,
        content,
        createdBy: user.id,
        updatedBy: user.id,
      });
    }

    return effectiveForKey(await buildEffective(tx, companyId), key);
  });
}

// Reset a block to its factory default: archive the customised content (if
// any) to a revision, then soft-delete the row so the default applies again.
export async function restorePrintTemplateDefault(
  key: string,
  user: AuthContext,
): Promise<EffectivePrintTemplate> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  assertKey(key);

  return withUserContext(user, async (tx) => {
    const existingRows = await tx
      .select()
      .from(printTemplates)
      .where(
        and(
          eq(printTemplates.companyId, companyId),
          eq(printTemplates.templateKey, key),
          isNull(printTemplates.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    if (existing) {
      await tx.insert(printTemplateRevisions).values({
        companyId,
        templateKey: key,
        content: existing.content,
        createdBy: user.id,
      });
      await tx
        .update(printTemplates)
        .set({ deletedAt: new Date(), updatedBy: user.id })
        .where(eq(printTemplates.id, existing.id));
    }

    return effectiveForKey(await buildEffective(tx, companyId), key);
  });
}

export async function listPrintTemplateRevisions(
  key: string,
  user: AuthContext,
): Promise<ListPrintTemplateRevisionsResponse> {
  requireCompany(user);
  assertKey(key);
  const companyId = user.companyId as string;

  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: printTemplateRevisions.id,
        templateKey: printTemplateRevisions.templateKey,
        content: printTemplateRevisions.content,
        createdAt: printTemplateRevisions.createdAt,
        createdBy: printTemplateRevisions.createdBy,
        editedByName: users.fullName,
      })
      .from(printTemplateRevisions)
      .leftJoin(users, eq(users.id, printTemplateRevisions.createdBy))
      .where(
        and(
          eq(printTemplateRevisions.companyId, companyId),
          eq(printTemplateRevisions.templateKey, key),
        ),
      )
      .orderBy(desc(printTemplateRevisions.createdAt))
      .limit(REVISIONS_SHOWN);

    const items: PrintTemplateRevision[] = rows.map((r) => ({
      id: r.id,
      templateKey: r.templateKey,
      content: r.content,
      createdAt: r.createdAt.toISOString(),
      createdBy: r.createdBy,
      editedByName: r.editedByName ?? null,
    }));
    return { items };
  });
}

// Exposed so the doc-type helper stays in one place for callers/tests.
export { printTemplateDocType };
