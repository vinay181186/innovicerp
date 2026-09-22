import { expect, test, request as pwRequest, type Page } from '@playwright/test';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/**
 * Item product image (3D render) + Drawing No. typed on the SO line
 * (user decision 2026-09-21).
 *
 * Runs ONLY against the deployed TEST stack under playwright.pages.config.ts
 * (https://innovic-erp.pages.dev → api-test-production-19ca.up.railway.app).
 * The TEST database is separate from production; creating E2E_ records there
 * is allowed. Every record this file creates carries `E2E` in a free-text
 * field (item name, client PO ref, drawing no.) so it can be found again.
 *
 * What it proves, in order (each test records ✓/✗ rows for the PDF):
 *   S1 item form fields + create item + upload picture (1200×900 → ≤ 800 px)
 *   S2 Item Master list: 40 px picture box, code link, sheet header (no sort toggles), no Drw
 *   S3 Item detail: 96 px box, preview modal, no Revision / Drawing no.
 *   S4 SO line: Drawing No. typed, kept on re-pick, shown on detail, cleared on edit
 *   S5 JC list: 40 px (list) / 56 px (card) box, picture click ≠ row click, no drawing-file calls
 *   S6 security: other company's path → 404, own → 200, no token → 401
 *   S7 layout at 1280×800: no horizontal scroll, every badge exactly 40×40
 *   S8 cleanup: UI Delete of the SO (when no JC hangs off it) and the item
 *   ZZ render the six-column PDF + JSON
 *
 * State (item id, SO id, JC code, bearer…) is kept in a JSON file so a single
 * step can be re-run with --grep without rebuilding the chain. For a FRESH run
 * delete .playwright/reports/item-image-state.json first — otherwise S1 reuses
 * the previous (already deleted) item.
 *
 * Run (from apps/web):
 *   npx playwright test --config=playwright.pages.config.ts e2e/flow-item-image.spec.ts --reporter=list
 */

const WEB = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web';
const REPORTS = `${WEB}/.playwright/reports`;
const SHOTS = `${REPORTS}/item-image-shots`;
const STATE_FILE = `${REPORTS}/item-image-state.json`;
const PDF_FILE = `${REPORTS}/item-image-verification-2026-09-21.pdf`;
const JSON_FILE = `${REPORTS}/item-image-verification-2026-09-21.json`;
const API = 'https://api-test-production-19ca.up.railway.app';

// Playwright's default per-action timeout (30 s) is plenty; the test timeout
// comes from the config (600 s). The test stack is slow on first paint.
test.setTimeout(600_000);
// A mis-matched locator must fail in 30 s, not eat the whole 10-minute budget.
test.use({ actionTimeout: 30_000 });

// ─── state + report rows ─────────────────────────────────────────────────────

interface Row {
  id: string;
  action: string;
  document: string;
  qty: string;
  headerStatus: string;
  overall: string;
  result: 'PASS' | 'FAIL' | 'N/A' | 'SKIP';
}

interface State {
  ts: string;
  itemCode: string;
  itemId?: string;
  companyId?: string;
  imagePath?: string;
  signedUrl?: string;
  servedDims?: string;
  bearer?: string;
  soCode?: string;
  soId?: string;
  drawingNo: string;
  jcCode?: string;
  jcId?: string;
  pln?: string;
  rcCode?: string;
  proCode?: string;
  proId?: string;
  rows: Row[];
  findings: string[];
}

function readState(): State {
  if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State;
  const ts = String(Date.now()).slice(-8);
  return { ts, itemCode: `E2E-IMG-${ts}`, drawingNo: `DRG-E2E-${ts}`, rows: [], findings: [] };
}
function saveState(s: State): void {
  mkdirSync(REPORTS, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`>> ${msg}`);
}
function record(s: State, row: Row): void {
  s.rows = s.rows.filter((r) => r.id !== row.id);
  s.rows.push(row);
  saveState(s);
  log(`${row.result === 'PASS' ? '✓' : row.result === 'FAIL' ? '✗' : '—'} ${row.id} ${row.action} — ${row.overall}`);
}
function finding(s: State, text: string): void {
  if (!s.findings.includes(text)) s.findings.push(text);
  saveState(s);
}
/** Run one check; on failure record a FAIL row (with the error text) and rethrow
 *  so the test itself goes red — an assertion is never loosened here. */
async function check(
  s: State,
  id: string,
  action: string,
  doc: string,
  fn: () => Promise<string>,
  extra: Partial<Row> = {},
): Promise<void> {
  try {
    const overall = await fn();
    record(s, { id, action, document: doc, qty: '—', headerStatus: '—', overall, result: 'PASS', ...extra });
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e);
    record(s, { id, action, document: doc, qty: '—', headerStatus: '—', ...extra, overall: msg.slice(0, 220), result: 'FAIL' });
    throw e;
  }
}
async function snap(page: Page, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  log(`shot: ${p}`);
  return p;
}
async function box(page: Page, selector: string, nth = 0): Promise<{ w: number; h: number }> {
  const b = await page.locator(selector).nth(nth).boundingBox();
  if (!b) throw new Error(`no bounding box for ${selector}`);
  return { w: Math.round(b.width * 100) / 100, h: Math.round(b.height * 100) / 100 };
}
function within(v: number, target: number, tol = 1): boolean {
  return Math.abs(v - target) <= tol;
}

// ─── a real PNG, written here (no fixture file, no third-party encoder) ──────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
/** Opaque orange canvas with a dark-blue rounded lever shape and a white bore —
 *  distinct enough to be recognisable at 40 px. */
function makePng(w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  const cx = w * 0.4;
  const cy = h * 0.5;
  for (let y = 0; y < h; y += 1) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x += 1) {
      let r = 0xf5;
      let g = 0x8a;
      let b = 0x1f;
      const inBar = y > h * 0.42 && y < h * 0.58 && x > w * 0.3 && x < w * 0.9;
      const dHub = Math.hypot(x - cx, y - cy);
      if (inBar || dHub < h * 0.2) {
        r = 0x1e;
        g = 0x3a;
        b = 0x8a;
      }
      if (dHub < h * 0.07) {
        r = 0xff;
        g = 0xff;
        b = 0xff;
      }
      const o = y * (w * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Width × height read straight off the bytes — PNG IHDR or JPEG SOFn. */
function imageDims(buf: Buffer): { w: number; h: number; type: string } {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), type: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const m = buf[i + 1]!;
      if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xff) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
      if (isSof) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), type: 'jpeg' };
      i += 2 + len;
    }
  }
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    // VP8 (lossy) simple header — enough for a dimension read.
    if (buf.slice(12, 16).toString('ascii') === 'VP8 ') {
      return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff, type: 'webp' };
    }
  }
  throw new Error(`unrecognised image bytes (${buf.length} B, starts ${buf.slice(0, 4).toString('hex')})`);
}

