import { expect, test, type Page, type Locator } from '@playwright/test';
const SHOT = 'e2e/adr323/shots/';
const REV = 'ADR323A';
const log = (...a: unknown[]): void => console.log('>>', ...a);
type Row = {
  id: string;
  itemId: string;
  itemCode: string;
  label: string;
  hasFile: boolean;
  releaseStatus: string;
  verifiedAt: string | null;
  verifiedByName: string | null;
  drawingRev: string;
};
type Reg = { items: Row[]; total: number };

async function openRegister(page: Page, q = ''): Promise<Reg> {
  const resP = page.waitForResponse(
    (r) => r.url().includes('/item-revisions/register') && r.status() === 200,
    { timeout: 60_000 },
  );
  await page.goto('/drawing-register' + q, { waitUntil: 'domcontentloaded' });
  const body = (await (await resP).json()) as Reg;
  await page.getByRole('columnheader').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return body;
}
const dlg = (page: Page): Locator => page.locator('[role=dialog],[role=alertdialog]').last();
async function rowOf(page: Page, text: string): Promise<Locator> {
  const r = page.getByRole('row').filter({ hasText: text }).first();
  await r.waitFor({ timeout: 30_000 });
  return r;
}
async function menuOf(page: Page, row: Locator): Promise<Locator> {
  await row.getByRole('button', { name: /Actions/ }).first().click();
  const m = page.getByRole('menu').first();
  await m.waitFor({ timeout: 10_000 });
  return m;
}
async function regRow(page: Page, label: string): Promise<Row | undefined> {
  const b = await openRegister(page, '?search=' + encodeURIComponent(REV));
  return b.items.find((i) => i.label === label);
}
const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();

