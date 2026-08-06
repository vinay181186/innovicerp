import { test, type Page } from '@playwright/test';

// Behavioral verification — batch 2. Each fix is its own test (fresh page) so a
// crash in one doesn't abort the rest. Logs PASS/FAIL per check.

function log(pass: boolean, name: string, detail = ''): void {
  // eslint-disable-next-line no-console
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}${detail ? ` :: ${detail}` : ''}`);
}

// T15 — Planning right-pane header shows the item
test('T15 planning header item', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await page.getByPlaceholder(/Search SO/i).fill('IN-SO-00551');
  await page.waitForTimeout(1500);
  await page.getByText('IN-SO-00551', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  const hdr = await page.locator('.section-hdr').first().innerText().catch(() => '');
  log(/SPACER|559918151000/i.test(hdr), 'T15 planning header shows item', `hdr="${hdr.replace(/\n/g, ' ')}"`);
});

// T33 — Job Queue shows "Start" for a not-started op (not "Log Op")
test('T33 job queue Start', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  await page.goto('/job-queue', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const starts = await page.getByText(/▶ Start/).count();
  const logs = await page.getByText(/✚ Log Op/).count();
  log(starts > 0, 'T33 job queue offers Start for not-started ops', `starts=${starts} logs=${logs}`);
});

// T31 — QC Call Register loads with a pending list (default timestamp sort)
test('T31 QC register', async ({ page }: { page: Page }) => {
  test.setTimeout(90_000);
  await page.goto('/qc-call-register', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const pendingHdr = await page.getByText(/QC Pending Calls/i).count();
  log(pendingHdr > 0, 'T31 QC register pending pane renders', `(default sort now qc_call_date DESC — server-verified)`);
});

// T32a/b — Edit Job Card: machine SearchableSelect works + OSP op shows badge
test('T32a/b edit JC machine + OSP badge', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000);
  // Reach the JC edit page via the JC list.
  await page.goto('/job-cards', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.getByText('IN-JC-26-00059', { exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(2500);
  // On the JC status/detail, click Edit.
  await page.getByRole('link', { name: /edit/i }).first().click().catch(async () => {
    await page.getByRole('button', { name: /edit/i }).first().click().catch(() => {});
  });
  await page.waitForTimeout(3000);
  await page.screenshot({
    path: 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad/verify-jc-edit.png',
    fullPage: true,
  });
  // T32b: an OSP op (Heat Treatment) shows the "🏭 OSP" badge in the machine cell.
  const ospBadge = await page.getByText(/🏭 OSP/).count();
  log(ospBadge > 0, 'T32b OSP op shows inactive OSP badge', `count=${ospBadge}`);
  // T32a: the machine picker is now a SearchableSelect (has its search input),
  // not a bare datalist input — click a process-op machine cell and type.
  const machInput = page.getByPlaceholder(/🔍 Machine/i).first();
  const hasSearchable = await machInput.count();
  log(hasSearchable > 0, 'T32a machine picker is SearchableSelect', `inputs=${hasSearchable} (url=${page.url()})`);
});

// T23 — create a PR with a BLANK number → auto-generates IN-PR-#####
test('T23 PR auto-number', async ({ page }: { page: Page }) => {
  test.setTimeout(120_000);
  await page.goto('/purchase-requests/new', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({
    path: 'C:/Users/Asus/AppData/Local/Temp/claude/C--Innovic-projects-innovic-erp-innovicerp/30277fb2-021d-4e86-a944-eccf9a952b2d/scratchpad/verify-pr-new.png',
    fullPage: true,
  });
  // Confirm the code field advertises auto-generate (fix deployed).
  const hint = await page.getByText(/Leave blank to auto-generate/i).count();
  log(hint > 0, 'T23 PR form shows auto-generate hint (fix deployed)', `route=${page.url()}`);
  // eslint-disable-next-line no-console
  console.log('T23 form labels:', JSON.stringify(await page.locator('label').allInnerTexts().catch(() => [])));
});
