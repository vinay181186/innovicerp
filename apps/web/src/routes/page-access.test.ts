// ADR-234 — every page has ONE rule in PAGE_ACCESS (packages/shared/src/lib/
// page-access.ts), and the route guard, the header menu, the Home quick links
// and every next-step link read it. This test keeps that table honest:
//   (a) every registered route has a rule, and no rule names a route that
//       does not exist;
//   (b) a "new" / "from-pr" page asks Entry, an "edit" page asks Edit;
//   (c) every header-menu link points at a real route;
//   (d) every Home quick link / widget / document link points at a real route;
//   (e) the menu a View-only Production user and a non-super System L5 user
//       would see.
import {
  ACCESS_FORM_KEYS,
  DASHBOARD_QUICK_LINKS,
  DASHBOARD_WIDGETS,
  DOC_NAV_KINDS,
  PAGE_ACCESS,
  docNavPage,
  pagePattern,
  type EffectiveAccess,
} from '@innovic/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/env', () => ({
  env: {
    VITE_API_URL: 'http://localhost',
    VITE_SUPABASE_URL: 'http://localhost',
    VITE_SUPABASE_ANON_KEY: 'x'.repeat(30),
  },
}));

const TIMEOUT = 240_000;

async function routePaths(): Promise<string[]> {
  const { router } = await import('../router');
  return Object.keys(router.routesByPath as Record<string, unknown>)
    .map((p) => (p.length > 1 ? p.replace(/\/+$/, '') : p))
    .filter((p) => p !== '');
}

function access(over: Partial<EffectiveAccess>): EffectiveAccess {
  return {
    fullAccess: false,
    auditor: false,
    drawingDownload: false,
    departments: {},
    forms: {},
    ...over,
  };
}

async function menuLinks(eff: EffectiveAccess): Promise<string[]> {
  const { ORDERED_SECTIONS, shouldShowSection, menuGroups } =
    await import('../components/shared/nav-sections');
  return ORDERED_SECTIONS.filter((sec) => shouldShowSection(sec.key, false, eff)).flatMap((sec) =>
    menuGroups(sec, eff, false).flatMap((g) => g.items.map((it) => it.to)),
  );
}

describe('ADR-234 page access table', () => {
  it(
    '(a) every route has a PAGE_ACCESS rule and every rule is a route',
    async () => {
      const routes = new Set(await routePaths());
      const keys = new Set(Object.keys(PAGE_ACCESS));
      const noRule = [...routes].filter((r) => !keys.has(r)).sort();
      const orphan = [...keys].filter((k) => !routes.has(k)).sort();
      expect({ noRule, orphan }).toEqual({ noRule: [], orphan: [] });
    },
    TIMEOUT,
  );

  it(
    '(b) /new and /from-pr ask Entry, /$id/edit asks Edit',
    async () => {
      const wrong: string[] = [];
      for (const path of await routePaths()) {
        const rule = PAGE_ACCESS[path];
        if (!rule) continue;
        const need = /\/(new|from-pr)$/.test(path)
          ? 'entry'
          : /\/\$id\/edit$/.test(path)
            ? 'edit'
            : null;
        if (!need) continue;
        // Personal pages (saved reports) carry { canWrite } instead of a tick.
        if ('canWrite' in rule || 'superAdmin' in rule) continue;
        const ok =
          'action' in rule
            ? rule.action === need
            : 'anyOf' in rule
              ? rule.anyOf.every((t) => t.action === need)
              : false;
        if (!ok) wrong.push(`${path} → ${JSON.stringify(rule)}`);
      }
      expect(wrong).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '(c) every header-menu link is a registered route',
    async () => {
      const routes = new Set(await routePaths());
      const { SECTIONS } = await import('../components/shared/nav-sections');
      const bad = SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.items))
        .map((it) => it.to)
        .filter((to) => {
          const p = pagePattern(to);
          return !p || !routes.has(p);
        });
      expect(bad).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '(d) every Home quick link, widget and document link is a registered route',
    async () => {
      const routes = new Set(await routePaths());
      const hrefs = [
        ...DASHBOARD_QUICK_LINKS.map((l) => l.page),
        ...DASHBOARD_WIDGETS.map((w) => w.navPage),
        ...DOC_NAV_KINDS.map((k) => docNavPage(k, '00000000-0000-0000-0000-000000000000')),
        // The CAPA task link (modules/capa/components/capa-view.tsx).
        '/nc-register?tab=capa&capa=CAPA-0001',
      ];
      const bad = hrefs.filter((h) => {
        const p = pagePattern(h);
        return !p || !routes.has(p);
      });
      expect(bad).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    '(e) the menu shows only pages the user may open',
    async () => {
      // View-only Production: L1 in the department, nothing else.
      const viewOnly = await menuLinks(access({ departments: { production: 'L1' } }));
      expect(viewOnly).toContain('/production-orders');
      expect(viewOnly).not.toContain('/production-orders/new');
      expect(viewOnly).not.toContain('/production-orders/close');

      // L2 Data Entry in Production gets New Production Order.
      const entry = await menuLinks(access({ departments: { production: 'L2' } }));
      expect(entry).toContain('/production-orders/new');

      // System L5 without Full Access is not a Super Admin.
      const systemL5 = await menuLinks(access({ departments: { system: 'L5' } }));
      expect(systemL5).toContain('/settings');
      for (const p of ['/users', '/access-control', '/approval-config', '/trash', '/backup']) {
        expect(systemL5).not.toContain(p);
      }

      // Full Access sees all five.
      const full = await menuLinks(access({ fullAccess: true }));
      for (const p of ['/users', '/access-control', '/approval-config', '/trash', '/backup']) {
        expect(full).toContain(p);
      }
      expect(ACCESS_FORM_KEYS.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );
});
