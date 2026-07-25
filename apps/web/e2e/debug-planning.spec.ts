import { test } from '@playwright/test';

test('debug planning SO list', async ({ page }) => {
  test.setTimeout(90_000);
  const lines: string[] = [];

  page.on('request', (r) => {
    const u = r.url();
    if (!u.includes('localhost') && !u.startsWith('data:')) {
      lines.push(`REQ ${r.method()} ${u}`);
    }
  });
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.includes('localhost')) {
      lines.push(`FAIL ${r.method()} ${u} — ${r.failure()?.errorText ?? ''}`);
    }
  });
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.includes('localhost') && u.includes('/so-planning')) {
      let body = '';
      try {
        body = (await res.text()).slice(0, 500);
      } catch {
        body = '(unreadable)';
      }
      lines.push(`RESP ${res.status()} ${u}\n  ${body}`);
    }
  });
  page.on('console', (m) => {
    if (m.type() === 'error') lines.push(`CONSOLE.error ${m.text()}`);
  });

  await page.goto('/planning', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12_000);

  console.log('=== NETWORK / ERRORS ===\n' + (lines.join('\n') || '(none)'));
});
