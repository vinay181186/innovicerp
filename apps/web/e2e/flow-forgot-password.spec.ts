// Forgot-password chain v2, end to end, against the DEPLOYED TEST stack.
//
//   https://innovic-erp.pages.dev  ->  https://api-test-production-19ca.up.railway.app
//   Supabase project uitsrhyulidubnddzcex (TEST — separate from production)
//
// v2 (2026-09-19): own-domain link `?token_hash=…&type=recovery` verified by the page with
// verifyOtp, 10-minute wording, NO auto-login after the change (global sign-out, green panel on
// /login), POST /auth/password-changed audit row, session kept in a chunked SESSION cookie.
//
// What it proves (one test per step, in file order):
//   1   /login: "Forgot password?" is blue + underlined, no magic-link text, opens the reset form
//   2   POST /auth/forgot-password answers 200 { ok:true, mailer } identically for a real and a
//       made-up address; the "Check your inbox" card says "valid for 10 minutes and works once"
//   3   The own-domain link (token_hash minted here with the service-role key — the TEST API has
//       no mailer so its email cannot be read) shows the form within ~3 s with the validity note,
//       and the query string is cleaned
//   4   Saving a new password does NOT open the dashboard: /login?reset=done|done-nomail, green
//       "Password changed" panel, URL cleaned, no session left, no Sign out button
//   5   NEW password signs in; OLD password is refused; the auth cookie is a Session cookie
//   6   RESTORE the admin password (also in afterAll) and prove it by signing in with it
//   7   The same token_hash link again -> "Reset link problem" + 10-minute wording + "Request a
//       new link" -> /login?mode=reset shows the reset form
//   3b  The OLD `action_link` shape (#access_token) still works
//   8   /auth/reset-password with no params -> "invalid or has expired" after the 8 s wait
//   9   4 quick POSTs with a made-up address -> all 200, identical body (no 429)
//   10  activity_log audit: password_reset_completed row (detail "Password changed from IP …");
//       password_reset_requested row only when the API mailer is resend/smtp
//   11  Browser session: second tab in the same context is signed in; clearCookies -> /login
//   12  API guard: POST /auth/password-changed from an ordinary session -> { ok:true,
//       emailed:false } and NO new audit row
//   Z   Render the six-column PDF + JSON report
//
// Credentials come from erp/.env.local (TEST_*). They are read here and NEVER printed.
// This spec does NOT use the stored auth session — every page starts logged out.
//
// Run from apps/web:
//   npx playwright test --config=playwright.pages.config.ts e2e/flow-forgot-password.spec.ts --reporter=list

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment (TEST stack only — hard stop if the URL is not the TEST project)
// ---------------------------------------------------------------------------
const ENV_FILE = 'C:/Innovic_projects/innovic-erp/erp/.env.local';
const WEB = 'C:/Innovic_projects/innovic-erp/wt-test/apps/web';
const REPORTS_DIR = WEB + '/.playwright/reports';
const REPORT_DATE = '2026-09-19';
const OUT_STEM = 'forgot-password-verification-' + REPORT_DATE + '-v2';
const SHOT_DIR = REPORTS_DIR + '/forgot-password-shots-v2';
const PDF_OUT = REPORTS_DIR + '/' + OUT_STEM + '.pdf';
const JSON_OUT = REPORTS_DIR + '/' + OUT_STEM + '.json';
const WEB_ORIGIN = 'https://innovic-erp.pages.dev';
const TEST_PROJECT_REF = 'uitsrhyulidubnddzcex';
const RESET_MINUTES = 10;
const AUTH_COOKIE_PREFIX = `sb-${TEST_PROJECT_REF}-auth-token`;
// Playwright starts a NEW worker process after any failed test, which would wipe the
// module-level state below. Everything is mirrored to this file after each step and
// reloaded on module init; test 1 (always first) starts the file afresh.
const STATE_FILE = WEB + '/.playwright/forgot-password-v2-state.json';

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const ENV = loadEnvFile(ENV_FILE);
const SUPABASE_URL = ENV.TEST_SUPABASE_URL ?? '';
const ANON_KEY = ENV.TEST_SUPABASE_ANON_KEY ?? '';
const SERVICE_ROLE_KEY = ENV.TEST_SUPABASE_SERVICE_ROLE_KEY ?? '';
const ADMIN_EMAIL = (ENV.TEST_ADMIN_EMAIL ?? '').trim().toLowerCase();
const ADMIN_PASSWORD = ENV.TEST_ADMIN_PASSWORD ?? '';
const API_URL = (ENV.TEST_API_URL ?? 'https://api-test-production-19ca.up.railway.app').replace(/\/$/, '');

if (!SUPABASE_URL.includes(TEST_PROJECT_REF)) {
  throw new Error(
    `STOP: TEST_SUPABASE_URL in erp/.env.local does not point at the TEST project (${TEST_PROJECT_REF}). Refusing to run.`,
  );
}
for (const [k, v] of Object.entries({
  TEST_SUPABASE_ANON_KEY: ANON_KEY,
  TEST_SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
  TEST_ADMIN_EMAIL: ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD: ADMIN_PASSWORD,
})) {
  if (!v) throw new Error(`STOP: ${k} missing in erp/.env.local`);
}

