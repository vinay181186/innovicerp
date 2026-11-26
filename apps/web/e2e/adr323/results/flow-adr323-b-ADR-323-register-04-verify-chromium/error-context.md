# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: flow-adr323-b.spec.ts >> ADR-323 register >> 04 verify
- Location: e2e\adr323\flow-adr323-b.spec.ts:142:3

# Error details

```
Error: response.json: Protocol error (Network.getResponseBody): No resource with given identifier found
```

# Page snapshot

```yaml
- generic [ref=e4]:
  - banner [ref=e5]:
    - navigation "Main" [ref=e6]:
      - link "Innovic" [ref=e7] [cursor=pointer]:
        - /url: /
        - img "Innovic" [ref=e8]
      - link "Dashboard" [ref=e9] [cursor=pointer]:
        - /url: /
      - generic [ref=e10]:
        - generic [ref=e11]:
          - img
          - textbox "Search anything" [ref=e12]:
            - /placeholder: Search anything… (Ctrl+K)
        - link "Change your password" [ref=e13] [cursor=pointer]:
          - /url: /change-password
          - img [ref=e14]
        - button "Sign out" [ref=e17] [cursor=pointer]:
          - img [ref=e18]
        - generic "Not signed in" [ref=e21]: "??"
    - navigation "Open pages" [ref=e22]:
      - link "Home Close Home" [ref=e24] [cursor=pointer]:
        - /url: /
        - generic [ref=e25]: 📄
        - generic [ref=e26]: Home
        - button "Close Home" [ref=e27]:
          - img [ref=e28]
      - link "Drawing Register Close Drawing Register" [ref=e32] [cursor=pointer]:
        - /url: /drawing-register?search=ADR323A&page=1
        - generic [ref=e33]: 📐
        - generic [ref=e34]: Drawing Register
        - button "Close Drawing Register" [ref=e35]:
          - img [ref=e36]
    - navigation "Breadcrumb" [ref=e39]:
      - generic [ref=e40]:
        - link "Home" [ref=e41] [cursor=pointer]:
          - /url: /
        - generic [ref=e42]: ›
      - generic [ref=e43]:
        - generic [ref=e44]: Design
        - generic [ref=e45]: ›
      - generic [ref=e47]: Drawing Register
  - generic [ref=e50]: ⟳ Loading…
```

# Test source

