// ADR-234 — ONE list of what each page needs (owner, 2026-10-16).
//
// "A button or link shows only if the user's tick allows the page it leads
// to." Before this, the menu, the route guard inside each page, the Home quick
// links and the "next step" buttons on detail pages each decided on their own,
// so a View-only user saw "New Production Order" in the menu and then got
// "You do not have permission". Every one of them now reads this table:
//
//   - the app shell's route guard (apps/web routes/_authenticated.tsx)
//   - the header menu (components/shared/top-nav.tsx)
//   - the shared <ActionLink> / useCanOpen() used by next-step buttons
//   - the API Home quick links and work list (dashboard/*)
//
// The key is the route PATTERN exactly as the web router registers it
// ('/production-orders/$id/edit'). A test in apps/web fails CI when a route is
// added without an entry here, or when a menu / Home link points at a path
// that is not a route.
//
// The server never relies on this table: each save keeps its own
// requireFormAccess. This decides what the screen OFFERS, so it can never
// offer what the server will refuse.

import type { AccessAction, AccessDeptKey, AccessFormKey } from '../enums/access-control';
import { ACCESS_FORMS } from '../enums/access-control';
import {
  effectiveFormPerms,
  hasDeptAccess,
  isUnconfigured,
  type EffectiveAccess,
} from '../schemas/access-control';

export interface PageTick {
  form: AccessFormKey;
  action: AccessAction;
}

export type PageRule =
  /** One tick on one page. */
  | PageTick
  /** Any one of these ticks opens the page (e.g. DC Receive: OSP DC Entry OR GRN Entry). */
  | { anyOf: readonly PageTick[] }
  /** Only L6 Super Admin (Full Access). */
  | { superAdmin: true }
  /** Anyone set up to write — not an L7 Auditor, not an unconfigured account.
   *  For pages that create something personal (a saved report). */
  | { canWrite: true }
  /** Any signed-in user. The page and the server scope what they show. */
  | { open: true };

const v = (form: AccessFormKey): PageTick => ({ form, action: 'view' });
const entry = (form: AccessFormKey): PageTick => ({ form, action: 'entry' });
const edit = (form: AccessFormKey): PageTick => ({ form, action: 'edit' });
const OPEN = { open: true } as const;
const SUPER = { superAdmin: true } as const;

/** The usual four pages of one master or document: list, detail, new, edit. */
function crud(base: string, form: AccessFormKey): Record<string, PageRule> {
  return {
    [base]: v(form),
    [`${base}/$id`]: v(form),
    [`${base}/new`]: entry(form),
    [`${base}/$id/edit`]: edit(form),
  };
}