/** Masked for logs/report: local part kept, domain hidden. Never log the raw address. */
const MASKED_EMAIL = ADMIN_EMAIL.slice(0, ADMIN_EMAIL.indexOf('@')) + '@…';

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// ---------------------------------------------------------------------------
// Shared state across steps (file runs in ONE worker, tests in file order)
// ---------------------------------------------------------------------------
const state = {
  mailer: '' as string,
  tokenHashLink: '',
  userId: '',
  newPassword: `E2E-Temp-${Date.now()}!`,
  passwordChanged: false,
  restoredAt: '' as string,
  restoreProven: false,
  step3ok: false,
  step4ok: false,
  step4At: '' as string,
  resetParam: '' as string,
  auditCompletedDetail: '' as string,
  auditRequestedDetails: [] as string[],
};

type Row = {
  step: string;
  action: string;
  document: string;
  qty: string;
  headerStatus: string;
  overallStatus: string;
  result: 'PASS' | 'FAIL' | 'SKIP';
  note?: string;
};
const rows: Row[] = [];
const findings: string[] = [];
const shots: string[] = [];

type Persisted = { state: typeof state; rows: Row[]; shots: string[] };
function persist(): void {
  mkdirSync(REPORTS_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify({ state, rows, shots } satisfies Persisted, null, 2));
}
function resetPersisted(): void {
  rows.length = 0;
  shots.length = 0;
  persist();
}
if (existsSync(STATE_FILE)) {
  try {
    const p = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Persisted;
    Object.assign(state, p.state);
    rows.push(...p.rows);
    shots.push(...p.shots);
  } catch {
    // corrupt/old file: ignore, test 1 rewrites it
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[forgot-password-v2] ${msg}`);
}

function addRow(row: Row): void {
  rows.push(row);
  persist();
  log(`${row.result === 'PASS' ? '✓' : row.result === 'FAIL' ? '✗' : '⏭'} step ${row.step} — ${row.action} — ${row.overallStatus}`);
}

/** Run a step body; record PASS/FAIL row with the error text on failure, then rethrow. */
async function step(
  id: string,
  action: string,
  document: string,
  body: () => Promise<Omit<Row, 'step' | 'action' | 'document' | 'result'>>,
): Promise<void> {
  try {
    const r = await body();
    addRow({ step: id, action, document, result: 'PASS', ...r });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0]! : String(err);
    addRow({
      step: id,
      action,
      document,
      qty: '—',
      headerStatus: '—',
      overallStatus: 'Failed: ' + msg.slice(0, 160),
      result: 'FAIL',
      note: msg,
    });
    throw err;
  }
}

async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(SHOT_DIR, { recursive: true });
  const p = `${SHOT_DIR}/${name}.png`;
  await page.screenshot({ path: p, fullPage: true });
  shots.push(p);
  persist();
  log('screenshot: ' + p);
  return p;
}

async function freshContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({ storageState: undefined });
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Email').fill(email, { timeout: 30_000 });
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function authCookies(ctx: BrowserContext) {
  const all = await ctx.cookies(WEB_ORIGIN);
  return all.filter((c) => c.name.startsWith(AUTH_COOKIE_PREFIX));
}

const LOGIN_FAIL_RE = /don't match|Invalid login credentials/i;

/** Put the admin password back. Idempotent; safe to call twice. */
async function restoreAdminPassword(reason: string): Promise<void> {
  let userId = state.userId;
  if (!userId) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw new Error('restore: listUsers failed: ' + error.message);
    userId = data.users.find((u) => (u.email ?? '').toLowerCase() === ADMIN_EMAIL)?.id ?? '';
    if (!userId) throw new Error('restore: admin user not found by email');
    state.userId = userId;
  }
  const { error } = await admin.auth.admin.updateUserById(userId, { password: ADMIN_PASSWORD });
  if (error) throw new Error('restore: updateUserById failed: ' + error.message);
  state.restoredAt = new Date().toISOString();
  state.passwordChanged = false;
  persist();
  log(`admin password RESTORED (${reason}) at ${state.restoredAt}`);
}

async function ensureUserId(): Promise<string> {
  if (state.userId) return state.userId;
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error('listUsers failed: ' + error.message);
  state.userId = data.users.find((u) => (u.email ?? '').toLowerCase() === ADMIN_EMAIL)?.id ?? '';
  if (!state.userId) throw new Error('admin user not found by email');
  return state.userId;
}

async function ensureOriginalPassword(): Promise<void> {
  if (state.passwordChanged) await restoreAdminPassword('guard before a step that signs in with the original password');
}

/** Read-only SELECT on activity_log for the admin user (service role bypasses RLS). */
async function auditRows(sinceIso: string) {
  const { data, error } = await admin
    .from('activity_log')
    .select('id, ts, action, entity, detail, user_id, ref_id')
    .eq('user_id', state.userId)
    .in('action', ['password_reset_completed', 'password_reset_requested'])
    .gte('ts', sinceIso)
    .order('ts', { ascending: false });
  if (error) throw new Error('activity_log select failed: ' + error.message);
  return (data ?? []) as { id: string; ts: string; action: string; entity: string; detail: string; user_id: string; ref_id: string | null }[];
}

test.afterAll(async () => {
  // Mandatory safety net: the admin password must never be left changed.
  if (state.passwordChanged || !state.restoredAt) {
    try {
      await restoreAdminPassword('afterAll');
    } catch (err) {
      log('afterAll restore FAILED: ' + (err instanceof Error ? err.message : String(err)));
    }
  }
});

// ---------------------------------------------------------------------------
// 1. /login — the link itself
// ---------------------------------------------------------------------------
test('1 - login page: Forgot password? is blue + underlined, no magic-link text, opens reset form', async ({ page }) => {
  resetPersisted();
  await step('1', 'Check Forgot password? link', '—', async () => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Sign in to Innovic ERP' })).toBeVisible({ timeout: 30_000 });

    const link = page.getByRole('button', { name: 'Forgot password?' });
    await expect(link).toBeVisible();

    const style = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      const token = getComputedStyle(document.documentElement).getPropertyValue('--blue').trim();
      const probe = document.createElement('span');
      probe.style.color = token;
      document.body.appendChild(probe);
      const tokenRgb = getComputedStyle(probe).color;
      probe.remove();
      return { color: cs.color, token, tokenRgb, decoration: cs.textDecorationLine || cs.textDecoration };
    });
    log(`Forgot password? color=${style.color} token(--blue)=${style.token} -> ${style.tokenRgb} decoration=${style.decoration}`);
    expect(style.token, '--blue token must be defined').not.toBe('');
    expect(style.color, 'link colour must equal the --blue token').toBe(style.tokenRgb);
    expect(style.decoration, 'link must be underlined').toContain('underline');

    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toContain('Send a magic link instead');
    expect(bodyText).not.toMatch(/magic link/i);
    await expect(page.getByRole('status')).toHaveCount(0);

    await shot(page, '01-login-blue-link');

    await link.click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Back to sign in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await shot(page, '01b-reset-request-form');

    return {
      qty: '—',
      headerStatus: 'Sign in to Innovic ERP',
      overallStatus: `Blue (${style.color}), underlined, no magic-link text; opens "Reset your password"`,
    };
  });
});

// ---------------------------------------------------------------------------
// 2. Request a reset — real address and made-up address answer identically
// ---------------------------------------------------------------------------
test('2 - request reset: 200 { ok, mailer } identical for real and made-up address; 10-minute wording', async ({ page }) => {
  const submitReset = async (email: string) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Forgot password?' }).click({ timeout: 30_000 });
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    const [res] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/auth\/forgot-password$/.test(r.url()),
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: 'Send reset link' }).click(),
    ]);
    const status = res.status();
    const body = (await res.json()) as { ok?: unknown; mailer?: unknown };
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('If an account exists for')).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await expect(page.getByText(`valid for ${RESET_MINUTES} minutes and works once`)).toBeVisible();
    await expect(page.locator('p.text-destructive')).toHaveCount(0);
    return { status, body, apiUrl: res.url() };
  };

  await step('2a', 'Request reset for real address', MASKED_EMAIL, async () => {
    const r = await submitReset(ADMIN_EMAIL);
    log(`POST ${r.apiUrl} -> ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(['supabase', 'resend', 'smtp']).toContain(r.body.mailer);
    state.mailer = String(r.body.mailer);
    log(`mailer observed: ${state.mailer}`);
    await shot(page, '02-check-inbox-card-10min');
    return {
      qty: '1',
      headerStatus: 'Check your inbox',
      overallStatus: `200 { ok:true, mailer:"${state.mailer}" }; card says "valid for ${RESET_MINUTES} minutes and works once"`,
    };
  });

  await step('2b', 'Request reset for made-up address', 'e2e-nobody-…@example.invalid', async () => {
    const fake = `e2e-nobody-${Date.now()}@example.invalid`;
    const r = await submitReset(fake);
    log(`POST (made-up) -> ${r.status} ${JSON.stringify(r.body)}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, mailer: state.mailer });
    return {
      qty: '1',
      headerStatus: 'Check your inbox',
      overallStatus: `Identical: 200 { ok:true, mailer:"${String(r.body.mailer)}" }, same card, no error text`,
    };
  });
});

// ---------------------------------------------------------------------------
// 3–6. Own-domain link -> new password -> /login panel -> sign-ins -> restore
// ---------------------------------------------------------------------------
test('3-6 - token_hash link, password change lands on /login signed out, new/old password, restore', async ({ page }) => {
  const browser = page.context().browser()!;

  await step('3', 'Open own-domain token_hash link', MASKED_EMAIL, async () => {
    // Let the API's detached send from step 2 finish first: a recovery token minted AFTER
    // ours would invalidate ours (Supabase keeps one recovery token per user).
    await page.waitForTimeout(5_000);

    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: ADMIN_EMAIL,
      options: { redirectTo: `${WEB_ORIGIN}/auth/reset-password` },
    });
    if (error) throw new Error('generateLink failed: ' + error.message);
    const hashed = data.properties?.hashed_token ?? '';
    expect(hashed, 'generateLink must return properties.hashed_token').not.toBe('');
    state.userId = data.user?.id ?? '';
    expect(state.userId, 'generateLink must return the user id').not.toBe('');
    state.tokenHashLink = `${WEB_ORIGIN}/auth/reset-password?token_hash=${encodeURIComponent(hashed)}&type=recovery`;
    log('own-domain link built (token not logged); user id captured');

    const t0 = Date.now();
    await page.goto(state.tokenHashLink, { waitUntil: 'domcontentloaded' });
    const landed = Date.now();
    log(`landed after ${landed - t0} ms on ${page.url().replace(/token_hash=[^&]+/, 'token_hash=…')}`);

    const heading = page.getByRole('heading', { name: 'Choose a new password' });
    await expect(heading).toBeVisible({ timeout: 3_000 });
    const shown = Date.now() - landed;
    log(`"Choose a new password" visible ${shown} ms after landing`);
    await expect(page.getByText('Reset link problem')).toHaveCount(0);
    await expect(page.getByText(`Reset links are valid for ${RESET_MINUTES} minutes and work once.`)).toBeVisible();

    await expect
      .poll(() => page.url(), { timeout: 3_000, message: 'query must be cleaned' })
      .toBe(`${WEB_ORIGIN}/auth/reset-password`);
    log(`address bar after form: ${page.url()}`);
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
    await shot(page, '03-choose-new-password-form-note');
    state.step3ok = true;
    return {
      qty: '1',
      headerStatus: 'Choose a new password',
      overallStatus: `Form shown ${shown} ms after landing; validity note visible; query cleaned; Back to sign in present`,
    };
  });

  await step('4', 'Save new password -> /login panel, signed out', MASKED_EMAIL, async () => {
    const visited: string[] = [];
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) visited.push(f.url());
    });
    await page.getByLabel('New password', { exact: true }).fill(state.newPassword);
    await page.getByLabel('Confirm new password', { exact: true }).fill(state.newPassword);
    // A human takes longer than 1 s between opening the link and saving; the API's
    // "changed recently" heuristic needs updated_at >= last_sign_in_at + 1 s.
    await page.waitForTimeout(2_000);
    state.passwordChanged = true; // assume changed from here on — afterAll restores
    persist();
    const [changedRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && /\/auth\/password-changed$/.test(r.url()),
        { timeout: 30_000 },
      ),
      page.getByRole('button', { name: 'Update password' }).click(),
    ]);
    state.step4At = new Date().toISOString();
    const changedBody = (await changedRes.json()) as { ok?: unknown; emailed?: unknown };
    log(`POST /auth/password-changed -> ${changedRes.status()} ${JSON.stringify(changedBody)}`);
    expect(changedRes.status()).toBe(200);
    expect(changedBody.ok).toBe(true);

    await page.waitForURL(/\/login/, { timeout: 20_000 });
    const panel = page.getByRole('status');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    const panelText = (await panel.innerText()).replace(/\s+/g, ' ').trim();
    log(`panel: "${panelText}"`);
    expect(panelText).toContain('Password changed. Sign in with your new password.');
    const withEmailSentence = /confirmation email has been sent/i.test(panelText);
    const panelStyle = await panel.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { border: cs.borderColor, bg: cs.backgroundColor, color: cs.color };
    });
    log(`panel style: ${JSON.stringify(panelStyle)}`);

    const seen = visited.find((u) => /\/login\?reset=(done|done-nomail)\b/.test(u)) ?? '';
    state.resetParam = /reset=(done-nomail|done)/.exec(seen)?.[1] ?? '';
    log(`navigations: ${visited.map((u) => u.replace(WEB_ORIGIN, '')).join(' -> ')}`);
    expect(state.resetParam, 'must pass through /login?reset=done|done-nomail').toMatch(/^done(-nomail)?$/);
    expect(changedBody.emailed).toBe(state.resetParam === 'done');
    expect(withEmailSentence).toBe(state.resetParam === 'done');

    await expect.poll(() => page.url(), { timeout: 5_000, message: 'reset param must be removed' }).toBe(`${WEB_ORIGIN}/login`);
    await shot(page, '04-login-green-panel');

    // Signed out: no auth cookie in this context, no Sign out button, and / bounces to /login.
    const cookies = await authCookies(page.context());
    expect(cookies, 'no sb-*-auth-token cookie may remain').toHaveLength(0);
    const ls = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('sb-')));
    expect(ls, 'no sb-* localStorage session may remain').toHaveLength(0);
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
    state.step4ok = true;
    return {
      qty: '1',
      headerStatus: 'Password changed',
      overallStatus: `/login?reset=${state.resetParam} -> green panel${withEmailSentence ? ' (with email sentence)' : ' (no email sentence)'}; URL cleaned; no session cookie; / bounces to /login`,
    };
  });

  await step('5a', 'Sign in with NEW password; auth cookie is a Session cookie', MASKED_EMAIL, async () => {
    const ctx = await freshContext(browser);
    try {
      const p = await ctx.newPage();
      await signIn(p, ADMIN_EMAIL, state.newPassword);
      await p.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
      await expect(p.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
      await shot(p, '05-dashboard-new-password');
      const before = await authCookies(ctx);
      log(`auth cookies after sign-in: ${before.map((c) => `${c.name} expires=${c.expires} httpOnly=${c.httpOnly} secure=${c.secure} sameSite=${c.sameSite} len=${c.value.length}`).join(' | ')}`);
      const chunk0 = before.find((c) => c.name === `${AUTH_COOKIE_PREFIX}.0`);
      expect(chunk0, `${AUTH_COOKIE_PREFIX}.0 cookie must exist`).toBeTruthy();
      expect(chunk0!.expires, 'must be a Session cookie (no Expires/Max-Age => -1)').toBe(-1);
      expect(chunk0!.secure).toBe(true);
      await p.getByRole('button', { name: 'Sign out' }).click();
      await p.waitForURL(/\/login/, { timeout: 20_000 });
      const after = await authCookies(ctx);
      expect(after, 'sign-out must remove the auth cookie').toHaveLength(0);
      return {
        qty: '1',
        headerStatus: 'Signed in',
        overallStatus: `NEW password accepted -> /; ${AUTH_COOKIE_PREFIX}.0 is a Session cookie (expires=-1, ${before.length} chunk(s)); removed on Sign out`,
      };
    } finally {
      await ctx.close();
    }
  });

  await step('5b', 'Sign in with OLD password (fresh context)', MASKED_EMAIL, async () => {
    const ctx = await freshContext(browser);
    try {
      const p = await ctx.newPage();
      await signIn(p, ADMIN_EMAIL, ADMIN_PASSWORD);
      const err = p.locator('p.text-destructive');
      await expect(err).toBeVisible({ timeout: 20_000 });
      const text = (await err.innerText()).trim();
      log(`old password refused with: "${text}"`);
      expect(text).toMatch(LOGIN_FAIL_RE);
      expect(p.url()).toMatch(/\/login/);
      await shot(p, '05b-old-password-refused');
      return { qty: '1', headerStatus: 'Sign in refused', overallStatus: `"${text.slice(0, 60)}…"` };
    } finally {
      await ctx.close();
    }
  });

  await step('6', 'Restore original admin password, prove sign-in', MASKED_EMAIL, async () => {
    await restoreAdminPassword('step 6');
    const ctx = await freshContext(browser);
    try {
      const p = await ctx.newPage();
      await signIn(p, ADMIN_EMAIL, ADMIN_PASSWORD);
      await p.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
      await expect(p.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
      state.restoreProven = true;
      persist();
      await shot(p, '06-original-password-restored');
      await p.getByRole('button', { name: 'Sign out' }).click();
      await p.waitForURL(/\/login/, { timeout: 20_000 });
      return { qty: '1', headerStatus: 'Signed in', overallStatus: 'ORIGINAL password restored via admin API and sign-in proven' };
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Same token_hash link a second time
// ---------------------------------------------------------------------------
test('7 - reused token_hash link: Reset link problem, 10-minute wording, Request a new link', async ({ page }) => {
  test.skip(!state.step3ok, 'step 3 did not produce a link');
  await step('7', 'Re-open the same token_hash link', MASKED_EMAIL, async () => {
    await page.goto(state.tokenHashLink, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible({ timeout: 10_000 });
    const msg = (await page.locator('main p').first().innerText()).trim();
    log(`message: "${msg}"`);
    expect(msg).toMatch(/expired or was already used/i);
    expect(msg).toContain(`valid for ${RESET_MINUTES} minutes and work once`);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toHaveCount(0);
    await shot(page, '07-link-already-used');

    const btn = page.getByRole('link', { name: 'Request a new link' });
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForURL(/\/login\?mode=reset/, { timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Send reset link' })).toBeVisible();
    await shot(page, '07b-request-new-link-form');
    return { qty: '1', headerStatus: 'Reset link problem', overallStatus: `"${msg.slice(0, 70)}…"; Request a new link -> /login?mode=reset reset form` };
  });
});

// ---------------------------------------------------------------------------
// 3b. The OLD action_link shape (#access_token) must still work
// ---------------------------------------------------------------------------
test('3b - old action_link shape (#access_token) still opens the form', async ({ page }) => {
  await step('3b', 'Open old-shape action_link (#access_token)', MASKED_EMAIL, async () => {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: ADMIN_EMAIL,
      options: { redirectTo: `${WEB_ORIGIN}/auth/reset-password` },
    });
    if (error) throw new Error('generateLink failed: ' + error.message);
    const link = data.properties?.action_link ?? '';
    expect(link).toMatch(/^https:\/\//);
    if (!state.userId) state.userId = data.user?.id ?? '';
    log(`action_link host=${new URL(link).host} path=${new URL(link).pathname} (token not logged)`);

    await page.goto(link, { waitUntil: 'domcontentloaded' });
    const landed = Date.now();
    const landedUrl = page.url();
    log(`landed on ${landedUrl.replace(/#.*$/, '#…')} (hash ${/#access_token/.test(landedUrl) ? 'has' : 'has NO'} access_token)`);
    expect(new URL(landedUrl).origin).toBe(WEB_ORIGIN);
    expect(new URL(landedUrl).pathname).toBe('/auth/reset-password');
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible({ timeout: 3_000 });
    const shown = Date.now() - landed;
    await expect.poll(() => page.url(), { timeout: 3_000 }).not.toMatch(/access_token/);
    expect(page.url()).toBe(`${WEB_ORIGIN}/auth/reset-password`);
    await shot(page, '03b-old-shape-link-form');
    // Do NOT save a password here — the form is only opened. The context is discarded.
    return { qty: '1', headerStatus: 'Choose a new password', overallStatus: `Old #access_token link still works; form ${shown} ms after landing; hash cleaned (no password saved)` };
  });
});

// ---------------------------------------------------------------------------
// 8. No params at all
// ---------------------------------------------------------------------------
test('8 - /auth/reset-password with no params shows "invalid or has expired" after the wait', async ({ page }) => {
  await step('8', 'Open /auth/reset-password with no params', '—', async () => {
    const t0 = Date.now();
    await page.goto('/auth/reset-password', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Verifying your reset link')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Reset link problem' })).toBeVisible({ timeout: 15_000 });
    const waited = Date.now() - t0;
    const msg = (await page.locator('main p').first().innerText()).trim();
    log(`no-params message after ${waited} ms: "${msg}"`);
    expect(msg).toMatch(/invalid or has expired/i);
    await shot(page, '08-no-params');
    return { qty: '—', headerStatus: 'Reset link problem', overallStatus: `"${msg.slice(0, 80)}" after ${waited} ms` };
  });
});

