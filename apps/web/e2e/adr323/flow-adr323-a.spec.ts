import { expect, test, type Page } from '@playwright/test';
const SHOT = 'e2e/adr323/shots/';

async function openRegister(page: Page, q = ''): Promise<unknown> {
  const resP = page.waitForResponse((r) => r.url().includes('/item-revisions/register') && r.status() === 200, { timeout: 60_000 });
  await page.goto('/drawing-register' + q, { waitUntil: 'domcontentloaded' });
  const res = await resP;
  const body = await res.json();
  await page.getByRole('columnheader').first().waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return body;
}

test('00 deploy + rights', async ({ page }) => {
  const accP = page.waitForResponse((r) => r.url().includes('/access-control/me'), { timeout: 60_000 });
  const body = (await openRegister(page)) as { items: Record<string, unknown>[]; total: number };
  const acc = await (await accP).json();
  const s = JSON.stringify(acc);
  console.log('ACCESS keys sample', s.slice(0, 600));
  for (const k of ['drawingreg_create', 'route_card', 'routecard', 'sales_order', 'so_', 'jwso', 'job_work']) {
    const re = new RegExp(`"[^"]*${k}[^"]*"\s*:\s*\{[^}]*\}`, 'g');
    console.log('RIGHT', k, (s.match(re) ?? []).slice(0, 4).join(' | '));
  }
  console.log('REGISTER total', body.total, 'row0 keys', Object.keys(body.items[0] ?? {}).join(','));
  console.log('HAS verifiedAt', body.items.length > 0 && 'verifiedAt' in body.items[0]);
  const opts = await page.getByLabel('Drawing Rev Status').locator('option').allTextContents();
  console.log('STATUS OPTIONS', opts.join(' / '));
  const pdfOpts = await page.getByLabel('PDF', { exact: true }).locator('option').allTextContents();
  console.log('PDF OPTIONS', pdfOpts.join(' / '));
  const headers = await page.getByRole('columnheader').allInnerTexts();
  console.log('HEADERS', headers.map((h) => h.replace(/\s+/g, ' ').trim()).join(' | '));
  await page.screenshot({ path: SHOT + '01-register.png', fullPage: false });
});
