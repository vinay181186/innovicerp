import { describe, expect, it } from 'vitest';
import type { EffectiveAccess } from '../schemas/access-control';
import { canOpenPage, missingRightText, pagePattern, pageRuleFor } from './page-access';

const eff = (p: Partial<EffectiveAccess>): EffectiveAccess => ({
  fullAccess: false,
  auditor: false,
  drawingDownload: false,
  departments: {},
  forms: {},
  ...p,
});
const prodViewer = eff({ departments: { production: 'L1' } });
const prodClerk = eff({ departments: { production: 'L2' } });

describe('ADR-234 page access', () => {
  it('a literal segment wins over a parameter', () => {
    expect(pagePattern('/production-orders/new')).toBe('/production-orders/new');
    expect(pagePattern('/production-orders/abc')).toBe('/production-orders/$id');
    expect(pagePattern('/production-orders/abc/edit?x=1')).toBe('/production-orders/$id/edit');
    expect(pagePattern('/nope/at/all')).toBeUndefined();
  });

  it('View-only cannot open a New page; Entry can', () => {
    expect(canOpenPage(prodViewer, false, '/production-orders')).toBe(true);
    expect(canOpenPage(prodViewer, false, '/production-orders/new')).toBe(false);
    expect(canOpenPage(prodClerk, false, '/production-orders/new')).toBe(true);
  });

  it('Super Admin pages are closed to a department admin', () => {
    const sysL5 = eff({ departments: { system: 'L5' } });
    for (const p of ['/users', '/access-control', '/approval-config', '/trash', '/backup']) {
      expect(canOpenPage(sysL5, false, p)).toBe(false);
      expect(canOpenPage(sysL5, true, p)).toBe(true);
    }
  });

  it('Auditor opens view pages but no New page and no personal create page', () => {
    const aud = eff({ auditor: true, departments: { production: 'L5' } });
    expect(canOpenPage(aud, false, '/production-orders')).toBe(true);
    expect(canOpenPage(aud, false, '/production-orders/new')).toBe(false);
    expect(canOpenPage(aud, false, '/saved-reports/new')).toBe(false);
  });

  it('unknown paths fail closed', () => {
    expect(canOpenPage(prodClerk, false, '/capa')).toBe(false);
  });

  it('refusal text names the tick', () => {
    expect(missingRightText(pageRuleFor('/production-orders/new'))).toBe(
      'This page needs the Entry tick on Production Orders. Ask an admin.',
    );
  });
});
