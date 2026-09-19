import { RESET_LINK_VALID_MINUTES } from '@innovic/shared';
import { describe, expect, it } from 'vitest';
import { resolveMailerFrom, smtpConfig } from '../../lib/mailer-config';
import { RateLimiter } from './rate-limit';
import { buildPasswordChangedEmail, buildResetEmail, formatIst } from './templates';

const WINDOW = 15 * 60 * 1000;

function makeClock(start = 1_000_000) {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('auth-recovery rate limiter', () => {
  it('per-email: allows 3 requests, blocks the 4th, re-allows after the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 3, windowMs: WINDOW, now: clock.now });

    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(true);
    expect(limiter.hit('a@x.com')).toBe(false);
    // Another address is independent.
    expect(limiter.hit('b@x.com')).toBe(true);

    // Still inside the window — still blocked.
    clock.advance(WINDOW - 1);
    expect(limiter.hit('a@x.com')).toBe(false);

    // Window elapsed for the first three hits — allowed again.
    clock.advance(2);
    expect(limiter.hit('a@x.com')).toBe(true);
  });

  it('per-IP: allows 10 requests, blocks the 11th, re-allows after the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 10, windowMs: WINDOW, now: clock.now });

    for (let i = 0; i < 10; i++) expect(limiter.hit('10.0.0.1')).toBe(true);
    expect(limiter.hit('10.0.0.1')).toBe(false);
    expect(limiter.hit('10.0.0.2')).toBe(true);

    clock.advance(WINDOW + 1);
    expect(limiter.hit('10.0.0.1')).toBe(true);
  });

  it('prunes expired keys so the map stays bounded', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 3, windowMs: WINDOW, now: clock.now });

    limiter.hit('a@x.com');
    limiter.hit('b@x.com');
    expect(limiter.size).toBe(2);

    clock.advance(WINDOW + 1);
    limiter.hit('c@x.com');
    expect(limiter.size).toBe(1);
  });

  it('blocked hits do not extend the window', () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ max: 1, windowMs: WINDOW, now: clock.now });

    expect(limiter.hit('k')).toBe(true);
    clock.advance(WINDOW / 2);
    expect(limiter.hit('k')).toBe(false); // must not be recorded
    clock.advance(WINDOW / 2 + 1);
    expect(limiter.hit('k')).toBe(true); // first hit expired; the blocked one never counted
  });
});

describe('auth-recovery mailer precedence (lib/mailer-config)', () => {
  const smtp = { SMTP_HOST: 'smtp.gmail.com', SMTP_USER: 'erp@innovic.in', SMTP_PASS: 'app-pass' };

  it('nothing configured → supabase', () => {
    expect(resolveMailerFrom({})).toBe('supabase');
  });

  it('Resend key + any from-address → resend, and beats SMTP', () => {
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k', AUTH_FROM_EMAIL: 'a@x' })).toBe('resend');
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k', ALERTS_FROM_EMAIL: 'a@x' })).toBe('resend');
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k', RESEND_FROM_EMAIL: 'a@x' })).toBe('resend');
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k', AUTH_FROM_EMAIL: 'a@x', ...smtp })).toBe(
      'resend',
    );
  });

  it('Resend key WITHOUT a from-address falls through to SMTP, else supabase', () => {
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k', ...smtp })).toBe('smtp');
    expect(resolveMailerFrom({ RESEND_API_KEY: 'k' })).toBe('supabase');
  });

  it('SMTP needs host + user + pass — any one missing → supabase', () => {
    expect(resolveMailerFrom(smtp)).toBe('smtp');
    expect(resolveMailerFrom({ SMTP_HOST: smtp.SMTP_HOST, SMTP_USER: smtp.SMTP_USER })).toBe(
      'supabase',
    );
    expect(resolveMailerFrom({ SMTP_USER: smtp.SMTP_USER, SMTP_PASS: smtp.SMTP_PASS })).toBe(
      'supabase',
    );
  });

  it('SMTP defaults: port 587 / not secure; 465 → secure; from = SMTP_FROM ?? SMTP_USER', () => {
    expect(smtpConfig(smtp)).toEqual({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      user: 'erp@innovic.in',
      pass: 'app-pass',
      from: 'erp@innovic.in',
    });
    expect(
      smtpConfig({ ...smtp, SMTP_PORT: 465, SMTP_FROM: 'Innovic ERP <erp@innovic.in>' }),
    ).toMatchObject({ port: 465, secure: true, from: 'Innovic ERP <erp@innovic.in>' });
    expect(smtpConfig({})).toBeUndefined();
  });
});

describe('auth-recovery email templates', () => {
  const link = 'https://innovicerp.com/auth/reset-password?token_hash=abc%2B123&type=recovery';

  it('reset email: subject, host, 10-minute wording, the link, no Supabase host', () => {
    const mail = buildResetEmail('Vinay Makwana', 'https://innovicerp.com', link);
    expect(mail.subject).toBe('Reset your Innovic ERP password');
    expect(RESET_LINK_VALID_MINUTES).toBe(10);
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('Hello Vinay Makwana,');
      expect(body).toContain('your Innovic ERP account on innovicerp.com');
      expect(body).toContain('This link is valid for 10 minutes and works once.');
      expect(body).toContain('ignore this email — your password stays the same.');
      expect(body).toContain('Innovic ERP');
      expect(body).not.toContain('supabase');
    }
    expect(mail.text).toContain(link);
    // HTML-escaped in the href (& → &amp;), still a single-page link.
    expect(mail.html).toContain(
      'href="https://innovicerp.com/auth/reset-password?token_hash=abc%2B123&amp;type=recovery"',
    );
  });

  it('reset email: blank name → "there"; name is HTML-escaped', () => {
    expect(buildResetEmail(null, 'https://x.com', link).text).toContain('Hello there,');
    expect(buildResetEmail('  ', 'https://x.com', link).text).toContain('Hello there,');
    expect(buildResetEmail('<b>x</b>', 'https://x.com', link).html).toContain(
      'Hello &lt;b&gt;x&lt;/b&gt;,',
    );
  });

  it('password-changed email: subject, IST timestamp, both closing lines', () => {
    const at = new Date('2026-09-19T10:12:00Z'); // 15:42 IST
    const mail = buildPasswordChangedEmail('Vinay', at);
    expect(mail.subject).toBe('Your Innovic ERP password was changed');
    const when = formatIst(at);
    expect(when).toMatch(/^19 Sept? 2026, /); // en-IN ICU prints "Sept"
    expect(when).toMatch(/3:42\s?pm IST$/i);
    for (const body of [mail.html, mail.text]) {
      expect(body).toContain('Hello Vinay,');
      expect(body).toContain(`was changed on ${when}.`);
      expect(body).toContain('If this was you, no action is needed.');
      expect(body).toContain('contact your administrator immediately.');
    }
  });
});