// ---------------------------------------------------------------------------
// 9. Rate limit — API only
// ---------------------------------------------------------------------------
test('9 - 4 quick POSTs with a made-up address all answer 200 with the same body', async ({ page }) => {
  await step('9', '4 quick POST /auth/forgot-password', 'e2e-ratelimit-…@example.invalid', async () => {
    const email = `e2e-ratelimit-${Date.now()}@example.invalid`;
    const url = `${API_URL}/auth/forgot-password`;
    const results = await Promise.all(
      [1, 2, 3, 4].map(async () => {
        const res = await page.request.post(url, {
          data: { email },
          headers: { 'content-type': 'application/json', origin: WEB_ORIGIN },
        });
        return { status: res.status(), text: await res.text() };
      }),
    );
    results.forEach((r, i) => log(`POST #${i + 1} -> ${r.status} ${r.text}`));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    const bodies = results.map((r) => JSON.parse(r.text) as { ok: unknown; mailer: unknown });
    for (const b of bodies) expect(b).toEqual({ ok: true, mailer: bodies[0]!.mailer });
    if (state.mailer) expect(bodies[0]!.mailer).toBe(state.mailer);
    else state.mailer = String(bodies[0]!.mailer);
    return {
      qty: '4',
      headerStatus: '200 ×4',
      overallStatus: `All 200 { ok:true, mailer:"${String(bodies[0]!.mailer)}" }; no 429, no differing body`,
    };
  });
});