export const PAGE_ACCESS: Readonly<Record<string, PageRule>> = {
  // ── Open: the server scopes what each person sees ──
  '/': OPEN,
  '/login': OPEN,
  '/change-password': OPEN,
  '/auth/callback': OPEN,
  '/auth/reset-password': OPEN,
  '/__ui-kit': OPEN,
  '/search': OPEN,
  '/settings': OPEN, // read-only for everyone but Super Admin
  '/approvals': OPEN, // lists only what the caller may approve
  '/reports': OPEN, // server canSeeReport
  '/reports/$slug': OPEN,
  '/task-board': OPEN,
  '/daily-task-reports': OPEN,
  '/alerts': OPEN,
  '/alerts/$code': OPEN,
  '/alerts/config': OPEN, // page edits only for Super Admin (owner D3)
  '/activity-log': OPEN,
  '/print-templates': OPEN, // editing needs Print Templates Edit, checked on the page
  '/op-log': OPEN,
  '/so-overview': OPEN,
  '/so-status': OPEN,
  '/sales-orders/$id/status': OPEN,
  '/daily-report': OPEN,
  '/production-dashboard': OPEN,
  '/job-queue': OPEN,
  '/machine-loading': OPEN,
  '/production-schedule': OPEN,
  '/pending-so-value': OPEN,
  '/sc-dashboard': OPEN,
  '/stuck-dashboard': OPEN,
  '/so-cycle-time': OPEN,
  '/so-costing': OPEN,
  '/so-costing/$id': OPEN,
  '/stock-valuation': OPEN,
  '/store-inventory': OPEN,
  '/reorder-list': OPEN,
  '/qc-history': OPEN,
  '/jw-dc': OPEN,
  '/jw-dc/$id': OPEN,

  // ── Saved reports belong to a person, not a page ──
  '/saved-reports': OPEN,
  '/saved-reports/$id': OPEN,
  '/saved-reports/new': { canWrite: true },
  '/saved-reports/$id/edit': { canWrite: true }, // the page also checks the owner

  // ── Super Admin only (ADR-232 / owner E3) ──
  '/users': SUPER,
  '/users/new': SUPER,
  '/users/$id/edit': SUPER,
  '/access-control': SUPER,
  '/approval-config': SUPER,
  '/trash': SUPER,
  '/backup': SUPER,

  // ── Sales ──
  ...crud('/sales-orders', 'so_create'),
  ...crud('/job-work-orders', 'jw_create'),
  ...crud('/clients', 'client_create'),
  ...crud('/customer-dispatches', 'dispatch_create'),

  // ── Planning ──
  '/planning': v('plan_create'),
  ...crud('/plans', 'plan_create'),
  ...crud('/ml-plans', 'mlplan_create'),
  ...crud('/route-cards', 'routecard_create'),
  '/assemblies': v('assembly_create'),
  '/assemblies/$soId': v('assembly_create'),

  // ── Production ──
  ...crud('/production-orders', 'prodorder_create'),
  '/production-orders/close': { form: 'prodorder_create', action: 'advance' },
  ...crud('/job-cards', 'jc_create'),
  '/jc-ops': v('jc_create'),
  // A QC-only inspector reaches Inspect from Op Entry too.
  '/op-entry': { anyOf: [v('op_entry'), v('qc_submit')] },
  '/op-entry/running': v('op_entry'),
  ...crud('/machines', 'machine_create'),
  ...crud('/operators', 'operator_create'),
  '/raw-material': v('rawmat_create'),

  // ── Design ──
  '/design-projects': v('dsnproj_create'),
  '/design-projects/$id': v('dsnproj_create'),
  '/design-issues': v('dsnissue_create'),
  '/design-work-log': v('dsnworklog_create'),
  '/design-tracker': v('design_create'),
  ...crud('/bom-masters', 'bom_create'),
  ...crud('/ml-boms', 'mlbom_create'),

  // ── Quality ──
  '/qc-call-register': v('qc_submit'),
  '/qc-command': v('qc_submit'),
  '/incoming-qc': v('qc_incoming'),
  '/qc-docs': v('qcdocs_upload'),
  ...crud('/nc-register', 'nc_dispose'),
  ...crud('/qc-processes', 'qcprocess_create'),
  ...crud('/tpi-masters', 'tpimaster_create'),

  // ── Purchase ──
  '/purchase-requests': v('pr_create'),
  '/purchase-requests/$id': v('pr_create'),
  '/purchase-requests/new': entry('pr_create'),
  '/purchase-requests/$id/edit': edit('pr_create'),
  '/purchase-orders': v('po_create'),
  '/purchase-orders/$id': v('po_create'),
  '/purchase-orders/from-pr': entry('po_create'),
  '/purchase-orders/$id/edit': edit('po_create'),
  ...crud('/vendors', 'vendor_create'),
  ...crud('/delivery-challans', 'ospdc_create'),
  '/delivery-challans/$id/receive': { anyOf: [entry('ospdc_create'), entry('grn_create')] },

  // ── Store ──
  ...crud('/goods-receipt-notes', 'grn_create'),
  ...crud('/items', 'item_create'),
  // Item Issues and Tool Issues share the page; each tab checks its own key.
  '/issue-register': { anyOf: [v('issue_create'), v('toolissue_create')] },
  '/stock-counts': v('stockcount_create'),
  '/stock-counts/$id': v('stockcount_create'), // '/stock-counts/new' is this route; the page asks Entry
  '/instruments': v('toolissue_create'),
  '/party-grn': v('party_create'),
  '/party-material': v('party_create'),
  '/party-stock-ledger': v('party_create'),
  '/customer-material-returns': v('party_create'),

  // ── Finance ──
  '/invoices': v('invoice_create'),
  '/invoices/$id': v('invoice_create'),
  '/invoices/new': entry('invoice_create'),
  ...crud('/cost-centers', 'cc_create'),
};

/** ADR-232: may this person save anything at all? Not an L7 Auditor and not an
 *  account nobody has configured. Super Admin always may. The web twin of the
 *  API's requireCanWrite. */