```ts
  1   | import { expect, test, type Page, type Locator } from '@playwright/test';
  2   | const SHOT = 'e2e/adr323/shots/';
  3   | const REV = 'ADR323A';
  4   | const log = (...a: unknown[]): void => console.log('>>', ...a);
  5   | type Row = {
  6   |   id: string;
  7   |   itemId: string;
  8   |   itemCode: string;
  9   |   label: string;
  10  |   hasFile: boolean;
  11  |   releaseStatus: string;
  12  |   verifiedAt: string | null;
  13  |   verifiedByName: string | null;
  14  |   drawingRev: string;
  15  | };
  16  | type Reg = { items: Row[]; total: number };
  17  | 
  18  | async function openRegister(page: Page, q = ''): Promise<Reg> {
  19  |   const resP = page.waitForResponse(
  20  |     (r) => r.url().includes('/item-revisions/register') && r.status() === 200,
  21  |     { timeout: 60_000 },
  22  |   );
  23  |   await page.goto('/drawing-register' + q, { waitUntil: 'domcontentloaded' });
> 24  |   const body = (await (await resP).json()) as Reg;
      |                                    ^ Error: response.json: Protocol error (Network.getResponseBody): No resource with given identifier found
  25  |   await page.getByRole('columnheader').first().waitFor({ timeout: 30_000 });
  26  |   await page.waitForTimeout(1500);
  27  |   return body;
  28  | }
  29  | const dlg = (page: Page): Locator => page.locator('[role=dialog],[role=alertdialog]').last();
  30  | async function rowOf(page: Page, text: string): Promise<Locator> {
  31  |   const r = page.getByRole('row').filter({ hasText: text }).first();
  32  |   await r.waitFor({ timeout: 30_000 });
  33  |   return r;
  34  | }
  35  | async function menuOf(page: Page, row: Locator): Promise<Locator> {
  36  |   await row.getByRole('button', { name: /Actions/ }).first().click();
  37  |   const m = page.getByRole('menu').first();
  38  |   await m.waitFor({ timeout: 10_000 });
  39  |   return m;
  40  | }
  41  | async function regRow(page: Page, label: string): Promise<Row | undefined> {
  42  |   const b = await openRegister(page, '?search=' + encodeURIComponent(REV));
  43  |   return b.items.find((i) => i.label === label);
  44  | }
  45  | const flat = (s: string): string => s.replace(/\s+/g, ' ').trim();
  46  | 
  47  | test.describe.serial('ADR-323 register', () => {
  48  |   let itemCode = '';
  49  |   let label = '';
  50  |   let revId = '';
  51  | 
  52  |   test('01 register filters', async ({ page }) => {
  53  |     const all = await openRegister(page);
  54  |     const body = await page.locator('body').innerText();
  55  |     log('C1 Correction Waiting present?', /Correction Waiting/i.test(body));
  56  |     const counts: Record<string, number> = { all: all.total };
  57  |     const qs: [string, string][] = [
  58  |       ['pdfYes', '?pdf=yes'],
  59  |       ['pdfNo', '?pdf=no'],
  60  |       ['unv', '?status=unverified'],
  61  |       ['ver', '?status=verified'],
  62  |       ['obs', '?status=obsolete'],
  63  |     ];
  64  |     for (const [k, q] of qs) {
  65  |       const b = await openRegister(page, q);
  66  |       counts[k] = b.total;
  67  |       if (k === 'pdfNo') {
  68  |         await page.screenshot({ path: SHOT + '01b-pdf-missing.png' });
  69  |         log('C1 pdfNo rows none hasFile', b.items.every((i) => !i.hasFile));
  70  |       }
  71  |       if (k === 'pdfYes') log('C1 pdfYes rows all hasFile', b.items.every((i) => i.hasFile));
  72  |     }
  73  |     log(
  74  |       'C1 counts',
  75  |       JSON.stringify(counts),
  76  |       'pdf sum ok',
  77  |       counts.pdfYes + counts.pdfNo === counts.all,
  78  |       'status sum ok',
  79  |       counts.unv + counts.ver + counts.obs === counts.all,
  80  |     );
  81  |     await openRegister(page);
  82  |     await page.getByLabel('PDF', { exact: true }).selectOption('no');
  83  |     await page.waitForTimeout(2500);
  84  |     log('C1 UI pdf select URL', page.url());
  85  |     await page.screenshot({ path: SHOT + '01c-pdf-filter-ui.png' });
  86  |   });
  87  | 
  88  |   test('02 menu on unverified no-PDF rev', async ({ page }) => {
  89  |     const b = await openRegister(page, '?status=unverified&pdf=no');
  90  |     log('C2 candidates', b.total, b.items[0]?.label);
  91  |     test.skip(b.items.length === 0, 'no unverified no-pdf rev');
  92  |     const row = await rowOf(page, b.items[0].label);
  93  |     const m = await menuOf(page, row);
  94  |     const items = await m.getByRole('menuitem').allInnerTexts();
  95  |     log('C2 menu items', items.map(flat).join(' | '));
  96  |     const v = m.getByRole('menuitem', { name: /Verify/ }).first();
  97  |     log('C2 verify aria-disabled', await v.getAttribute('aria-disabled'), 'title', await v.getAttribute('title'));
  98  |     await v.hover();
  99  |     await page.waitForTimeout(800);
  100 |     log('C2 menu text after hover', flat(await m.innerText()));
  101 |     log('C2 page shows reason', await page.getByText('Upload the drawing first').count());
  102 |     await page.screenshot({ path: SHOT + '02-menu-no-pdf.png' });
  103 |     await page.keyboard.press('Escape');
  104 |   });
  105 | 
  106 |   test('03 new drawing rev with PDF', async ({ page }) => {
  107 |     const all = await openRegister(page);
  108 |     itemCode = all.items[0].itemCode;
  109 |     label = `${itemCode}/${REV}`;
  110 |     const existing = await regRow(page, label);
  111 |     log('C3 item', itemCode, 'existing', JSON.stringify(existing ?? null));
  112 |     if (!existing) {
  113 |       await openRegister(page);
  114 |       await page.getByRole('button', { name: '+ New Drawing Rev' }).click();
  115 |       const d = dlg(page);
  116 |       await d.waitFor();
  117 |       const box = page.locator('#ndr-item');
  118 |       await box.click();
  119 |       await box.fill(itemCode);
  120 |       const opt = page.getByRole('option').filter({ hasText: itemCode }).first();
  121 |       await opt.waitFor({ timeout: 45_000 });
  122 |       await opt.click();
  123 |       await page.locator('#ndr-rev').fill(REV);
  124 |       await page.locator('#ndr-dno').fill('ADR323-DNO');
```