// ─── shared page helpers ─────────────────────────────────────────────────────

/** Capture the bearer the app sends to the API — needed for the security step. */
function watchBearer(page: Page, s: State): void {
  page.on('request', (req) => {
    const a = req.headers()['authorization'];
    if (a && a.startsWith('Bearer ') && req.url().startsWith(API)) {
      if (s.bearer !== a) {
        s.bearer = a;
        saveState(s);
      }
    }
  });
}

async function gotoApp(page: Page, path: string, settleMs = 2500): Promise<void> {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(settleMs);
}

/** Type-to-search picker: type `term`, click the option whose text matches. */
async function pickOption(page: Page, input: ReturnType<Page['locator']>, term: string, optText: RegExp): Promise<void> {
  await input.click();
  await input.fill(term);
  await page.waitForTimeout(1500);
  const opt = page.locator('[role="option"]').filter({ hasText: optText }).first();
  await expect(opt, `option ${optText} for "${term}"`).toBeVisible({ timeout: 15_000 });
  await opt.click();
  await page.waitForTimeout(500);
}

/** Route Card (one process op on the first machine in the master) → Plan (qty 1)
 *  on the SO line → Production Order → Job Card. Every step is one of the app's
 *  own screens; codes are read back off the page. */
async function raiseJcViaRouteCard(page: Page, s: State): Promise<void> {
  // 1. Route Card for the E2E item
  if (!s.rcCode) {
    await gotoApp(page, '/route-cards/new', 3000);
    const itemInput = page.getByPlaceholder(/Search item code or name/i).first();
    await pickOption(page, itemInput, s.itemCode, new RegExp(s.itemCode));
    // The new-card form already starts with ONE empty process row — fill it,
    // do not add a second (an empty extra row keeps Save disabled).
    const opName = page.getByPlaceholder(/od turn, mill, drill/i).first();
    await opName.fill('E2E_ TURNING');
    const machineInput = page.getByPlaceholder(/Machine code|Machine in group/i).first();
    const firstMachine = await page.locator('datalist[id^="rc-machines-dl-"] option').first().getAttribute('value', { timeout: 15_000 }).catch(() => null);
    if (!firstMachine) throw new Error('no machine in the Machine master — a process op needs one');
    await machineInput.fill(firstMachine);
    await page.waitForTimeout(500);
    const save = page.getByRole('button', { name: /Save Route Card/ });
    await expect(save).toBeEnabled({ timeout: 15_000 });
    await save.click();
    await expect(page).toHaveURL(/\/route-cards\/[0-9a-f-]{36}/, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    s.rcCode = ((await page.locator('body').innerText()).match(/IN-RC-\d+/) ?? ['IN-RC-?'])[0];
    saveState(s);
    log(`route card ${s.rcCode} (machine ${firstMachine})`);
  }
  // 2. Plan on the SO line (qty defaults to the uncovered remaining = 1)
  if (!s.pln) {
    await gotoApp(page, '/planning', 3000);
    await page.getByPlaceholder(/Search order no/i).fill(s.soCode!);
    await page.waitForTimeout(1500);
    const soRow = page.locator('table tbody tr').filter({ hasText: s.soCode! }).first();
    await expect(soRow).toBeVisible({ timeout: 30_000 });
    await soRow.click();
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /\+ ?Plan\b/ }).first().click();
    const createBtn = page.getByRole('button', { name: /^Create Plan$/ });
    await expect(createBtn).toBeVisible({ timeout: 15_000 });
    const qty = page.locator('#create-plan-qty');
    if (await qty.isVisible().catch(() => false)) await qty.fill('1');
    await createBtn.click();
    await expect(createBtn).toBeHidden({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    s.pln = ((await page.locator('body').innerText()).match(/(?:IN-)?PLN-[\w-]+/) ?? ['PLN-?'])[0];
    saveState(s);
    log(`plan ${s.pln}`);
  }
  // 3. Production Order → Create JC
  await gotoApp(page, '/production-orders/new', 3000);
  const planInput = page.getByPlaceholder(/Type plan no, item code or SO no/i).first();
  await pickOption(page, planInput, s.soCode!, new RegExp(`${s.soCode}|${s.itemCode}`));
  const rc = page.locator('#po-route-card');
  await expect(rc).toBeEnabled({ timeout: 30_000 });
  await expect.poll(() => rc.locator('option').count(), { timeout: 30_000 }).toBeGreaterThan(1);
  await rc.selectOption({ index: 1 });
  const today = new Date().toISOString().slice(0, 10);
  await page.locator('#po-target-date').fill(today);
  const createJc = page.getByRole('button', { name: /Create JC/ });
  await expect(createJc).toBeEnabled({ timeout: 15_000 });
  await createJc.click();
  await expect(page).toHaveURL(/\/production-orders\/[0-9a-f-]{36}/, { timeout: 45_000 });
  s.proId = page.url().match(/production-orders\/([0-9a-f-]{36})/)![1]!;
  await page.waitForTimeout(2000);
  const body = await page.locator('body').innerText();
  s.proCode = (body.match(/IN-PRO-\d+/) ?? ['IN-PRO-?'])[0];
  // The planning screen may not have shown the new chip yet — the PO page names the plan too.
  if (!s.pln || !/PLN-\d/.test(s.pln)) s.pln = (body.match(/PLN-\d+/) ?? [s.pln ?? 'PLN-?'])[0];
  const jcLink = page.locator('a[href*="/job-cards/"]').first();
  await expect(jcLink).toBeVisible({ timeout: 30_000 });
  s.jcCode = (await jcLink.innerText()).trim();
  s.jcId = (await jcLink.getAttribute('href'))?.match(/job-cards\/([0-9a-f-]{36})/)?.[1];
  if (!/IN-JC-/.test(s.jcCode)) s.jcCode = (body.match(/IN-JC-[\w-]+/) ?? [s.jcCode])[0];
  saveState(s);
  log(`production order ${s.proCode} → job card ${s.jcCode}`);
}

const BOX_IMG = '[title="Product image"]';
const BOX_NONE = '[title="No product image"]';

// ═════════════════════════════════════════════════════════════════════════════

test('S1 item form: fields, create item, upload picture (1200×900 → ≤800 px)', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  log(`item code for this run: ${s.itemCode}`);

  // ── S1a: the form has the right fields, and NOT the drawing ones ──
  await gotoApp(page, '/items/new');
  await expect(page.locator('#code')).toBeVisible({ timeout: 30_000 });
  const panel = page.locator('form').first();
  await snap(page, '01-item-form-new');

  await check(s, 'S1-01', 'Item form: expected fields present', '/items/new', async () => {
    const present: string[] = [];
    for (const label of ['Item Code', 'Item Name', 'Description', 'Material', 'UOM', 'Item Type', 'Source', 'HSN Code', 'Product image']) {
      const n = await panel.locator('label.form-label').filter({ hasText: new RegExp(`^\\s*${label}`) }).count();
      expect(n, `label "${label}"`).toBeGreaterThan(0);
      present.push(label);
    }
    return `present: ${present.join(', ')}`;
  });

  await check(s, 'S1-02', 'Item form: Drawing No. / Revision / Drawing File ABSENT', '/items/new', async () => {
    const txt = await panel.innerText();
    for (const bad of ['Drawing No', 'Revision', 'Drawing File']) {
      expect(txt, `form text must not contain "${bad}"`).not.toMatch(new RegExp(bad, 'i'));
    }
    expect(await panel.locator('#drawingNo, #revision, [name="drawingNo"], [name="revision"], [name="drawingFilePath"]').count()).toBe(0);
    return 'no Drawing No. / Revision / Drawing File label or input in the form';
  });

  // ── S1b: create the item with code + name only ──
  await check(s, 'S1-03', 'Create item (code + name only)', s.itemCode, async () => {
    await page.locator('#code').fill(s.itemCode);
    await page.locator('#name').fill('E2E_ Image test lever');
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page).toHaveURL(/\/items\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    s.itemId = page.url().match(/\/items\/([0-9a-f-]{36})/)![1]!;
    saveState(s);
    await expect(page.getByText(s.itemCode).first()).toBeVisible({ timeout: 20_000 });
    return `saved → /items/${s.itemId}; name "E2E_ Image test lever"`;
  }, { headerStatus: 'created' });

  // ── S1c: edit page → upload picture ──
  await gotoApp(page, `/items/${s.itemId}/edit`);
  await expect(page.locator('#name')).toHaveValue('E2E_ Image test lever', { timeout: 30_000 });
  await expect(page.locator(BOX_NONE).first()).toBeVisible();
  await snap(page, '02-item-form-edit-product-image-field');

  const png = makePng(1200, 900);
  log(`generated PNG: 1200×900, ${png.length} bytes`);

  const uploadReqP = page.waitForRequest(
    (r) => /\/storage\/v1\/object\/qc-docs\//.test(r.url()) && r.method() === 'POST',
    { timeout: 60_000 },
  );
  const urlRespP = page.waitForResponse((r) => r.url().includes('/item-images/url?path='), { timeout: 60_000 });

  await page.locator('input[type="file"]').setInputFiles({ name: 'e2e-lever.png', mimeType: 'image/png', buffer: png });

  await check(s, 'S1-04', 'Upload goes to Supabase Storage under <companyId>/item-images/', s.itemCode, async () => {
    const req = await uploadReqP;
    const resp = await req.response();
    const rest = decodeURIComponent(req.url().split('/storage/v1/object/qc-docs/')[1]!);
    const m = rest.match(/^([0-9a-f-]{36})\/item-images\/(.+)$/);
    expect(m, `upload path "${rest}" must be <companyId>/item-images/<file>`).not.toBeNull();
    s.companyId = m![1]!;
    s.imagePath = rest;
    saveState(s);
    expect(resp?.status(), 'storage upload status').toBe(200);
    return `POST …/object/qc-docs/${rest} → ${resp?.status()}`;
  });

  await check(s, 'S1-05', 'GET /item-images/url returns 200 {url, expiresIn}', s.itemCode, async () => {
    const resp = await urlRespP;
    expect(resp.status()).toBe(200);
    const j = (await resp.json()) as { url?: string; expiresIn?: number };
    expect(typeof j.url).toBe('string');
    expect(j.url!).toMatch(/^https:\/\//);
    expect(typeof j.expiresIn).toBe('number');
    s.signedUrl = j.url!;
    saveState(s);
    return `200 {url: ${j.url!.slice(0, 60)}…, expiresIn: ${j.expiresIn}}`;
  });

  await check(s, 'S1-06', 'A 96 px preview appears in the form', s.itemCode, async () => {
    const img = page.locator(`${BOX_IMG} img`).first();
    await expect(img).toBeVisible({ timeout: 30_000 });
    // "visible" is not "painted": wait until the bytes have arrived so the
    // screenshot shows the picture, not the grey box behind it.
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0), { timeout: 30_000 }).toBe(true);
    const b = await box(page, BOX_IMG);
    expect(within(b.w, 96) && within(b.h, 96), `preview box ${b.w}×${b.h}`).toBe(true);
    await expect(page.getByRole('button', { name: /Change image/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Remove$/ })).toBeVisible();
    await snap(page, '03-item-form-preview-after-upload');
    return `preview box ${b.w}×${b.h}; "Change image" + "Remove" shown`;
  });

  await check(s, 'S1-07', 'Served image ≤ 800 px on its longest edge', s.itemCode, async () => {
    const r = await page.request.get(s.signedUrl!);
    expect(r.status(), 'signed URL fetch').toBe(200);
    const buf = Buffer.from(await r.body());
    const d = imageDims(buf);
    const natural = await page.evaluate(
      (u) =>
        new Promise<{ w: number; h: number }>((res, rej) => {
          const im = new Image();
          im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
          im.onerror = () => rej(new Error('img failed to load'));
          im.src = u;
        }),
      s.signedUrl!,
    );
    s.servedDims = `${d.w}×${d.h} ${d.type}, ${buf.length} B (img.naturalWidth ${natural.w}×${natural.h})`;
    saveState(s);
    expect(Math.max(d.w, d.h), `longest edge of served image (${d.w}×${d.h})`).toBeLessThanOrEqual(800);
    expect(natural.w).toBe(d.w);
    expect(natural.h).toBe(d.h);
    return `uploaded 1200×900 PNG → served ${s.servedDims}`;
  });

  await check(s, 'S1-08', 'Save item with image; reload edit page → preview persists', s.itemCode, async () => {
    await page.getByRole('button', { name: /^Save$/ }).click();
    await expect(page).toHaveURL(new RegExp(`/items/${s.itemId}$`), { timeout: 30_000 });
    await gotoApp(page, `/items/${s.itemId}/edit`);
    await expect(page.locator(`${BOX_IMG} img`).first()).toBeVisible({ timeout: 30_000 });
    const src = await page.locator(`${BOX_IMG} img`).first().getAttribute('src');
    expect(src).toMatch(/^https:\/\//);
    const b = await box(page, BOX_IMG);
    expect(within(b.w, 96) && within(b.h, 96)).toBe(true);
    await snap(page, '04-item-form-edit-reloaded');
    return `after reload: 96 px preview (${b.w}×${b.h}) with img src ${src!.slice(0, 50)}…`;
  }, { headerStatus: 'image saved' });
});