// ---------------------------------------------------------------------------
// 10. Audit rows in activity_log (read-only SELECT via the service role)
// ---------------------------------------------------------------------------
test('10 - activity_log: password_reset_completed row; password_reset_requested only with an app mailer', async () => {
  test.skip(!state.step4ok, 'step 4 did not change the password');
  await step('10', 'Check activity_log audit rows', MASKED_EMAIL, async () => {
    await ensureUserId();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const all = await auditRows(since);
    for (const r of all) log(`activity_log ${r.ts} ${r.action} entity=${r.entity} ref=${r.ref_id} detail="${r.detail}"`);
    const completed = all.filter((r) => r.action === 'password_reset_completed');
    const requested = all.filter((r) => r.action === 'password_reset_requested');
    expect(completed.length, 'one password_reset_completed row in the last 10 min').toBeGreaterThanOrEqual(1);
    const row = completed[0]!;
    expect(row.detail.startsWith('Password changed from IP')).toBe(true);
    expect(row.entity).toBe('users');
    expect(row.ref_id).toBe(state.userId);
    expect(Date.parse(row.ts)).toBeGreaterThanOrEqual(Date.parse(state.step4At) - 60_000);
    state.auditCompletedDetail = row.detail;
    state.auditRequestedDetails = requested.map((r) => `${r.ts} ${r.detail}`);
    persist();
    const outcome = /confirmation email (.*)$/.exec(row.detail)?.[1] ?? '';
    log(`email outcome in audit row: "${outcome}"`);
    const appMailer = state.mailer === 'resend' || state.mailer === 'smtp';
    if (appMailer) expect(requested.length).toBeGreaterThanOrEqual(1);
    else expect(requested.length, `mailer=${state.mailer}: no password_reset_requested row expected`).toBe(0);
    return {
      qty: String(all.length),
      headerStatus: 'password_reset_completed',
      overallStatus: `${completed.length} completed row(s): "${row.detail}"; ${requested.length} requested row(s) (mailer=${state.mailer}${appMailer ? '' : ' -> none expected'})`,
    };
  });
});