test.describe.serial('ADR-323 register', () => {
  let itemCode = '';
  let label = '';
  let revId = '';

  test('01 register filters', async ({ page }) => {
    const all = await openRegister(page);
    const body = await page.locator('body').innerText();
    log('C1 Correction Waiting present?', /Correction Waiting/i.test(body));
    const counts: Record<string, number> = { all: all.total };
    const qs: [string, string][] = [
      ['pdfYes', '?pdf=yes'],
      ['pdfNo', '?pdf=no'],
      ['unv', '?status=unverified'],
      ['ver', '?status=verified'],
      ['obs', '?status=obsolete'],
    ];
    for (const [k, q] of qs) {
      const b = await openRegister(page, q);
      counts[k] = b.total;
      if (k === 'pdfNo') {
        await page.screenshot({ path: SHOT + '01b-pdf-missing.png' });
        log('C1 pdfNo rows none hasFile', b.items.every((i) => !i.hasFile));
      }
      if (k === 'pdfYes') log('C1 pdfYes rows all hasFile', b.items.every((i) => i.hasFile));
    }
    log(
      'C1 counts',
      JSON.stringify(counts),
      'pdf sum ok',
      counts.pdfYes + counts.pdfNo === counts.all,
      'status sum ok',
      counts.unv + counts.ver + counts.obs === counts.all,
    );
    await openRegister(page);
    await page.getByLabel('PDF', { exact: true }).selectOption('no');
    await page.waitForTimeout(2500);
    log('C1 UI pdf select URL', page.url());
    await page.screenshot({ path: SHOT + '01c-pdf-filter-ui.png' });
  });

  test('02 menu on unverified no-PDF rev', async ({ page }) => {
    const b = await openRegister(page, '?status=unverified&pdf=no');
    log('C2 candidates', b.total, b.items[0]?.label);
    test.skip(b.items.length === 0, 'no unverified no-pdf rev');
    const row = await rowOf(page, b.items[0].label);
    const m = await menuOf(page, row);
    const items = await m.getByRole('menuitem').allInnerTexts();
    log('C2 menu items', items.map(flat).join(' | '));
    const v = m.getByRole('menuitem', { name: /Verify/ }).first();
    log('C2 verify aria-disabled', await v.getAttribute('aria-disabled'), 'title', await v.getAttribute('title'));
    await v.hover();
    await page.waitForTimeout(800);
    log('C2 menu text after hover', flat(await m.innerText()));
    log('C2 page shows reason', await page.getByText('Upload the drawing first').count());
    await page.screenshot({ path: SHOT + '02-menu-no-pdf.png' });
    await page.keyboard.press('Escape');
  });

  test('03 new drawing rev with PDF', async ({ page }) => {
    const all = await openRegister(page);
    itemCode = all.items[0].itemCode;
    label = `${itemCode}/${REV}`;
    const existing = await regRow(page, label);
    log('C3 item', itemCode, 'existing', JSON.stringify(existing ?? null));
    if (!existing) {
      await openRegister(page);
      await page.getByRole('button', { name: '+ New Drawing Rev' }).click();
      const d = dlg(page);
      await d.waitFor();
      const box = page.locator('#ndr-item');
      await box.click();
      await box.fill(itemCode);
      const opt = page.getByRole('option').filter({ hasText: itemCode }).first();
      await opt.waitFor({ timeout: 45_000 });
      await opt.click();
      await page.locator('#ndr-rev').fill(REV);
      await page.locator('#ndr-dno').fill('ADR323-DNO');
      await d.locator('input[type=file]').first().setInputFiles('e2e/adr323/ADR323A-drawing.pdf');
      await expect(d.getByText('ADR323A-drawing.pdf')).toBeVisible({ timeout: 30_000 });
      await page.locator('#ndr-note').fill('ADR323 e2e test rev');
      await page.screenshot({ path: SHOT + '03a-new-rev-dialog.png' });
      await d.getByRole('button', { name: 'Save Drawing Rev' }).click();
      await page.waitForURL(/\/drawings\//, { timeout: 30_000 });
      log('C3 navigated to', page.url());
      await page.waitForTimeout(2500);
      await page.screenshot({ path: SHOT + '03b-new-rev-drawing-page.png' });
    }
    const r = await regRow(page, label);
    revId = r?.id ?? '';
    log('C3 register row', JSON.stringify(r));
    await page.screenshot({ path: SHOT + '03c-new-rev-in-register.png' });
    expect(r?.hasFile).toBe(true);
  });

  test('04 verify', async ({ page }) => {
    await openRegister(page, '?search=' + REV);
    const row = await rowOf(page, label);
    const m = await menuOf(page, row);
    await m.getByRole('menuitem', { name: /Verify/ }).first().click();
    const d = dlg(page);
    await d.waitFor();
    await page.waitForTimeout(2000);
    log('C4 dialog text', flat(await d.innerText()));
    const btn = d.getByRole('button', { name: '✓ Verify' });
    log('C4 verify disabled before tick', await btn.isDisabled());
    await page.screenshot({ path: SHOT + '04a-verify-dialog.png' });
    if (!(await btn.isDisabled())) {
      await btn.click();
      await page.waitForTimeout(1500);
      log('C4 after click untick, dialog still open', await d.isVisible(), flat(await d.innerText()).slice(-200));
      await page.screenshot({ path: SHOT + '04b-verify-untick-click.png' });
    }
    await d.getByRole('checkbox').first().check();
    log('C4 verify disabled after tick', await btn.isDisabled());
    await btn.click();
    await expect(d).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const r = await regRow(page, label);
    log('C4 after verify', JSON.stringify(r));
    await page.screenshot({ path: SHOT + '04c-verified-row.png' });
  });

  test('05 replace on verified', async ({ page }) => {
    await openRegister(page, '?search=' + REV);
    const row = await rowOf(page, label);
    const m = await menuOf(page, row);
    log('C5 menu', (await m.getByRole('menuitem').allInnerTexts()).map(flat).join(' | '));
    await m.getByRole('menuitem', { name: /Replace drawing/ }).first().click();
    const d = dlg(page);
    await d.waitFor();
    const warn = d.getByText(/This drawing is Verified/).first();
    log('C5 warning count', await warn.count());
    if (await warn.count()) log('C5 warn color', await warn.evaluate((e) => getComputedStyle(e).color));
    await d.locator('#ir-replace-file').setInputFiles('e2e/adr323/ADR323A-drawing-v2.pdf');
    await page.waitForTimeout(4000);
    await page.locator('#ir-replace-reason').fill('ADR323 test replace with v2');
    await page.screenshot({ path: SHOT + '05a-replace-dialog.png' });
    await d.getByRole('button', { name: 'Replace drawing' }).click();
    await expect(d).toBeHidden({ timeout: 30_000 });
    const r = await regRow(page, label);
    log('C5 after replace', JSON.stringify(r));
    await page.screenshot({ path: SHOT + '05b-after-replace.png' });
  });

  test('06-07 drawing page', async ({ page }) => {
    const errs: string[] = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('/drawings/' + revId, { waitUntil: 'domcontentloaded' });
    await page.getByText(label).first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    const btns = async (): Promise<string> =>
      (await page.locator('button').allInnerTexts()).map(flat).filter(Boolean).join(' | ');
    log('C6 unverified buttons', await btns());
    log('C6 tabs', (await page.getByRole('tab').allInnerTexts()).map(flat).join(' | '));
    log('C6 correction text count', await page.getByText(/correction/i).count());
    const strip = page.getByText(/Unverified — /).first();
    if (await strip.count()) {
      log(
        'C6 strip',
        await strip.innerText(),
        await strip.evaluate((e) => {
          const s = getComputedStyle(e);
          return s.color + ' / ' + s.backgroundColor + ' / parent ' + getComputedStyle(e.parentElement as Element).backgroundColor;
        }),
      );
    } else log('C6 strip MISSING');
    await page.screenshot({ path: SHOT + '06a-page-unverified.png' });
    await page.getByRole('button', { name: /Verify/ }).first().click();
    let d = dlg(page);
    await d.waitFor();
    await page.waitForTimeout(1500);
    await d.getByRole('checkbox').first().check();
    await d.getByRole('button', { name: '✓ Verify' }).click();
    await expect(d).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    log('C6 verified buttons', await btns());
    log('C6 strip after verify', await page.getByText(/Unverified — /).count());
    await page.screenshot({ path: SHOT + '06b-page-verified.png' });
    // C7 undo verify — short reason
    await page.getByRole('button', { name: /Undo verify/ }).first().click();
    d = dlg(page);
    await d.waitFor();
    await d.locator('textarea').fill('abc');
    await d.getByRole('button', { name: '↺ Undo verify' }).click();
    await page.waitForTimeout(1500);
    log('C7 undo short: open', await d.isVisible(), flat(await d.innerText()).slice(-180));
    await page.screenshot({ path: SHOT + '07a-undo-short.png' });
    await d.locator('textarea').fill('ADR323 undo test');
    await d.getByRole('button', { name: '↺ Undo verify' }).click();
    await expect(d).toBeHidden({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    log('C7 after undo buttons', await btns(), 'strip', await page.getByText(/Unverified — /).count());
    await page.screenshot({ path: SHOT + '07b-after-undo.png' });
    // C7 obsolete — short reason, then cancel
    await page.getByRole('button', { name: /Mark Obsolete/ }).first().click();
    d = dlg(page);
    await d.waitFor();
    await d.locator('textarea').fill('abcd');
    await d.getByRole('button', { name: 'Mark Obsolete' }).click();
    await page.waitForTimeout(1500);
    log('C7 obsolete short: open', await d.isVisible(), flat(await d.innerText()).slice(-180));
    await page.screenshot({ path: SHOT + '07c-obsolete-short.png' });
    await d.getByRole('button', { name: 'Cancel' }).click();
    // C6 ?upload=1
    await page.goto('/drawings/' + revId + '?upload=1', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const d2 = page.locator('[role=dialog],[role=alertdialog]');
    log('C6 upload=1 dialog count', await d2.count(), (await d2.count()) ? flat(await d2.last().innerText()).slice(0, 100) : '', 'url', page.url());
    await page.screenshot({ path: SHOT + '06c-upload-param.png' });
    log('pageerrors', errs.join(' ; '));
  });
});