test('S2 Item Master list: 40 px picture box, code link, sheet header (no sort toggles), no Drw', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.itemId, 'S1 did not create the item');

  await gotoApp(page, `/items?search=${encodeURIComponent(s.itemCode)}`, 3500);
  const row = page.locator('table tbody tr').filter({ hasText: s.itemCode }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });

  await check(s, 'S2-01', 'List row shows 40×40 box titled "Product image" with the signed image', s.itemCode, async () => {
    const b = row.locator(BOX_IMG).first();
    await expect(b).toBeVisible();
    const img = b.locator('img');
    await expect(img).toBeVisible({ timeout: 30_000 });
    const src = (await img.getAttribute('src')) ?? '';
    expect(src).toMatch(/^https:\/\/.+\/storage\/v1\/object\/sign\//);
    expect(decodeURIComponent(src)).toContain(s.imagePath!);
    const bb = await b.boundingBox();
    expect(within(bb!.width, 40) && within(bb!.height, 40), `box ${bb!.width}×${bb!.height}`).toBe(true);
    await snap(page, '05-items-list-row-with-picture');
    return `box ${bb!.width}×${bb!.height}; img src is a signed storage URL for ${s.imagePath}`;
  });

  await check(s, 'S2-02', 'Item code in the row is a link to the item', s.itemCode, async () => {
    const link = row.locator(`a[href*="/items/${s.itemId}"]`).filter({ hasText: s.itemCode }).first();
    await expect(link).toBeVisible();
    await expect(row.getByText('E2E_ Image test lever')).toBeVisible();
    return `<a href="/items/${s.itemId}">${s.itemCode}</a> + name under it`;
  });

  await check(s, 'S2-03', 'Header: "Item Code · Name" column, no "Drawing No." / "Drw" (sort toggles retired 2026-09-21: masters are the ruled sheet, no per-column sort)', '/items', async () => {
    const head = page.locator('table thead').first();
    const headText = await head.innerText();
    expect(headText).toMatch(/Item Code/);
    expect(headText).toMatch(/Name/);
    expect(headText).not.toMatch(/Drawing No/i);
    expect(headText).not.toMatch(/\bDrw\b/);
    // No sort toggles any more: the sheet header carries plain column names.
    expect(await head.locator('[role="button"]').count()).toBe(0);
    return `header "${headText.replace(/\s+/g, ' ').trim().slice(0, 120)}" — plain sheet header, no sort toggles`;
  });

  await check(s, 'S2-04', 'An item WITHOUT an image shows a 40×40 box with the package icon', '/items', async () => {
    await gotoApp(page, '/items', 3500);
    const none = page.locator(`table tbody tr ${BOX_NONE}`).first();
    await expect(none).toBeVisible({ timeout: 30_000 });
    await expect(none.locator('svg')).toBeVisible();
    expect(await none.locator('img').count()).toBe(0);
    const bb = await none.boundingBox();
    expect(within(bb!.width, 40) && within(bb!.height, 40), `box ${bb!.width}×${bb!.height}`).toBe(true);
    const rowText = (await none.locator('xpath=ancestor::tr[1]').innerText()).replace(/\s+/g, ' ').slice(0, 60);
    return `"${rowText}" → box ${bb!.width}×${bb!.height}, svg icon, no <img>`;
  });
});