// ---------------------------------------------------------------------------
// 11. Browser session: shared across tabs, gone with the cookies
// ---------------------------------------------------------------------------
test('11 - session is shared by a second tab and gone after clearCookies', async ({ browser }) => {
  await step('11', 'Second tab shares the login; clearCookies -> /login', MASKED_EMAIL, async () => {
    await ensureOriginalPassword();
    const ctx = await freshContext(browser);
    try {
      const p1 = await ctx.newPage();
      await signIn(p1, ADMIN_EMAIL, ADMIN_PASSWORD);
      await p1.waitForURL((u) => u.pathname === '/', { timeout: 30_000 });
      await expect(p1.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });

      const p2 = await ctx.newPage();
      await p2.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(p2.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 30_000 });
      expect(new URL(p2.url()).pathname).toBe('/');
      log('second tab: signed in without a login redirect');
      await shot(p2, '11-second-tab-signed-in');

      await ctx.clearCookies();
      await p2.reload({ waitUntil: 'domcontentloaded' });
      await p2.waitForURL(/\/login/, { timeout: 20_000 });
      await expect(p2.getByRole('heading', { name: 'Sign in to Innovic ERP' })).toBeVisible({ timeout: 10_000 });
      log('after clearCookies + reload: /login');
      await shot(p2, '11b-after-clear-cookies');
      return { qty: '2', headerStatus: 'Signed in -> /login', overallStatus: 'Second tab already signed in; clearCookies + reload -> /login' };
    } finally {
      await ctx.close();
    }
  });
});