export function canWriteAnything(eff: EffectiveAccess | null | undefined): boolean {
  if (!eff) return false;
  if (eff.fullAccess) return true;
  return !eff.auditor && !isUnconfigured(eff);
}

function tickMet(eff: EffectiveAccess | null | undefined, t: PageTick): boolean {
  return effectiveFormPerms(eff, t.form)[t.action];
}

/** Does this person meet the rule? `isSuperAdmin` = role admin or Full Access. */
export function meetsPageRule(
  eff: EffectiveAccess | null | undefined,
  isSuperAdmin: boolean,
  rule: PageRule,
): boolean {
  if (isSuperAdmin) return true;
  if ('open' in rule) return true;
  if ('superAdmin' in rule) return !!eff?.fullAccess;
  if ('canWrite' in rule) return canWriteAnything(eff);
  if ('anyOf' in rule) return rule.anyOf.some((t) => tickMet(eff, t));
  return tickMet(eff, rule);
}

/** Turn a real URL ('/production-orders/12/edit?x=1') into its route pattern
 *  ('/production-orders/$id/edit'). A literal segment wins over a parameter,
 *  so '/production-orders/new' is the New page, not the detail of id "new". */
const patternCache = new Map<string, string | undefined>();

export function pagePattern(href: string): string | undefined {
  const path = (href.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  if (PAGE_ACCESS[path]) return path;
  // Table rows ask this per render; the answer for a path never changes.
  if (patternCache.has(path)) return patternCache.get(path);
  const found = matchPattern(path);
  if (patternCache.size < 5000) patternCache.set(path, found);
  return found;
}

function matchPattern(path: string): string | undefined {
  const parts = path.split('/');
  let best: { pattern: string; literals: number } | undefined;
  for (const pattern of Object.keys(PAGE_ACCESS)) {
    const pp = pattern.split('/');
    if (pp.length !== parts.length) continue;
    let literals = 0;
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      const seg = pp[i]!;
      if (seg.startsWith('$')) continue;
      if (seg !== parts[i]) {
        ok = false;
        break;
      }
      literals++;
    }
    if (ok && (!best || literals > best.literals)) best = { pattern, literals };
  }
  return best?.pattern;
}

/** The rule for a URL or a pattern. Unknown paths are refused (fail closed). */
export function pageRuleFor(href: string): PageRule | undefined {
  const p = pagePattern(href);
  return p ? PAGE_ACCESS[p] : undefined;
}

/** May this person open this URL? The one question the menu, every next-step
 *  link and the route guard ask. */
export function canOpenPage(
  eff: EffectiveAccess | null | undefined,
  isSuperAdmin: boolean,
  href: string,
): boolean {
  const rule = pageRuleFor(href);
  if (!rule) return isSuperAdmin;
  return meetsPageRule(eff, isSuperAdmin, rule);
}

const ACTION_WORD: Record<AccessAction, string> = {
  view: 'View',
  entry: 'Entry',
  advance: 'Advance',
  edit: 'Edit',
  approve: 'Approve',
};

function tickText(t: PageTick): string {
  const form = ACCESS_FORMS.find((f) => f.key === t.form);
  return `the ${ACTION_WORD[t.action]} tick on ${form?.label ?? t.form}`;
}

/** Plain words for a refusal: which tick is missing. */
export function missingRightText(rule: PageRule | undefined): string {
  if (!rule) return 'This page is not available for your access. Ask an admin.';
  if ('open' in rule) return '';
  if ('superAdmin' in rule) return 'Only an L6 Super Admin can open this page.';
  if ('canWrite' in rule)
    return 'Your access is view-only (Auditor, or not set up yet). Ask an admin.';
  if ('anyOf' in rule)
    return `This page needs ${rule.anyOf.map(tickText).join(' or ')}. Ask an admin.`;
  return `This page needs ${tickText(rule)}. Ask an admin.`;
}

/** Department a page belongs to, for Home quick links that are listed by
 *  department. Undefined for open / Super Admin / personal pages. */
export function pageDept(href: string): AccessDeptKey | undefined {
  const rule = pageRuleFor(href);
  if (!rule || !('form' in rule)) return undefined;
  return ACCESS_FORMS.find((f) => f.key === rule.form)?.dept;
}

export { hasDeptAccess };