test('S3 Item detail: 96 px box, preview modal, no Revision / Drawing no.', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.itemId, 'S1 did not create the item');

  await gotoApp(page, `/items/${s.itemId}`, 3000);
  await expect(page.locator('.panel-hdr').first()).toBeVisible({ timeout: 30_000 });

  await check(s, 'S3-01', 'Header shows a 96×96 image box with the picture', s.itemCode, async () => {
    const b = page.locator(`.panel-hdr ${BOX_IMG}`).first();
    await expect(b).toBeVisible();
    await expect(b.locator('img')).toBeVisible({ timeout: 30_000 });
    const bb = await b.boundingBox();
    expect(within(bb!.width, 96) && within(bb!.height, 96), `box ${bb!.width}×${bb!.height}`).toBe(true);
    await snap(page, '06-item-detail-header');
    return `header box ${bb!.width}×${bb!.height}`;
  });

  await check(s, 'S3-02', 'Clicking the picture opens the preview modal with the image', s.itemCode, async () => {
    await page.locator(`.panel-hdr ${BOX_IMG}`).first().click();
    const modal = page.locator('.overlay .modal').first();
    await expect(modal).toBeVisible({ timeout: 15_000 });
    const img = modal.locator('img').first();
    await expect(img).toBeVisible({ timeout: 30_000 });
    const nat = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
    expect(nat).toBeGreaterThan(0);
    await expect(page).toHaveURL(new RegExp(`/items/${s.itemId}$`));
    await snap(page, '07-item-detail-preview-modal');
    await page.keyboard.press('Escape');
    if (await modal.isVisible().catch(() => false)) await modal.locator('button').filter({ has: page.locator('svg') }).first().click().catch(() => {});
    return `modal opened; image naturalWidth ${nat}; URL unchanged`;
  });

  await check(s, 'S3-03', 'No "Revision" / "Drawing no." labels on the item page', s.itemCode, async () => {
    const txt = await page.locator('.panel').first().innerText();
    expect(txt).not.toMatch(/Revision/i);
    expect(txt).not.toMatch(/Drawing no/i);
    return 'item page text has neither "Revision" nor "Drawing no."';
  });
});

