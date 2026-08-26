// Configure-access modal — per-user permissions editor.
//
// This is now the ONLY place a user's role and PO approval limit are set.
// Both left User Management, which handles identity (name, email, password,
// phone, active) and nothing else. Role and limit are access decisions, and
// splitting them across two screens meant "what can this person do?" had two
// half-answers and no whole one.
//
// ADR-136: the role dropdown is gone. An admin picks a DEPARTMENT — "is this
// person in Design?" is a question the business can answer; "is this person a
// manager?" is not. Picking one seeds that department's tier at L3 Editor /
// Executor, and `users.role` is derived from the resulting access rather than
// chosen beside it, which is what stops the two contradicting each other.
// Changing the main department clears the old one and seeds the new; anything
// the admin added by hand below is left alone.
//
// Rebuilt for the (Tier + Department) model (0100). Layout is a single tight
// worksheet — a one-line header (user · home dept · PO limit · JSON clone), an
// access-level segmented control, then ONE department worksheet where each
// department carries its own tier segments AND, when expanded, its own
// form/feature checklist. The old design stacked "department tiers" and
// "form/feature extras" as two separate blocks; folding each department's tier
// and its forms into one collapsible group is what lets the whole matrix read
// top-to-bottom without hunting between two tables. Tier selection moved from a
// dropdown to segmented pills so a level is picked in one click and every
// available level is visible at once.
//
// Why tiers are one choice (segments), not four loose checkboxes: the checklist
// asks for one named level per department, and a level is a single choice. Four
// loose checkboxes per department would let an admin build "edit but not view",
// which is not a tier and cannot be enforced coherently downstream. The
// per-form checkboxes below the tier are EXTRAS on top of it — a right the tier
// already grants shows ticked and locked (grey), so it is obvious where it came
// from.
//
// On save: if the role changed, fire useUpdateUser FIRST (legacy L13996),
// then save the access matrix. Both succeed or modal stays open with error.

import {
  ACCESS_DEPTS,
  ACCESS_FORMS,
  ACCESS_TIERS,
  MAIN_DEPT_DEFAULT_TIER,
  emptyFormPerms,
  priceStartTier,
  roleForAccess,
  saveUserAccessInputSchema,
  tierPermsForDept,
  type AccessDeptKey,
  type AccessFormPerms,
  type AccessTierKey,
} from '@innovic/shared';
import { ChevronDown, ChevronRight, ClipboardPaste, Copy, Loader2, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdateUser, useUser } from '@/modules/users/api';
import { useSaveUserAccess, useUserAccess } from '../api';

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

type FormPerms = AccessFormPerms;
type DeptTiers = Record<string, AccessTierKey>;
type Action = 'view' | 'entry' | 'edit' | 'approve' | 'price';

// The five checkbox columns, in display order. `price` (can-see-money) is the
// new column that sits after Approve.
const ACTIONS: readonly Action[] = ['view', 'entry', 'edit', 'approve', 'price'];

const NO_PERMS: FormPerms = {
  view: false,
  entry: false,
  edit: false,
  approve: false,
  price: false,
  priceOff: false,
  viewOff: false,
  entryOff: false,
  editOff: false,
  approveOff: false,
};

// The stored "OFF switch" field that backs each action's per-page removal.
// Ticking a tier-granted box off writes the matching flag; the resolver
// (effectiveFormPerms) subtracts it. Mirror of the long-standing priceOff.
const OFF_FIELD: Record<Action, keyof FormPerms> = {
  view: 'viewOff',
  entry: 'entryOff',
  edit: 'editOff',
  approve: 'approveOff',
  price: 'priceOff',
};

// Departments where the single-toggle per-page OFF switches are live. Rolling
// out on Purchase first (the rest keep the classic locked-tier boxes); widen
// this set to enable the same behaviour elsewhere.
const OFF_SWITCH_DEPTS: readonly string[] = ['purchase'];

// One-word tier captions for the compact TIER legend in the worksheet header.
// The full labels ("Editor / Executor", "Department Admin") are too long for a
// single legend line; the fuller wording still shows on each segment's tooltip.
const TIER_SHORT: Record<string, string> = {
  L1: 'VIEWER',
  L2: 'ENTRY',
  L3: 'EDITOR',
  L4: 'APPROVER',
  L5: 'ADMIN',
};

// Column template shared by the form checklist head and its rows so the
// View / Entry / Edit / Approve / See-Price columns line up under one another.
// Six columns are sized to fit the modal width with NO horizontal scrollbar.
const FORM_GRID = '1fr 48px 48px 48px 58px 62px';

