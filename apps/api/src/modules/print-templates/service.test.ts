import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PRINT_TEMPLATE_DEFAULTS,
  PRINT_TEMPLATE_KEYS,
  accessFormPermsSchema,
} from '@innovic/shared';
import { db } from '../../db/client';
import { printTemplateRevisions, printTemplates, users } from '../../db/schema';
import type { AuthContext } from '../../db/with-user-context';
import { AuthorizationError, ValidationError } from '../../lib/errors';
import { AUDITOR, asAccess } from '../../lib/test-access';
import * as service from './service';

const EDIT_TICK = accessFormPermsSchema.parse({ view: true, entry: false, edit: true });

const ADMIN_EMAIL = 'innovic.technology@gmail.com';
// Keys this suite mutates — cleaned up in afterAll (scoped, never company-wide).
const TOUCHED_KEYS = ['po_terms', 'po_special_notes', 'jwdc_footer'];

let admin: AuthContext;

beforeAll(async () => {
  const rows = await db.select().from(users).where(eq(users.email, ADMIN_EMAIL)).limit(1);
  const u = rows[0];
  if (!u || !u.companyId) throw new Error('Seed admin missing');
  admin = { id: u.id, email: u.email, companyId: u.companyId, role: u.role, isActive: u.isActive };
});

async function cleanup(): Promise<void> {
  if (!admin?.companyId) return;
  await db
    .delete(printTemplateRevisions)
    .where(
      and(
        eq(printTemplateRevisions.companyId, admin.companyId),
        inArray(printTemplateRevisions.templateKey, TOUCHED_KEYS),
      ),
    );
  await db
    .delete(printTemplates)
    .where(
      and(
        eq(printTemplates.companyId, admin.companyId),
        inArray(printTemplates.templateKey, TOUCHED_KEYS),
      ),
    );
}

beforeAll(cleanup);
afterAll(cleanup);

describe('print-templates service', () => {
  it('lists 15 effective templates, defaulting to factory text', async () => {
    const { items } = await service.listPrintTemplates(admin);
    expect(items).toHaveLength(PRINT_TEMPLATE_KEYS.length);
    expect(items).toHaveLength(15);
    // A key this suite never mutates → must read as the factory default.
    const ospTerms = items.find((i) => i.templateKey === 'ospdc_terms');
    expect(ospTerms).toBeDefined();
    expect(ospTerms?.content).toBe(PRINT_TEMPLATE_DEFAULTS.ospdc_terms);
    expect(ospTerms?.isCustomised).toBe(false);
    expect(ospTerms?.doc).toBe('OSP DC');
    expect(ospTerms?.block).toBe('terms');
  });

  it('savePrintTemplate customises a block + records edit metadata', async () => {
    const saved = await service.savePrintTemplate('po_terms', 'Custom payment terms apply.', admin);
    expect(saved.content).toBe('Custom payment terms apply.');
    expect(saved.isCustomised).toBe(true);
    expect(saved.lastEditedAt).toBeTruthy();
    expect(saved.revisionCount).toBe(0); // first edit — nothing archived yet
  });

  it('saving again archives the previous content as a revision', async () => {
    await service.savePrintTemplate('po_terms', 'Second version of the terms.', admin);
    const { items } = await service.listPrintTemplateRevisions('po_terms', admin);
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Most recent revision holds the PREVIOUS content.
    expect(items[0]?.content).toBe('Custom payment terms apply.');
    const eff = (await service.listPrintTemplates(admin)).items.find(
      (i) => i.templateKey === 'po_terms',
    );
    expect(eff?.content).toBe('Second version of the terms.');
    expect(eff?.revisionCount).toBeGreaterThanOrEqual(1);
  });

  it('rejects an unknown template key', async () => {
    await expect(service.savePrintTemplate('bogus_key', 'x', admin)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('requires the Print Templates Edit tick to write (ADR-232, owner D4)', async () => {
    // L5 in another department, no Print Templates tick — refused.
    const untick = asAccess(admin, { departments: { sales: 'L5' } }, 'manager');
    await expect(
      service.savePrintTemplate('po_terms', 'nope', untick),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      service.restorePrintTemplateDefault('po_terms', untick),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('the Edit tick alone passes the gate, whatever the role (ADR-232)', async () => {
    const ticked = asAccess(admin, { forms: { printtpl_edit: EDIT_TICK } }, 'operator');
    // An unknown key fails AFTER the gate — a ValidationError, not a refusal.
    await expect(service.savePrintTemplate('not_a_key', 'x', ticked)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(service.restorePrintTemplateDefault('not_a_key', ticked)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('an L7 Auditor is refused even with the Edit tick stored', async () => {
    const auditor = asAccess(admin, { ...AUDITOR, forms: { printtpl_edit: EDIT_TICK } }, 'viewer');
    await expect(
      service.savePrintTemplate('po_terms', 'nope', auditor),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('restorePrintTemplateDefault reverts to factory default + archives current', async () => {
    await service.savePrintTemplate('po_special_notes', 'A customised special note.', admin);
    const restored = await service.restorePrintTemplateDefault('po_special_notes', admin);
    expect(restored.content).toBe(PRINT_TEMPLATE_DEFAULTS.po_special_notes);
    expect(restored.isCustomised).toBe(false);
    const { items } = await service.listPrintTemplateRevisions('po_special_notes', admin);
    expect(items.some((r) => r.content === 'A customised special note.')).toBe(true);
  });

  it('lists revisions most-recent-first, capped at 5', async () => {
    for (let i = 1; i <= 7; i++) {
      await service.savePrintTemplate('jwdc_footer', `footer v${i}`, admin);
    }
    const { items } = await service.listPrintTemplateRevisions('jwdc_footer', admin);
    expect(items).toHaveLength(5); // 6 archived (v1..v6), shown cap = 5
    // Newest archived first: the archive made on the 7th save holds "footer v6".
    expect(items[0]?.content).toBe('footer v6');
    expect(items[4]?.content).toBe('footer v2');
  });
});