test('S4 SO line: Drawing No. typed, kept on re-pick, on detail, cleared on edit', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.itemId, 'S1 did not create the item');

  await gotoApp(page, '/sales-orders/new', 3000);
  const soNoInput = page.locator('input[value^="IN-SO-"]').first();
  await expect(soNoInput).toBeVisible({ timeout: 30_000 });
  s.soCode = await soNoInput.inputValue();
  saveState(s);

  // Client: any existing one — first option for "a".
  const clientInput = page.getByPlaceholder(/Type client code or name/i).first();
  await clientInput.click();
  await clientInput.fill('a');
  await page.waitForTimeout(1500);
  const firstClient = page.locator('[role="option"]').first();
  await expect(firstClient).toBeVisible({ timeout: 15_000 });
  const clientText = (await firstClient.innerText()).trim();
  await firstClient.click();
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Client PO reference/i).fill(`E2E_IMG-${s.ts}`);

  const lineItem = page.getByPlaceholder(/Search item code or name/i).first();
  await pickOption(page, lineItem, s.itemCode, new RegExp(s.itemCode));

  const drg = page.getByPlaceholder('Drawing No.').first();

  await check(s, 'S4-01', 'Drawing No. line input is enabled and not read-only', s.soCode, async () => {
    await expect(drg).toBeVisible();
    await expect(drg).toBeEnabled();
    expect(await drg.getAttribute('readonly')).toBeNull();
    expect(await drg.evaluate((el) => (el as HTMLInputElement).readOnly)).toBe(false);
    await drg.fill(s.drawingNo);
    await expect(drg).toHaveValue(s.drawingNo);
    return `typed "${s.drawingNo}" into an enabled, editable input`;
  });

  await check(s, 'S4-02', 'Drawing No. KEEPS its value after re-selecting the item', s.soCode, async () => {
    // Pick a different item first (if any other exists), then ours again.
    // NEVER press Escape on this form — the exit guard turns it into an
    // "Are you sure you want to exit?" dialog that blocks every later click.
    await lineItem.click();
    await lineItem.fill('LEVER');
    const others = page.locator('[role="option"]').filter({ hasNotText: s.itemCode });
    let swapped = 'none available';
    if (await others.first().isVisible({ timeout: 20_000 }).catch(() => false)) {
      swapped = (await others.first().innerText()).trim().slice(0, 40);
      await others.first().click();
      await page.waitForTimeout(500);
      await expect(drg, 'after switching to another item').toHaveValue(s.drawingNo);
    }
    await pickOption(page, lineItem, s.itemCode, new RegExp(s.itemCode));
    await expect(drg, 'after re-picking the E2E item').toHaveValue(s.drawingNo);
    await expect(page.getByPlaceholder('Search item code or name').first()).toHaveValue(new RegExp(s.itemCode));
    return `switched to "${swapped}" then back to ${s.itemCode}: Drawing No. still "${s.drawingNo}"`;
  });

  await check(s, 'S4-03', 'Create the SO (1 line, qty 1, Rev A)', s.soCode, async () => {
    await page.getByPlaceholder('Rev', { exact: true }).first().fill('A');
    await page.getByPlaceholder('Qty', { exact: true }).first().fill('1');
    await page.waitForTimeout(400);
    await snap(page, '08-so-form-line-drawing-no');
    await page.getByRole('button', { name: /Save SO/i }).click();
    await expect(page).toHaveURL(/sales-orders\/[0-9a-f-]{36}/, { timeout: 30_000 });
    s.soId = page.url().match(/sales-orders\/([0-9a-f-]{36})/)![1]!;
    saveState(s);
    return `client "${clientText.slice(0, 40)}", PO ref E2E_IMG-${s.ts} → /sales-orders/${s.soId}`;
  }, { qty: '1', headerStatus: 'created' });

  await check(s, 'S4-04', 'SO detail line: 40 px picture + CODE/A + name; Drawing No. cell shows the typed value', s.soCode, async () => {
    await page.waitForTimeout(2000);
    const row = page.locator('table tbody tr').filter({ hasText: s.itemCode }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    const b = row.locator(BOX_IMG).first();
    await expect(b).toBeVisible();
    await expect(b.locator('img')).toBeVisible({ timeout: 30_000 });
    const bb = await b.boundingBox();
    expect(within(bb!.width, 40) && within(bb!.height, 40), `box ${bb!.width}×${bb!.height}`).toBe(true);
    await expect(row.getByText(`${s.itemCode}/A`, { exact: true })).toBeVisible();
    await expect(row.getByText('E2E_ Image test lever')).toBeVisible();
    await expect(row.getByText(s.drawingNo, { exact: true })).toBeVisible();
    await snap(page, '09-so-detail-line');
    return `box ${bb!.width}×${bb!.height}; "${s.itemCode}/A"; name; Drawing No. "${s.drawingNo}"`;
  }, { qty: '1' });

  await check(s, 'S4-05', 'Edit SO → blank Drawing No. → save → reload: it is blank', s.soCode, async () => {
    await gotoApp(page, `/sales-orders/${s.soId}/edit`, 3000);
    const edrg = page.getByPlaceholder('Drawing No.').first();
    await expect(edrg).toHaveValue(s.drawingNo, { timeout: 30_000 });
    await edrg.fill('');
    await expect(edrg).toHaveValue('');
    await page.getByRole('button', { name: /Save SO/i }).click();
    await expect(page).toHaveURL(new RegExp(`sales-orders/${s.soId}$`), { timeout: 30_000 });
    await gotoApp(page, `/sales-orders/${s.soId}`, 3000);
    const row = page.locator('table tbody tr').filter({ hasText: s.itemCode }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });
    const txt = await row.innerText();
    expect(txt).not.toContain(s.drawingNo);
    expect(txt).toMatch(/—/);
    await snap(page, '10-so-detail-line-drawing-no-cleared');
    return `after clearing on edit the line shows no "${s.drawingNo}" (cell reads "—")`;
  }, { qty: '1', headerStatus: 'edited' });
});

test('S4b SO edit: Drawing No. survives switching the item away and back (not saved)', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.soId, 'S4 did not create the SO');

  await gotoApp(page, `/sales-orders/${s.soId}/edit`, 3000);
  const drg = page.getByPlaceholder('Drawing No.').first();
  await expect(drg).toBeVisible({ timeout: 30_000 });
  const lineItem = page.getByPlaceholder(/Search item code or name/i).first();

  await check(s, 'S4-06', 'Edit page: typed Drawing No. kept after switching to ANOTHER item and back', s.soCode!, async () => {
    const probe = `${s.drawingNo}-B`;
    await drg.fill(probe);
    await expect(drg).toHaveValue(probe);
    await lineItem.click();
    await lineItem.fill('5541');
    const other = page.locator('[role="option"]').filter({ hasNotText: s.itemCode }).first();
    await expect(other, 'another item to switch to').toBeVisible({ timeout: 30_000 });
    const otherText = (await other.innerText()).trim().slice(0, 40);
    await other.click();
    await page.waitForTimeout(600);
    await expect(lineItem).not.toHaveValue(new RegExp(s.itemCode));
    await expect(drg, `after switching to "${otherText}"`).toHaveValue(probe);
    await snap(page, '08b-so-edit-switched-item-drawing-no-kept');
    await pickOption(page, lineItem, s.itemCode, new RegExp(s.itemCode));
    await expect(drg, 'after switching back').toHaveValue(probe);
    // Leave WITHOUT saving: Cancel → "Are you sure you want to exit?" → Exit.
    await page.getByRole('button', { name: /^Cancel$/ }).first().click();
    const dlg = page.getByRole('alertdialog');
    if (await dlg.isVisible({ timeout: 3000 }).catch(() => false)) await dlg.getByRole('button', { name: /^Exit$/ }).click();
    await expect(page).not.toHaveURL(/\/edit$/, { timeout: 20_000 });
    return `"${probe}" kept across ${s.itemCode} → "${otherText}" → ${s.itemCode}; form abandoned via Cancel → Exit (nothing saved)`;
  });
});