function roleBadgeClass(role: string): string {
  if (role === 'admin') return 'b-red';
  if (role === 'manager') return 'b-blue';
  if (role === 'operator') return 'b-amber';
  if (role === 'qc') return 'b-cyan';
  return 'b-grey';
}

const ACTION_COLOR: Record<Action, string> = {
  view: 'var(--blue)',
  entry: 'var(--amber)',
  edit: 'var(--green)',
  approve: 'var(--purple)',
  price: 'var(--orange)',
};

// Short column captions. `price` shows as "SEE ₹" so the money column reads at
// a glance without widening the table.
const ACTION_LABEL: Record<Action, string> = {
  view: 'VIEW',
  entry: 'ENTRY',
  edit: 'EDIT',
  approve: 'APPROVE',
  price: 'SEE ₹',
};

const ACTION_HINT: Record<Action, string> = {
  view: 'View = see data',
  entry: 'Entry = create new records',
  edit: 'Edit = change existing records',
  approve: 'Approve = sign off / reject (never your own record)',
  price:
    'Can See Price = see rates, amounts, totals & costs on this form. ' +
    'Click a tier-granted tick to force money OFF for this one form.',
};

export function ConfigureAccessModal({ userId, userName, onClose }: Props): React.JSX.Element {
  const { data, isLoading, isError, error } = useUserAccess(userId);
  // Role + approval limit live on the user record, not the matrix row, so the
  // box loads both and saves both. Reading them here rather than taking them
  // as props keeps the modal correct after an inline edit elsewhere.
  const { data: userDetail } = useUser(userId);
  const save = useSaveUserAccess();
  const updateUser = useUpdateUser(userId);

  const [mainDept, setMainDept] = useState('');
  const [approvalLimit, setApprovalLimit] = useState('');
  const [fullAccess, setFullAccess] = useState(false);
  const [auditor, setAuditor] = useState(false);
  const [departments, setDepartments] = useState<DeptTiers>({});
  const [forms, setForms] = useState<Record<string, FormPerms>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Which department groups are open. UI-only — never saved. Seeded so the
  // departments a person actually has (a tier, or their home dept) start open
  // and the rest start folded, keeping the worksheet short on load.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Set when the server refuses because this save would drop an admin. The
  // box asks, then resends with the flag; it is never sent speculatively.
  const [adminWarning, setAdminWarning] = useState<string | null>(null);
  // JSON matrix clone (AC-1 follow-up): export the current matrix / paste one
  // copied from another user. Replaces the legacy CSV user-import, which does
  // not fit the multi-tenant Supabase Auth model (see docs/PARITY/access-control.md).
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  // Only the approval limit comes from the user record now — the role is
  // derived on save, never read back into an input.
  useEffect(() => {
    if (!userDetail) return;
    setApprovalLimit(userDetail.approvalLimit ?? '');
  }, [userDetail]);

  // Seed once when the matrix loads. The server already normalises pre-0100
  // boolean dept values to a tier key, so nothing legacy reaches this state.
  useEffect(() => {
    if (!data) return;
    setFullAccess(data.fullAccess);
    setAuditor(data.auditor);
    setMainDept(data.mainDept ?? '');
    const tiers = loadDeptTiers(data.departments);
    setDepartments(tiers);
    setForms(fillForms(data.forms));
    setExpanded(defaultExpanded(tiers, data.mainDept ?? ''));
  }, [data]);

  // "Standard" means neither of the two whole-account flags is on, so the
  // per-department tiers below are what count.
  const standard = !fullAccess && !auditor;
  const disabled = !standard;

  function setLevel(level: 'standard' | 'full' | 'auditor'): void {
    setFullAccess(level === 'full');
    setAuditor(level === 'auditor');
  }

  function toggleExpand(key: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Changing the main department moves the seeded tier with it: the old main
  // department is cleared, the new one is seeded at L3. Extras the admin set
  // by hand on OTHER departments are untouched — a Design person given Sales
  // view keeps that Sales view when they move to Production.
  function changeMainDept(next: string): void {
    setDepartments((prev) => {
      const out = { ...prev };
      if (mainDept) delete out[mainDept];
      if (next) out[next] = MAIN_DEPT_DEFAULT_TIER;
      return out;
    });
    setMainDept(next);
    // Open the newly-seeded department so its freshly-granted tier is visible.
    if (next) setExpanded((prev) => new Set(prev).add(next));
  }

  function setDeptTier(key: string, tier: AccessTierKey | ''): void {
    setDepartments((prev) => {
      const next = { ...prev };
      if (tier === '') delete next[key];
      else next[key] = tier;
      return next;
    });
    // Clearing the main department's own row by hand means it is no longer
    // their department. The server drops a main dept it holds no tier in
    // anyway; matching that here keeps the screen honest before Save.
    if (tier === '' && key === mainDept) setMainDept('');
  }

  // What the department tier alone already grants for a form. Money is asked
  // per department, not per tier: Sales / Purchase / Store / Finance see it
  // from L2, every other department only from L3.
  function tierPermsFor(deptKey: string): FormPerms {
    const t = departments[deptKey];
    if (!t) return NO_PERMS;
    return {
      ...tierPermsForDept(deptKey as AccessDeptKey, t),
      priceOff: false,
      viewOff: false,
      entryOff: false,
      editOff: false,
      approveOff: false,
    };
  }

  // How many ticks in a department come from an EXTRA the admin added on top of
  // the tier (not from the tier itself). Drives the "+N" badge on the folded
  // department row so extras are visible without expanding.
  function deptExtraCount(deptKey: string): number {
    const base = tierPermsFor(deptKey);
    let n = 0;
    for (const f of ACCESS_FORMS) {
      if (f.dept !== deptKey) continue;
      const cur = forms[f.key] ?? NO_PERMS;
      const own: FormPerms = {
        view: cur.view || cur.entry || cur.edit || cur.approve,
        entry: cur.entry || cur.edit,
        edit: cur.edit,
        approve: cur.approve,
        price: cur.price && !cur.priceOff,
        priceOff: cur.priceOff,
        viewOff: cur.viewOff,
        entryOff: cur.entryOff,
        editOff: cur.editOff,
        approveOff: cur.approveOff,
      };
      for (const a of ACTIONS) {
        const fromTier =
          fullAccess || (auditor && (a === 'view' || a === 'price')) || base[a];
        if (own[a] && !fromTier) n++;
      }
      // A per-page action switched OFF below the tier is a hand-made change too,
      // and the one easiest to forget — count each removed action (money hide
      // included).
      if (cur.priceOff) n++;
      if (cur.viewOff) n++;
      if (cur.entryOff) n++;
      if (cur.editOff) n++;
      if (cur.approveOff) n++;
    }
    return n;
  }

  // One click on one box. Two worlds meet here:
  //
  // 1. The box's action is GRANTED BY THE TIER (or it is the money column, which
  //    has always worked this way). Then the click is a per-page SUBTRACTION:
  //    flip the OFF switch. Ticked→unticked writes the flag (removed for this
  //    page); unticked→ticked clears it (back to the tier). This is the
  //    single-toggle behaviour rolling out on Purchase — the box just means
  //    "allowed here?", and the resolver works out it is a removal.
  //
  // 2. The tier does NOT grant it. Then the click is the classic ADDITIVE grant,
  //    with the stored cascade: Entry ⇒ View, Edit ⇒ View+Entry, Approve ⇒ View.
  //    Approve never implies Edit — an approver who can also rewrite the document
  //    is not a separate pair of eyes.
  function toggleAction(key: string, action: Action, tierGrants: boolean): void {
    setForms((prev) => {
      const cur = prev[key] ?? { ...NO_PERMS };
      const next: FormPerms = { ...cur };

      // ── World 1: subtract a tier-granted action for this one page ──
      if (tierGrants) {
        const offK = OFF_FIELD[action];
        const turningOff = !cur[offK];
        next[offK] = turningOff;
        // Clear any now-redundant additive grant of the same action so the
        // stored row reads cleanly (the tier already grants it).
        if (turningOff) {
          if (action === 'price') next.price = false;
          else next[action] = false;
        }
        return { ...prev, [key]: next };
      }

      // ── World 2: additive grant above the tier (unchanged) ──
      if (action === 'view') {
        next.view = !cur.view;
      } else if (action === 'entry') {
        next.entry = !cur.entry;
        if (next.entry) next.view = true;
      } else if (action === 'edit') {
        next.edit = !cur.edit;
        if (next.edit) {
          next.view = true;
          next.entry = true;
        }
      } else if (action === 'approve') {
        next.approve = !cur.approve;
        if (next.approve) next.view = true;
      } else {
        next.price = !cur.price;
      }
      return { ...prev, [key]: next };
    });
  }

  // Reset one page back to exactly what the department tier gives — clears every
  // per-page override on it (both the OFF switches and any hand-added grant) by
  // wiping its stored row. The resolver then falls straight through to the tier.
  // This is the one-click undo for "why is this box off/on?" — no need to hunt
  // the exact box that was changed.
  function resetFormToTier(key: string): void {
    setForms((prev) => ({ ...prev, [key]: { ...NO_PERMS } }));
  }

  // Does this page carry any per-page override (an OFF switch or a hand-added
  // grant)? A clean tier-only page stores all-false; anything true is hand-set.
  function formHasOverride(key: string): boolean {
    const p = forms[key];
    if (!p) return false;
    return (
      p.view ||
      p.entry ||
      p.edit ||
      p.approve ||
      p.price ||
      p.priceOff ||
      p.viewOff ||
      p.entryOff ||
      p.editOff ||
      p.approveOff
    );
  }

  // Export the current matrix as a pretty JSON string + copy to clipboard.
  function handleCopyJson(): void {
    const payload = { fullAccess, auditor, mainDept: mainDept || null, departments, forms };
    // confirmAdminChange is an action, not part of a matrix — never cloned.
    const text = JSON.stringify(payload, null, 2);
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopyFlash(true);
        window.setTimeout(() => setCopyFlash(false), 1800);
      },
      () => {
        // Clipboard blocked — fall back to opening the paste box pre-filled so
        // the admin can copy manually.
        setImportText(text);
        setShowImport(true);
      },
    );
  }

  // Parse + validate a pasted matrix and load it into the editor (not saved
  // until the admin clicks Save Access). Unknown form keys are ignored; every
  // known key is filled so the table renders fully. A matrix copied before
  // 0100 still parses — `auditor` and `approve` default to false, and boolean
  // dept values are read as L1.
  function handleApplyJson(): void {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      setImportError('Not valid JSON.');
      return;
    }
    const result = saveUserAccessInputSchema.safeParse(parsed);
    if (!result.success) {
      setImportError(
        'JSON does not match the access-matrix shape (fullAccess / auditor / departments / forms).',
      );
      return;
    }
    const m = result.data;
    setFullAccess(m.fullAccess);
    setAuditor(m.auditor);
    setMainDept(m.mainDept ?? '');
    const tiers = loadDeptTiers(m.departments);
    setDepartments(tiers);
    setForms(fillForms(m.forms));
    setExpanded(defaultExpanded(tiers, m.mainDept ?? ''));
    setShowImport(false);
    setImportText('');
  }

  async function onSave(confirmAdminChange = false): Promise<void> {
    setSubmitError(null);
    if (!confirmAdminChange) setAdminWarning(null);
    try {
      // The approval limit is a user-record field, so it still goes through
      // updateUser; the matrix save follows and derives the role itself.
      const trimmedLimit = approvalLimit.trim();
      const parsedLimit = trimmedLimit === '' ? null : Number(trimmedLimit);
      const limitChanged = userDetail ? trimmedLimit !== (userDetail.approvalLimit ?? '') : false;
      if (limitChanged) {
        await updateUser.mutateAsync({
          approvalLimit: parsedLimit !== null && Number.isNaN(parsedLimit) ? null : parsedLimit,
        });
      }
      // The role is NOT sent — saveUserAccess derives it from this same
      // access, in one transaction, so the two can never drift apart.
      await save.mutateAsync({
        userId,
        input: {
          fullAccess,
          auditor,
          mainDept: mainDept || null,
          confirmAdminChange,
          departments,
          forms,
        },
      });
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Save failed';
      // The server refuses an admin demotion once, with the reason. Surface it
      // as a question rather than an error — the admin may well have meant it.
      if (msg.includes('is an admin')) setAdminWarning(msg);
      else setSubmitError(msg);
    }
  }

  // What role this access will be saved as. Shown, not chosen — the old
  // "tier exceeds role" warning is gone because that contradiction can no
  // longer occur: the role now follows the tiers instead of capping them.
  const derivedRole = roleForAccess({ fullAccess, auditor, departments });
  const grantedCount = Object.keys(departments).length;
  const tierLegend = ACCESS_TIERS.map((t) => `${t.key} ${TIER_SHORT[t.key] ?? t.label}`).join(' · ');

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '4vh 16px',
        zIndex: 60,
      }}
    >
      <div
        className="panel"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflow: 'auto', marginBottom: 0 }}
      >
        {/* ── Header strip: user · role · home dept · PO limit · JSON clone ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            padding: '10px 14px',
            borderBottom: '1px solid var(--border)',
            background: 'linear-gradient(180deg, var(--bg3), var(--bg2))',
            position: 'sticky',
            top: 0,
            zIndex: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="fw-700" style={{ fontSize: 14 }}>
              🔒 Access Control
            </span>
            <span className="fw-700" style={{ fontSize: 13 }}>
              {userName}
            </span>
            <span
              className={`badge ${roleBadgeClass(derivedRole)}`}
              title="System role — worked out from the departments below, not chosen. This is the word the server checks on every save."
            >
              {derivedRole}
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                Home dept
              </span>
              <select
                className="innovic-select"
                value={mainDept}
                disabled={disabled}
                onChange={(e) => changeMainDept(e.target.value)}
                title="Sets this department to L3 Editor / Executor. Change the level, or add other departments, below."
                style={{ fontSize: 12, fontWeight: 700, width: 130, padding: '5px 8px' }}
              >
                <option value="">— none —</option>
                {ACCESS_DEPTS.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Moved here from User Management: the PO approval ceiling is an
                approval right, and approval is an Access Control action now. */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>
                PO limit ₹
              </span>
              <input
                className="innovic-input"
                type="number"
                min={0}
                step={1000}
                autoComplete="off"
                placeholder="e.g. 100000"
                disabled={fullAccess}
                value={approvalLimit}
                onChange={(e) => setApprovalLimit(e.target.value)}
                title={
                  fullAccess
                    ? 'Super Admin approves any amount.'
                    : 'Blank = use the company limit from System Settings → Approvals.'
                }
                style={{ fontSize: 12, width: 110, padding: '5px 8px' }}
              />
            </label>

            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopyJson}>
                <Copy size={13} /> {copyFlash ? 'Copied ✓' : 'Copy JSON'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowImport((v) => !v);
                  setImportError(null);
                }}
              >
                <ClipboardPaste size={13} /> Paste JSON
              </button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <div className="empty-state" style={{ padding: 40 }}>
            <Loader2 className="inline h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="empty-state" style={{ padding: 40, color: 'var(--red)' }}>
            {error instanceof Error ? error.message : 'Failed to load matrix'}
          </div>
        ) : (
          <div style={{ padding: 14 }}>
            {showImport ? (
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  background: 'var(--bg3)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                }}
              >
                <div className="text3" style={{ fontSize: 10, marginBottom: 6 }}>
                  Clone permissions from another user — copy there, paste here, then Save.
                </div>
                <textarea
                  className="innovic-input"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"fullAccess":false,"auditor":false,"mainDept":"design","departments":{"design":"L3"},"forms":{...}}'
                  rows={5}
                  style={{ width: '100%', fontFamily: 'var(--mono)', fontSize: 11 }}
                />
                {importError ? (
                  <div style={{ marginTop: 6, color: 'var(--red)', fontSize: 11 }}>
                    {importError}
                  </div>
                ) : null}
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setShowImport(false);
                      setImportError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleApplyJson}
                    disabled={!importText.trim()}
                  >
                    Apply to editor
                  </button>
                </div>
              </div>
            ) : null}

            {/* ── Access level: Standard / L6 / L7 ── */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                flexWrap: 'wrap',
                marginBottom: 14,
              }}
            >
              <span className="form-label" style={{ margin: 0 }}>
                Access level
              </span>
              <Seg
                value={standard ? 'standard' : fullAccess ? 'full' : 'auditor'}
                onChange={(v) => setLevel(v as 'standard' | 'full' | 'auditor')}
                options={[
                  {
                    value: 'standard',
                    label: 'Standard',
                    title: 'Set a tier per department below.',
                  },
                  {
                    value: 'full',
                    label: 'L6 Super Admin',
                    title: 'Everything, everywhere — ignores everything below.',
                  },
                  {
                    value: 'auditor',
                    label: 'L7 Auditor',
                    title: 'Reads every department. Saves nothing, anywhere.',
                  },
                ]}
              />
              <span className="text3" style={{ fontSize: 11 }}>
                {standard
                  ? 'Set a tier per department below'
                  : fullAccess
                    ? 'Everything, everywhere — the worksheet below is ignored'
                    : 'Reads every department, writes nothing'}
              </span>
              <span className="text3" style={{ fontSize: 11, marginLeft: 'auto', fontFamily: 'var(--mono)' }}>
                {grantedCount} of {ACCESS_DEPTS.length} departments granted
              </span>
            </div>

            {/* ── Department worksheet ── */}
            <div
              style={{
                border: '1px solid var(--border)',
                borderRadius: 8,
                overflow: 'hidden',
                opacity: disabled ? 0.55 : 1,
              }}
            >
              {/* Column header — DEPARTMENT | TIER (legend) | EXTRA */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '6px 12px',
                  background: 'var(--bg3)',
                  borderBottom: '1px solid var(--border2)',
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.08em',
                    color: 'var(--text3)',
                    minWidth: 190,
                  }}
                >
                  DEPARTMENT
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: '0.06em', color: 'var(--text3)', flex: 1 }}
                >
                  TIER — {tierLegend}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--text3)' }}
                >
                  EXTRA
                </span>
              </div>

              {ACCESS_DEPTS.map((d) => {
                const tier = departments[d.key] ?? '';
                const isMain = d.key === mainDept;
                const isOpen = expanded.has(d.key);
                const extras = deptExtraCount(d.key);
                const deptForms = ACCESS_FORMS.filter((f) => f.dept === d.key);
                return (
                  <div key={d.key} style={{ borderTop: '1px solid var(--border)' }}>
                    {/* Department row: caret + name + tier segments + extra */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '7px 12px',
                        background: 'var(--bg2)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => toggleExpand(d.key)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${d.label}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          minWidth: 190,
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          padding: 0,
                          textAlign: 'left',
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown size={14} color="var(--text3)" />
                        ) : (
                          <ChevronRight size={14} color="var(--text3)" />
                        )}
                        <span style={{ color: d.color, fontWeight: 700, fontSize: 13 }}>
                          {d.label}
                        </span>
                        {isMain ? (
                          <span className="tag" style={{ color: 'var(--amber2)', background: 'var(--amber3)' }}>
                            HOME
                          </span>
                        ) : null}
                      </button>

                      <div style={{ flex: 1 }}>
                        <Seg
                          value={tier}
                          onChange={(v) => setDeptTier(d.key, v as AccessTierKey | '')}
                          disabled={disabled}
                          options={[
                            { value: '', label: 'None', title: 'No access to this department.' },
                            ...ACCESS_TIERS.map((t) => ({
                              value: t.key,
                              label: t.key,
                              title: `${t.key} ${t.label} — ${t.hint}`,
                            })),
                          ]}
                        />
                      </div>

                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          minWidth: 26,
                          textAlign: 'right',
                          color: extras > 0 ? 'var(--blue)' : 'var(--text3)',
                        }}
                        title={extras > 0 ? `${extras} extra right(s) on top of the tier` : 'No extras beyond the tier'}
                      >
                        {extras > 0 ? `+${extras}` : '—'}
                      </span>
                    </div>

                    {/* Form / feature checklist for this department */}
                    {isOpen ? (
                      <div style={{ background: 'var(--bg3)', borderTop: '1px solid var(--border)' }}>
                        {/* Money starts at a different level depending on the
                            department, so say which one applies here rather
                            than making the admin remember the rule. */}
                        <div
                          style={{
                            padding: '5px 12px 5px 30px',
                            fontSize: 10,
                            color: 'var(--text3)',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <span style={{ color: 'var(--orange2)', fontWeight: 700 }}>
                            ₹ from {priceStartTier(d.key)}
                          </span>{' '}
                          — in {d.label}, prices show from {priceStartTier(d.key)} upwards.
                          {priceStartTier(d.key) === 'L3'
                            ? ' L2 here is data entry only and sees no money.'
                            : ' This department works with the money itself.'}{' '}
                          Click a ticked ₹ box to hide money on that one form.
                          {OFF_SWITCH_DEPTS.includes(d.key) ? (
                            <>
                              {' '}
                              <span style={{ color: 'var(--blue)', fontWeight: 700 }}>
                                Per-page switches:
                              </span>{' '}
                              untick any box to remove that action for one page. A{' '}
                              <span style={{ color: 'var(--text2)', fontWeight: 700 }}>grey dot</span> marks
                              a box switched off here, a{' '}
                              <span style={{ color: 'var(--blue)', fontWeight: 700 }}>blue dot</span> one
                              added above the tier; a plain box is just the tier. Untick{' '}
                              <strong>View</strong> to hide the whole page, or use{' '}
                              <strong>↺ tier</strong> to reset a page.
                            </>
                          ) : null}
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: FORM_GRID,
                            padding: '4px 12px 4px 30px',
                            borderBottom: '1px solid var(--border)',
                          }}
                        >
                          <span
                            className="mono"
                            style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--text3)' }}
                          >
                            FORM / FEATURE
                          </span>
                          {ACTIONS.map((a) => (
                            <span
                              key={a}
                              className="mono"
                              title={ACTION_HINT[a]}
                              style={{
                                fontSize: 9,
                                letterSpacing: '0.06em',
                                color: a === 'price' ? 'var(--orange2)' : 'var(--text3)',
                                textAlign: 'center',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {a === 'price' ? (
                                <>
                                  SEE{' '}
                                  <span
                                    style={{
                                      fontSize: 14,
                                      fontWeight: 800,
                                      color: 'var(--orange)',
                                      verticalAlign: 'middle',
                                    }}
                                  >
                                    ₹
                                  </span>
                                </>
                              ) : (
                                ACTION_LABEL[a]
                              )}
                            </span>
                          ))}
                        </div>

                        {deptForms.map((f, i) => {
                          const cur = forms[f.key] ?? { ...NO_PERMS };
                          const base = tierPermsFor(f.dept);
                          const deptTierKey = departments[f.dept];
                          // Displayed state = own ticks after cascade, unioned
                          // with whatever the department tier already gives.
                          const own: FormPerms = {
                            view: cur.view || cur.entry || cur.edit || cur.approve,
                            entry: cur.entry || cur.edit,
                            edit: cur.edit,
                            approve: cur.approve,
                            price: cur.price,
                            priceOff: cur.priceOff,
                            viewOff: cur.viewOff,
                            entryOff: cur.entryOff,
                            editOff: cur.editOff,
                            approveOff: cur.approveOff,
                          };
                          // On an OFF-switch department every box is a single
                          // toggle against the tier; elsewhere only money is.
                          const offDept = OFF_SWITCH_DEPTS.includes(f.dept);
                          // "Hide page" cascades in the UI too: with View removed,
                          // the other four boxes read as off and are not clickable.
                          const pageHidden = offDept && cur.viewOff === true;
                          return (
                            <div
                              key={f.key}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: FORM_GRID,
                                alignItems: 'center',
                                padding: '4px 12px 4px 30px',
                                background: i % 2 ? 'var(--bg3)' : 'var(--bg2)',
                              }}
                            >
                              <span
                                style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}
                              >
                                {f.label}
                                {/* One-click undo: clear every per-page override on
                                    this page and fall back to the tier. Shown only
                                    when the page actually carries an override. */}
                                {!disabled && formHasOverride(f.key) ? (
                                  <button
                                    type="button"
                                    onClick={() => resetFormToTier(f.key)}
                                    title="Reset this page to the department tier (clears every per-page change on it)"
                                    aria-label={`Reset ${f.label} to the department tier`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      padding: '1px 5px',
                                      fontSize: 10,
                                      fontFamily: 'var(--mono)',
                                      color: 'var(--text3)',
                                      background: 'transparent',
                                      border: '1px solid var(--border2)',
                                      borderRadius: 'var(--radius)',
                                      cursor: 'pointer',
                                    }}
                                  >
                                    <RotateCcw size={11} /> tier
                                  </button>
                                ) : null}
                              </span>
                              {ACTIONS.map((action) => {
                                const isPrice = action === 'price';
                                // Does the department TIER grant this action?
                                // (Money follows tierSeesPrice, already folded
                                // into `base.price`.)
                                const tierGrants =
                                  fullAccess ||
                                  (auditor && (action === 'view' || isPrice)) ||
                                  base[action];
                                // Which actions behave as a single per-page toggle
                                // against the tier: money everywhere (long-standing),
                                // everything on an OFF-switch department.
                                const offCapable = isPrice || offDept;
                                // Removed for this page = the OFF flag is set AND
                                // the tier actually grants it (nothing to remove
                                // otherwise).
                                const removed = tierGrants && cur[OFF_FIELD[action]] === true;
                                // Added above the tier = a hand tick where the tier
                                // gives nothing.
                                const added = !tierGrants && own[action];
                                // With the page hidden, the non-View boxes are
                                // forced off and not clickable.
                                const forcedByHide = pageHidden && action !== 'view';
                                // Locked: non-standard access levels lock the lot;
                                // a tier-granted box stays locked ONLY where it is
                                // not off-capable (the classic grey tick).
                                const locked =
                                  disabled ||
                                  fullAccess ||
                                  forcedByHide ||
                                  (tierGrants && !offCapable);
                                const checked =
                                  !forcedByHide && !removed && (tierGrants || own[action]);
                                // A quiet neutral cue — NOT the old red ✕ — on any box
                                // that differs from the tier, so "off on purpose" never
                                // looks like "off by default". Grey dot = switched off
                                // for this page (money-hide included, any department);
                                // blue dot = added above the tier (OFF-switch depts).
                                // A plain empty box is just the tier — no dot.
                                const marker = removed ? 'removed' : added && offDept ? 'added' : null;
                                return (
                                  <span key={action} style={{ textAlign: 'center' }}>
                                    <input
                                      type="checkbox"
                                      disabled={locked}
                                      checked={checked}
                                      onChange={() => toggleAction(f.key, action, tierGrants)}
                                      title={
                                        forcedByHide
                                          ? 'Page is hidden (View removed). Tick View to use this page again.'
                                          : removed
                                            ? isPrice
                                              ? 'Money hidden on this page. Click to show it again.'
                                              : `Removed for this page. Click to restore what the ${f.dept} tier (${deptTierKey}) grants.`
                                            : offCapable && tierGrants && deptTierKey && !disabled
                                              ? isPrice
                                                ? `Shown by the ${f.dept} level (${deptTierKey}) — click to hide money on this page only`
                                                : `Granted by the ${f.dept} tier (${deptTierKey}) — click to remove it on this page only`
                                              : added
                                                ? 'Added for this page, above the tier. Click to remove.'
                                                : tierGrants && deptTierKey && !disabled
                                                  ? `Granted by the ${f.dept} tier (${deptTierKey})`
                                                  : ACTION_HINT[action]
                                      }
                                      style={{
                                        width: 16,
                                        height: 16,
                                        accentColor: ACTION_COLOR[action],
                                      }}
                                    />
                                    {marker ? (
                                      <span
                                        aria-hidden
                                        title={
                                          marker === 'removed'
                                            ? 'Switched off for this page'
                                            : 'Added above the tier for this page'
                                        }
                                        style={{
                                          display: 'inline-block',
                                          width: 6,
                                          height: 6,
                                          borderRadius: '50%',
                                          marginLeft: 3,
                                          verticalAlign: 'middle',
                                          background:
                                            marker === 'removed' ? 'var(--text3)' : 'var(--blue)',
                                        }}
                                      />
                                    ) : null}
                                  </span>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {adminWarning ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '10px 12px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                  color: 'var(--amber)',
                  fontSize: 12,
                }}
              >
                <div style={{ marginBottom: 8 }}>⚠ {adminWarning}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setAdminWarning(null)}
                  >
                    Cancel — keep them an admin
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void onSave(true)}
                    disabled={save.isPending}
                  >
                    Yes, remove their admin rights
                  </button>
                </div>
              </div>
            ) : null}

            {submitError ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'var(--red3)',
                  border: '1px solid var(--red)',
                  borderRadius: 6,
                  color: 'var(--red)',
                  fontSize: 12,
                }}
              >
                {submitError}
              </div>
            ) : null}

            {/* Footer — helper + actions */}
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span className="text3" style={{ fontSize: 11 }}>
                Tier grants the grey ticks; extra ticks add rights on top of it. To take a right
                away, lower the tier.
              </span>
              <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={save.isPending || updateUser.isPending}
                  onClick={() => void onSave(false)}
                >
                  {save.isPending || updateUser.isPending ? (
                    <>
                      <Loader2 className="inline h-3 w-3 animate-spin" /> Saving…
                    </>
                  ) : (
                    'Save Access'
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── helpers ───────────────────────────────────────────────────────

// Collapse whatever the wire sent (tier keys, or pre-0100 booleans) into
// dept → tier. `true` reads as L1, matching the shared normaliser.
function loadDeptTiers(m: Record<string, boolean | AccessTierKey>): DeptTiers {
  const out: DeptTiers = {};
  for (const [k, v] of Object.entries(m)) {
    if (v === true) out[k] = 'L1';
    else if (typeof v === 'string') out[k] = v;
  }
  return out;
}

// Departments that start expanded: the ones with a tier, plus the home
// department (so a just-picked home dept's seed is visible). UI-only.
function defaultExpanded(tiers: DeptTiers, main: string): Set<string> {
  const out = new Set<string>();
  for (const d of ACCESS_DEPTS) {
    if (tiers[d.key] || d.key === main) out.add(d.key);
  }
  return out;
}

// Every known form key present, so the table renders fully and a save never
// silently drops a row the admin never touched.
function fillForms(m: Record<string, AccessFormPerms>): Record<string, FormPerms> {
  const filled: Record<string, FormPerms> = {};
  for (const f of ACCESS_FORMS) {
    const existing = m[f.key];
    filled[f.key] = existing ? { ...NO_PERMS, ...existing } : emptyFormPerms();
  }
  return filled;
}

// Segmented pill control — one visible choice per option, active filled blue.
// Used for the access level and each department's tier. A level is a single
// choice, so segments (not checkboxes) is the honest control.
function Seg({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: string; label: string; title?: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'inline-flex',
        border: '1px solid var(--border2)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        background: 'var(--bg2)',
      }}
    >
      {options.map((o, i) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            style={{
              padding: '4px 12px',
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--mono)',
              border: 'none',
              borderLeft: i ? '1px solid var(--border2)' : 'none',
              background: active ? 'var(--blue)' : 'transparent',
              color: active ? 'var(--bg2)' : 'var(--text2)',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled && !active ? 0.5 : 1,
              transition: 'background .12s',
              whiteSpace: 'nowrap',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