// ---------------------------------------------------------------------------
// 12. API guard: password-changed from an ordinary session
// ---------------------------------------------------------------------------
test('12 - POST /auth/password-changed from a normal session: emailed:false and no audit row', async ({ request }) => {
  await step('12', 'POST /auth/password-changed from ordinary session', MASKED_EMAIL, async () => {
    await ensureOriginalPassword();
    await ensureUserId();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const before = (await auditRows(since)).filter((r) => r.action === 'password_reset_completed').length;

    const client = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await client.auth.signInWithPassword({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (error) throw new Error('ordinary sign-in failed: ' + error.message);
    const token = data.session?.access_token ?? '';
    expect(token).not.toBe('');
    try {
      const res = await request.post(`${API_URL}/auth/password-changed`, {
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: WEB_ORIGIN },
        data: {},
      });
      const text = await res.text();
      log(`POST /auth/password-changed (ordinary session) -> ${res.status()} ${text}`);
      expect(res.status()).toBe(200);
      expect(JSON.parse(text)).toEqual({ ok: true, emailed: false });
    } finally {
      await client.auth.signOut();
    }
    const after = (await auditRows(since)).filter((r) => r.action === 'password_reset_completed').length;
    log(`password_reset_completed rows before=${before} after=${after}`);
    expect(after, 'an ordinary session must not create a password_reset_completed row').toBe(before);
    return { qty: '1', headerStatus: '200', overallStatus: `{ ok:true, emailed:false }; completed audit rows unchanged (${before} -> ${after})` };
  });
});

// ---------------------------------------------------------------------------
// Z. Report
// ---------------------------------------------------------------------------
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

test('Z - render six-column PDF + JSON report', async ({ page }) => {
  const expected: [string, string, string][] = [
    ['1', 'Check Forgot password? link', '—'],
    ['2a', 'Request reset for real address', MASKED_EMAIL],
    ['2b', 'Request reset for made-up address', 'e2e-nobody-…@example.invalid'],
    ['3', 'Open own-domain token_hash link', MASKED_EMAIL],
    ['4', 'Save new password -> /login panel, signed out', MASKED_EMAIL],
    ['5a', 'Sign in with NEW password; auth cookie is a Session cookie', MASKED_EMAIL],
    ['5b', 'Sign in with OLD password (fresh context)', MASKED_EMAIL],
    ['6', 'Restore original admin password, prove sign-in', MASKED_EMAIL],
    ['7', 'Re-open the same token_hash link', MASKED_EMAIL],
    ['3b', 'Open old-shape action_link (#access_token)', MASKED_EMAIL],
    ['8', 'Open /auth/reset-password with no params', '—'],
    ['9', '4 quick POST /auth/forgot-password', 'e2e-ratelimit-…@example.invalid'],
    ['10', 'Check activity_log audit rows', MASKED_EMAIL],
    ['11', 'Second tab shares the login; clearCookies -> /login', MASKED_EMAIL],
    ['12', 'POST /auth/password-changed from ordinary session', MASKED_EMAIL],
  ];
  for (const [id, action, document] of expected) {
    if (!rows.some((r) => r.step === id)) {
      rows.push({ step: id, action, document, qty: '—', headerStatus: '—', overallStatus: 'Not run (earlier step failed)', result: 'SKIP' });
    }
  }
  rows.sort((a, b) => expected.findIndex((e) => e[0] === a.step) - expected.findIndex((e) => e[0] === b.step));

  const mailer = state.mailer || 'unknown';
  const appMailer = mailer === 'resend' || mailer === 'smtp';
  findings.push(
    appMailer
      ? `mailer=${mailer}: the API sends the reset link and the confirmation email through its own mailer.`
      : 'mailer=supabase: Railway (TEST API) has no SMTP/Resend variables, so the reset link falls back to Supabase\'s built-in mailer (delivers only to Supabase-org members, a few mails an hour) and the "password changed" confirmation email is NOT sent — the reset page lands on /login?reset=done-nomail and the panel shows no email sentence. Staff delivery stays blocked until a mailer is configured.',
  );
  if (state.resetParam) findings.push(`Observed after the change: /login?reset=${state.resetParam}; POST /auth/password-changed answered emailed:${state.resetParam === 'done'}.`);
  if (state.auditCompletedDetail) findings.push(`Audit row written on the change: "${state.auditCompletedDetail}".`);
  if (state.auditCompletedDetail && !appMailer) {
    findings.push(
      state.auditRequestedDetails.length === 0
        ? `No password_reset_requested row was written (mailer=${mailer}) — as the brief expected.`
        : `DISCREPANCY (step 10 red): with mailer=${mailer} the brief expected NO password_reset_requested row, but the API wrote ${state.auditRequestedDetails.length}: ${state.auditRequestedDetails.map((d) => '"' + d + '"').join('; ')}. service.ts sendResetEmail() records the row after ANY send that did not throw — the Supabase-mailer fallback included — so the audit log says "sent via supabase" for a mail that Supabase's built-in mailer will not deliver to staff. Decide whether the row should be gated to resend/smtp (one-line change in apps/api) or the expectation updated.`,
    );
  }
  findings.push(
    'The own-domain link works: the page verifies the token_hash itself, shows the form with the 10-minute note, cleans the query string, and refuses the same link a second time with the 10-minute wording and a "Request a new link" button. The old #access_token link shape still works too.',
  );
  findings.push(
    'After the change there is NO auto-login: every session is signed out, the user lands on /login with the green "Password changed" panel, and must sign in again. The new password signs in; the old one is refused.',
  );
  findings.push(
    `The login is kept in a Session cookie (${AUTH_COOKIE_PREFIX}.0, no Expires) shared by every tab; clearing cookies (browser close) sends the next load to /login.`,
  );
  findings.push(
    state.restoreProven
      ? `Admin password was RESTORED to the original at ${state.restoredAt.replace('T', ' ').slice(0, 19)} UTC and proven by a fresh sign-in. Nothing left changed.`
      : `Admin password restore: ${state.restoredAt ? 'restored at ' + state.restoredAt + ' but NOT proven by sign-in' : 'NOT CONFIRMED — check manually'}.`,
  );
  findings.push(
    'Note for the API heuristic: /auth/password-changed only counts a change made at least 1 s after the link was opened; the spec waits 2 s before saving, as a person would.',
  );
  const fails = rows.filter((r) => r.result === 'FAIL');
  if (fails.length) findings.push(`${fails.length} step(s) FAILED — see the Result column and the note in the JSON.`);

  const pass = rows.filter((r) => r.result === 'PASS').length;
  const skip = rows.filter((r) => r.result === 'SKIP').length;
  const generatedAt = new Date().toISOString();
  const summary = `${pass} pass · ${fails.length} fail · ${skip} not run`;

  const body = rows
    .map((r, i) => {
      const cls = r.result === 'PASS' ? 'pass' : r.result === 'FAIL' ? 'fail' : 'na';
      const sym = r.result === 'PASS' ? '✓ Pass' : r.result === 'FAIL' ? '✗ Fail' : '— Not run';
      return `<tr class="${i % 2 ? 'even' : 'odd'}"><td class="act">${esc(r.action)} <span class="id">${esc(r.step)}</span></td><td class="mono">${esc(r.document)}</td><td class="qty">${esc(r.qty)}</td><td>${esc(r.headerStatus)}</td><td>${esc(r.overallStatus)}</td><td class="res ${cls}">${sym}</td></tr>`;
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
    .legend { font-size: 8.5pt; color: #444; margin: 6px 0 0; }
  </style></head><body>
  <h1>Innovic ERP — Forgot-password verification v2 (test stack)</h1>
  <div class="meta"><b>Date:</b> ${REPORT_DATE} · <b>Site:</b> ${esc(WEB_ORIGIN)} · <b>API:</b> ${esc(API_URL)} · <b>Supabase:</b> TEST project ${TEST_PROJECT_REF} · <b>Generated:</b> ${esc(generatedAt.replace('T', ' ').slice(0, 16))} UTC<br>
  <b>Result:</b> ${esc(summary)} · <b>mailer observed:</b> ${esc(mailer)} · <b>Account used:</b> ${esc(MASKED_EMAIL)} (password changed to a temporary value and restored) · Every value is what was on screen, in the API response or in activity_log at that step.</div>
  <table><colgroup><col style="width:22%"><col style="width:15%"><col style="width:4%"><col style="width:14%"><col style="width:36%"><col style="width:9%"></colgroup>
  <thead><tr><th>Action</th><th>Document</th><th>Qty</th><th>Header Status</th><th>Overall Status</th><th>Result</th></tr></thead>
  <tbody>${body}</tbody></table>
  <div class="legend">✓ Pass = seen as required · ✗ Fail = wrong at the time this was generated · — Not run = skipped because an earlier step failed. Small grey codes are the step ids in the JSON.</div>
  <h2>Findings</h2>
  <ul>${findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
  </body></html>`;

  mkdirSync(REPORTS_DIR, { recursive: true });
  await page.setContent(html, { waitUntil: 'load' });
  await page.pdf({
    path: PDF_OUT,
    format: 'A4',
    landscape: true,
    printBackground: true,
    displayHeaderFooter: true,
    headerTemplate: '<div></div>',
    footerTemplate:
      `<div style="width:100%;font-size:8px;color:#6b7280;padding:0 10mm;display:flex;justify-content:space-between;"><span>Innovic ERP — forgot-password verification v2 · test stack · ${REPORT_DATE}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    margin: { top: '12mm', bottom: '14mm', left: '10mm', right: '10mm' },
  });
  writeFileSync(
    JSON_OUT,
    JSON.stringify(
      {
        title: 'Forgot-password verification v2',
        date: REPORT_DATE,
        generatedAt,
        site: WEB_ORIGIN,
        api: API_URL,
        supabaseProject: TEST_PROJECT_REF,
        account: MASKED_EMAIL,
        mailer,
        resetParam: state.resetParam || null,
        auditCompletedDetail: state.auditCompletedDetail || null,
        adminPasswordRestoredAt: state.restoredAt || null,
        adminPasswordRestoreProven: state.restoreProven,
        summary,
        rows,
        findings,
        screenshots: shots,
      },
      null,
      2,
    ),
  );
  // The state file carries the (consumed) token hash and the (already replaced) temporary
  // password — nothing worth keeping once the report is written.
  if (existsSync(STATE_FILE)) rmSync(STATE_FILE);
  log(`PDF: ${PDF_OUT}`);
  log(`JSON: ${JSON_OUT}`);
  log(`SUMMARY: ${summary}; mailer=${mailer}; reset=${state.resetParam}; restored=${state.restoredAt || 'NO'}; proven=${state.restoreProven}`);
  expect(existsSync(PDF_OUT)).toBe(true);
});