test('S5 JC list: 40 px (list) / 56 px (card) box, picture click ≠ row click, no drawing-file calls', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.soCode, 'S4 did not create the SO');

  // Raise a JC for the E2E item through the app's own screens (ADR-170):
  // Route Card for the item → Plan on the SO line → Production Order → JC.
  // If any screen refuses, the step is recorded as skipped and the JC checks
  // do not run — nothing is faked.
  if (!s.jcCode) {
    try {
      await raiseJcViaRouteCard(page, s);
      record(s, { id: 'S5-00', action: 'Route Card → Plan → Production Order → Job Card raised', document: `${s.rcCode} · ${s.pln} · ${s.proCode} → ${s.jcCode}`, qty: '1', headerStatus: 'created', overall: `for ${s.soCode} line 1 (${s.itemCode}), op "E2E_ TURNING"`, result: 'PASS' });
    } catch (e) {
      const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e);
      await snap(page, '11-raise-jc-failed');
      record(s, { id: 'S5-00', action: 'Route Card → Plan → Production Order → Job Card raised', document: s.soCode!, qty: '1', headerStatus: '—', overall: `could not raise a JC: ${msg.slice(0, 180)}`, result: 'SKIP' });
      finding(s, `JC list (step 5) not exercised: raising a Job Card for ${s.soCode} through Route Card → Plan → Production Order failed — ${msg.slice(0, 160)}`);
      test.skip(true, 'no JC could be raised');
    }
  }

  // Fresh load of the JC list with a network trace.
  const imageUrlReqs: string[] = [];
  const drawingReqs: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (u.includes('/drawing-files/url')) drawingReqs.push(u);
    if (u.includes('/item-images/url')) imageUrlReqs.push(u);
  });
  await gotoApp(page, `/job-cards?search=${encodeURIComponent(s.jcCode!)}`, 4000);
  const listBtn = page.getByRole('button', { name: 'List View' });
  if ((await listBtn.getAttribute('aria-pressed')) !== 'true') {
    await listBtn.click();
    await page.waitForTimeout(1500);
  }
  const row = page.locator('table tbody tr').filter({ hasText: s.jcCode! }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  s.jcId = (await row.locator(`a[href*="/job-cards/"]`).first().getAttribute('href'))?.match(/job-cards\/([0-9a-f-]{36})/)?.[1];
  saveState(s);

  await check(s, 'S5-01', 'List view row shows the 40×40 picture box with the image', s.jcCode!, async () => {
    const b = row.locator(BOX_IMG).first();
    await expect(b).toBeVisible();
    await expect(b.locator('img')).toBeVisible({ timeout: 30_000 });
    const bb = await b.boundingBox();
    expect(within(bb!.width, 40) && within(bb!.height, 40), `box ${bb!.width}×${bb!.height}`).toBe(true);
    await expect(row.getByText(`${s.itemCode}/A`, { exact: true })).toBeVisible();
    await snap(page, '12-jc-list-row');
    return `box ${bb!.width}×${bb!.height}; "${s.itemCode}/A"`;
  });

  await check(s, 'S5-02', 'Clicking the picture opens the preview WITHOUT navigating', s.jcCode!, async () => {
    await row.locator(BOX_IMG).first().click();
    const modal = page.locator('.overlay .modal').first();
    await expect(modal).toBeVisible({ timeout: 15_000 });
    await expect(modal.locator('img').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);
    expect(page.url(), 'URL must still be the list').toMatch(/\/job-cards(\?|$)/);
    expect(page.url()).not.toMatch(/\/job-cards\/[0-9a-f-]{36}/);
    await snap(page, '13-jc-list-preview-modal');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (await modal.isVisible().catch(() => false)) {
      await modal.locator('.modal-hdr button').last().click().catch(() => {});
    }
    await expect(modal).toBeHidden({ timeout: 10_000 });
    return `modal opened, URL stayed ${page.url().replace(/^https?:\/\/[^/]+/, '')}`;
  });

  await check(s, 'S5-03', 'Clicking elsewhere on the row navigates to the JC', s.jcCode!, async () => {
    // click the row number / first cell — not the code link, not the picture
    await row.locator('td').first().click();
    await expect(page).toHaveURL(/\/job-cards\/[0-9a-f-]{36}/, { timeout: 20_000 });
    return `row click → ${page.url().replace(/^https?:\/\/[^/]+/, '')}`;
  });

  await check(s, 'S5-04', 'Card view shows the 56×56 picture box', s.jcCode!, async () => {
    await gotoApp(page, `/job-cards?search=${encodeURIComponent(s.jcCode!)}`, 3000);
    await page.getByRole('button', { name: 'Card View' }).click();
    await page.waitForTimeout(2000);
    const card = page.locator('.panel').filter({ hasText: s.jcCode! }).first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    const b = card.locator(BOX_IMG).first();
    await expect(b).toBeVisible();
    await expect(b.locator('img')).toBeVisible({ timeout: 30_000 });
    const bb = await b.boundingBox();
    expect(within(bb!.width, 56) && within(bb!.height, 56), `box ${bb!.width}×${bb!.height}`).toBe(true);
    await snap(page, '14-jc-card-view');
    // picture click in card view must not navigate either
    await b.click();
    await expect(page.locator('.overlay .modal').first()).toBeVisible({ timeout: 15_000 });
    expect(page.url()).not.toMatch(/\/job-cards\/[0-9a-f-]{36}/);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    // put the list back to List View for the next reader
    await page.getByRole('button', { name: 'List View' }).click().catch(() => {});
    return `card box ${bb!.width}×${bb!.height}; picture click opened preview, URL unchanged`;
  });

  await check(s, 'S5-05', 'No /drawing-files/url from the JC list; /item-images/url ≤ 1 per distinct image', '/job-cards', async () => {
    // Fresh, unfiltered load: many rows, possibly the same image more than once.
    imageUrlReqs.length = 0;
    drawingReqs.length = 0;
    await gotoApp(page, '/job-cards', 5000);
    await expect(page.locator('table tbody tr, .panel').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);
    const distinct = new Set(imageUrlReqs.map((u) => new URL(u).searchParams.get('path')));
    expect(drawingReqs, 'drawing-files requests').toHaveLength(0);
    expect(imageUrlReqs.length, `item-images/url calls ${imageUrlReqs.length} vs distinct paths ${distinct.size}`).toBeLessThanOrEqual(distinct.size);
    const withImage = await page.locator(`${BOX_IMG}`).count();
    return `${imageUrlReqs.length} /item-images/url call(s) for ${distinct.size} distinct image path(s), ${withImage} row(s) with a picture; 0 /drawing-files/url calls`;
  });
});

test('S6 security: other company → 404, own → 200, no token → 401', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  test.skip(!s.imagePath, 'S1 did not upload an image');
  if (!s.bearer) {
    await gotoApp(page, `/items/${s.itemId}`, 3000);
    await page.waitForTimeout(1500);
  }
  expect(s.bearer, 'captured a bearer from the app').toBeTruthy();
  const ctx = await pwRequest.newContext();
  const otherPath = '00000000-0000-0000-0000-000000000000/item-images/x.png';

  await check(s, 'S6-01', 'GET /item-images/url with another company-looking path → 404', otherPath, async () => {
    const r = await ctx.get(`${API}/item-images/url?path=${encodeURIComponent(otherPath)}`, { headers: { authorization: s.bearer! } });
    const body = await r.text();
    expect(r.status(), body.slice(0, 120)).toBe(404);
    return `404 — ${body.slice(0, 100)}`;
  });

  await check(s, 'S6-02', 'GET /item-images/url with the new image path → 200', s.imagePath!, async () => {
    const r = await ctx.get(`${API}/item-images/url?path=${encodeURIComponent(s.imagePath!)}`, { headers: { authorization: s.bearer! } });
    const body = await r.text();
    expect(r.status(), body.slice(0, 120)).toBe(200);
    const j = JSON.parse(body) as { url: string; expiresIn: number };
    expect(j.url).toMatch(/^https:\/\//);
    return `200 {url…, expiresIn ${j.expiresIn}}`;
  });

  await check(s, 'S6-03', 'GET /item-images/url without a token → 401', s.imagePath!, async () => {
    const r = await ctx.get(`${API}/item-images/url?path=${encodeURIComponent(s.imagePath!)}`);
    const body = await r.text();
    expect(r.status(), body.slice(0, 120)).toBe(401);
    return `401 — ${body.slice(0, 100)}`;
  });
  await ctx.dispose();
});

test('S7 layout at 1280×800: no horizontal scroll, every badge exactly 40×40', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);
  await page.setViewportSize({ width: 1280, height: 800 });

  for (const [id, path] of [
    ['S7-01', '/items'],
    ['S7-02', '/job-cards'],
  ] as const) {
    await check(s, id, `${path} at 1280×800: no horizontal page scrollbar; all row badges 40×40`, path, async () => {
      await gotoApp(page, path, 4000);
      if (path === '/job-cards') {
        const listBtn = page.getByRole('button', { name: 'List View' });
        if ((await listBtn.getAttribute('aria-pressed')) !== 'true') {
          await listBtn.click();
          await page.waitForTimeout(1500);
        }
      }
      await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(1500);
      const sw = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, bodyScroll: document.body.scrollWidth }));
      expect(sw.scroll, `documentElement.scrollWidth ${sw.scroll} > clientWidth ${sw.client}`).toBeLessThanOrEqual(sw.client);
      expect(sw.bodyScroll, `body.scrollWidth ${sw.bodyScroll} > clientWidth ${sw.client}`).toBeLessThanOrEqual(sw.client);
      const boxes = page.locator(`table tbody tr :is(${BOX_IMG}, ${BOX_NONE})`);
      const n = await boxes.count();
      expect(n, 'row badges').toBeGreaterThan(0);
      const sizes = await boxes.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width * 100) / 100, Math.round(r.height * 100) / 100]; }));
      const bad = sizes.filter(([w, h]) => Math.abs(w! - 40) > 1 || Math.abs(h! - 40) > 1);
      expect(bad, `badges not 40×40: ${JSON.stringify(bad.slice(0, 5))}`).toHaveLength(0);
      const uniq = Array.from(new Set(sizes.map(([w, h]) => `${w}×${h}`)));
      await snap(page, `15-layout-1280${path.replace('/', '-')}`);
      return `scrollWidth ${sw.scroll} ≤ clientWidth ${sw.client}; ${n} badges, sizes ${uniq.join(', ')}`;
    });
  }
});

test('S8 cleanup: UI Delete of the SO (if no JC hangs off it) and the item', async ({ page }) => {
  const s = readState();
  watchBearer(page, s);

  if (s.soId) {
    if (s.jcCode) {
      record(s, { id: 'S8-01', action: 'Delete SO', document: s.soCode!, qty: '1', headerStatus: 'left in place', overall: `NOT deleted on purpose — Job Card ${s.jcCode} was raised from it; a JC pointing at a deleted SO is a state the app cannot reach by itself`, result: 'N/A' });
      finding(s, `Left in the test DB: ${s.soCode} (client PO ref E2E_IMG-${s.ts}), route card ${s.rcCode ?? '?'}, plan ${s.pln ?? '?'}, production order ${s.proCode ?? '?'}, Job Card ${s.jcCode} (op "E2E_ TURNING"). Undo in the app: close/cancel the Production Order and Job Card, then Delete the SO from its detail page.`);
    } else {
      await gotoApp(page, `/sales-orders/${s.soId}`, 3000);
      const del = page.getByRole('button', { name: /^Delete$/ }).first();
      if (!(await del.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false))) {
        record(s, { id: 'S8-01', action: 'Delete SO from its detail page', document: s.soCode!, qty: '1', headerStatus: 'left in place', overall: 'no Delete button on the SO page for the e2e login (SO delete needs edit + approve on so_create) — left in place', result: 'N/A' });
        finding(s, `Left in the test DB: ${s.soCode} (client PO ref E2E_IMG-${s.ts}) — the e2e login has no Delete on Sales Orders. Delete it from its detail page with an approver login.`);
      } else await check(s, 'S8-01', 'Delete SO from its detail page (Delete → Confirm)', s.soCode!, async () => {
        await del.click();
        await page.getByRole('button', { name: /Confirm/ }).click();
        await expect(page).toHaveURL(/\/sales-orders(\?|$)/, { timeout: 30_000 });
        return 'soft-deleted via the SO page';
      }, { qty: '1', headerStatus: 'deleted' });
    }
  }

  if (s.itemId) {
    await check(s, 'S8-02', 'Delete the E2E item from its detail page (Delete → Confirm)', s.itemCode, async () => {
      await gotoApp(page, `/items/${s.itemId}`, 3000);
      const del = page.getByRole('button', { name: /^Delete$/ }).first();
      if (!(await del.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false))) throw new Error('no Delete button on the item page for this login');
      await del.click();
      await page.getByRole('button', { name: /Confirm/ }).click();
      await page.waitForTimeout(3000);
      const err = page.locator('.form-error, [role="alert"]').first();
      if (await err.isVisible().catch(() => false)) throw new Error(`app refused: ${(await err.innerText()).slice(0, 160)}`);
      await expect(page).toHaveURL(/\/items(\?|$)/, { timeout: 30_000 });
      await gotoApp(page, `/items?search=${encodeURIComponent(s.itemCode)}`, 3000);
      await expect(page.locator('table tbody tr').filter({ hasText: s.itemCode })).toHaveCount(0, { timeout: 20_000 });
      return 'soft-deleted via the item page; no longer in the Item Master list';
    }, { headerStatus: 'deleted' });
  }
});

// ═════════════════════════════════════════════════════════════════════════════

function esc(x: string): string {
  return x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

test('ZZ render the six-column PDF + JSON', async ({ page }) => {
  const s = readState();
  const order = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'];
  const rows = [...s.rows].sort((a, b) => order.indexOf(a.id.slice(0, 2)) - order.indexOf(b.id.slice(0, 2)) || a.id.localeCompare(b.id));
  const pass = rows.filter((r) => r.result === 'PASS').length;
  const fail = rows.filter((r) => r.result === 'FAIL').length;
  const na = rows.filter((r) => r.result === 'N/A' || r.result === 'SKIP').length;
  const TITLES: Record<string, string> = {
    S1: 'Item form + upload',
    S2: 'Item Master list',
    S3: 'Item detail',
    S4: 'Sales Order line — Drawing No.',
    S5: 'Job Card list',
    S6: 'Security — /item-images/url',
    S7: 'Layout at 1280×800',
    S8: 'Cleanup',
  };
  const notRun = order.filter((g) => !rows.some((r) => r.id.startsWith(g)));
  for (const g of notRun) finding(s, `${TITLES[g]} (${g}) has no recorded rows — that step did not run or crashed before its first check.`);
  const findings = [
    `Documents touched: item ${s.itemCode}${s.itemId ? ` (${s.itemId})` : ''}; SO ${s.soCode ?? '— (not created)'}; JC ${s.jcCode ?? '— (not raised)'}.`,
    `Uploaded a 1200×900 PNG; served ${s.servedDims ?? '(not measured)'}. Storage path: ${s.imagePath ?? '—'}.`,
    ...s.findings,
    'Not exercised: printing of any document; the JWSO line (only the SO line was tested); the Remove-image button; WebP/JPEG source files (a generated PNG was used); the mock-up look itself (measured sizes only — eyeball the screenshots for the look).',
  ];
  const body = rows
    .map((r, i) => {
      const cls = r.result === 'PASS' ? 'pass' : r.result === 'FAIL' ? 'fail' : 'na';
      const sym = r.result === 'PASS' ? '✓' : r.result === 'FAIL' ? '✗' : '—';
      const grp = i === 0 || rows[i - 1]!.id.slice(0, 2) !== r.id.slice(0, 2) ? `<tr class="grp"><td colspan="6">${esc(TITLES[r.id.slice(0, 2)] ?? r.id)}</td></tr>` : '';
      return `${grp}<tr class="${i % 2 ? 'even' : 'odd'}"><td>${esc(r.action)} <span class="id">${esc(r.id)}</span></td><td class="mono">${esc(r.document)}</td><td class="qty">${esc(r.qty)}</td><td>${esc(r.headerStatus)}</td><td>${esc(r.overall)}</td><td class="res ${cls}">${sym} ${esc(r.result === 'SKIP' ? 'N/A' : r.result)}</td></tr>`;
    })
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4 landscape; margin: 12mm 10mm 14mm 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #111; }
    h1 { font-size: 15pt; margin: 0 0 3px; }
    .meta { font-size: 9pt; color: #444; margin-bottom: 8px; line-height: 1.45; }
    .meta b { color: #111; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #bbb; padding: 4px 5px; vertical-align: top; word-wrap: break-word; font-size: 9pt; line-height: 1.3; }
    th { background: #e5e7eb; text-align: left; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    tr.even td { background: #f5f7fa; }
    tr.grp td { background: #dbeafe; font-weight: bold; font-size: 10pt; padding: 6px 5px; }
    .id { color: #9ca3af; font-size: 7.5pt; margin-left: 4px; }
    td.mono { font-family: Consolas, 'Courier New', monospace; font-weight: bold; font-size: 8.5pt; }
    td.qty { text-align: center; }
    td.res { font-weight: bold; text-align: center; white-space: nowrap; }
    td.res.pass { color: #15803d; background: #dcfce7 !important; }
    td.res.fail { color: #b91c1c; background: #fee2e2 !important; }
    td.res.na { color: #6b7280; background: #f3f4f6 !important; }
    h2 { font-size: 11pt; margin: 12px 0 4px; }
    ul { margin: 0; padding-left: 18px; font-size: 9pt; }
    li { margin-bottom: 3px; line-height: 1.35; }
  </style></head><body>
  <h1>Innovic ERP — Item product image + SO-line Drawing No. verification (test stack)</h1>
  <div class="meta"><b>Date:</b> 2026-09-21 · <b>Site:</b> https://innovic-erp.pages.dev (API ${esc(API)}) · <b>Spec:</b> apps/web/e2e/flow-item-image.spec.ts · <b>Generated:</b> ${esc(new Date().toISOString().replace('T', ' ').slice(0, 16))} UTC<br>
  <b>Result:</b> ${pass} pass · ${fail} fail · ${na} n/a — ${rows.length} checks. Every value is what was on screen (or returned by the API) at that moment.</div>
  <table><colgroup><col style="width:24%"><col style="width:16%"><col style="width:4%"><col style="width:10%"><col style="width:37%"><col style="width:9%"></colgroup>
  <thead><tr><th>Action</th><th>Document</th><th>Qty</th><th>Header Status</th><th>Overall Status</th><th>Result</th></tr></thead>
  <tbody>${body || '<tr><td colspan="6">no rows recorded</td></tr>'}</tbody></table>
  <h2>Findings</h2>
  <ul>${findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  </body></html>`;
  await page.setContent(html, { waitUntil: 'load' });
  mkdirSync(REPORTS, { recursive: true });
  await page.pdf({
    path: PDF_FILE,
    format: 'A4',
    landscape: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;font-size:8px;color:#6b7280;padding:0 10mm;display:flex;justify-content:space-between;"><span>Innovic ERP — item image verification · test stack · 2026-09-21</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
  });
  writeFileSync(JSON_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), site: 'https://innovic-erp.pages.dev', api: API, state: { ...s, bearer: s.bearer ? '<captured, not stored>' : undefined }, rows, findings }, null, 2));
  mkdirSync(`${WEB}/test-results`, { recursive: true });
  copyFileSync(PDF_FILE, `${WEB}/test-results/item-image-verification-2026-09-21.pdf`);
  log(`PDF: ${PDF_FILE} (${rows.length} rows: ${pass} pass, ${fail} fail, ${na} n/a)`);
  log(`JSON: ${JSON_FILE}`);
  expect(existsSync(PDF_FILE)).toBe(true);
});
