// Configure-access modal — per-user permissions editor.
//
// This is now the ONLY place a user's role and PO approval limit are set.
// Both left User Management, which handles identity (name, email, password,
// phone, active) and nothing else. Role and limit are access decisions, and
// splitting them across two screens meant "what can this person do?" had two
// half-answers and no whole one.
//
// Rebuilt for the (Tier + Department) model (0100). Structure:
//  - Header strip: user name + role select + PO approval limit
//  - Access level: Standard / L6 Super Admin / L7 Auditor
//  - Department tiers: one tier dropdown per department (L1…L5, or none)
//  - Form/Feature table (39 rows × View/Entry/Edit/Approve) — EXTRAS on top
//    of the department tier. A right the tier already grants shows ticked and
//    locked, with the tier named, so it is obvious where it came from.
//
// Why tiers came in as a dropdown rather than more checkboxes: the checklist
// asks for one named level per department, and a level is a single choice.
// Four loose checkboxes per department would let an admin build "edit but not
// view", which is not a tier and cannot be enforced coherently downstream.
//
// On save: if the role changed, fire useUpdateUser FIRST (legacy L13996),
// then save the access matrix. Both succeed or modal stays open with error.

import {
  ACCESS_DEPTS,
  ACCESS_FORMS,
  ACCESS_TIERS,
  USER_ROLES,
  accessTier,
  emptyFormPerms,
  maxTierForRole,
  saveUserAccessInputSchema,
  tierExceedsRole,
  type AccessFormPerms,
  type AccessTierKey,
  type UserRole,
} from '@innovic/shared';
import { ClipboardPaste, Copy, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdateUser, useUser } from '@/modules/users/api';
import { RoleCeilingHelp } from '@/modules/users/components/role-ceiling-help';
import { useSaveUserAccess, useUserAccess } from '../api';

interface Props {
  userId: string;
  userName: string;
  onClose: () => void;
}

type FormPerms = AccessFormPerms;
type DeptTiers = Record<string, AccessTierKey>;
type Action = 'view' | 'entry' | 'edit' | 'approve';

const NO_PERMS: FormPerms = { view: false, entry: false, edit: false, approve: false };

const ACTION_COLOR: Record<Action, string> = {
  view: 'var(--blue)',
  entry: 'var(--amber)',
  edit: 'var(--green)',
  approve: 'var(--purple)',
};

export function ConfigureAccessModal({ userId, userName, onClose }: Props): React.JSX.Element {
  const { data, isLoading, isError, error } = useUserAccess(userId);
  // Role + approval limit live on the user record, not the matrix row, so the
  // box loads both and saves both. Reading them here rather than taking them
  // as props keeps the modal correct after an inline edit elsewhere.
  const { data: userDetail } = useUser(userId);
  const save = useSaveUserAccess();
  const updateUser = useUpdateUser(userId);

  const [role, setRole] = useState<UserRole>('viewer');
  const [approvalLimit, setApprovalLimit] = useState('');
  const [fullAccess, setFullAccess] = useState(false);
  const [auditor, setAuditor] = useState(false);
  const [departments, setDepartments] = useState<DeptTiers>({});
  const [forms, setForms] = useState<Record<string, FormPerms>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // JSON matrix clone (AC-1 follow-up): export the current matrix / paste one
  // copied from another user. Replaces the legacy CSV user-import, which does
  // not fit the multi-tenant Supabase Auth model (see docs/PARITY/access-control.md).
  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState(false);

  // Seed role + limit once the user record resolves.
  useEffect(() => {
    if (!userDetail) return;
    setRole(userDetail.role);
    setApprovalLimit(userDetail.approvalLimit ?? '');
  }, [userDetail]);

  // Seed once when the matrix loads. The server already normalises pre-0100
  // boolean dept values to a tier key, so nothing legacy reaches this state.
  useEffect(() => {
    if (!data) return;
    setFullAccess(data.fullAccess);
    setAuditor(data.auditor);
    setDepartments(loadDeptTiers(data.departments));
    setForms(fillForms(data.forms));
  }, [data]);

  // "Standard" means neither of the two whole-account flags is on, so the
  // per-department tiers below are what count.
  const standard = !fullAccess && !auditor;
  const disabled = !standard;

  function setLevel(level: 'standard' | 'full' | 'auditor'): void {
    setFullAccess(level === 'full');
    setAuditor(level === 'auditor');
  }

  function setDeptTier(key: string, tier: AccessTierKey | ''): void {
    setDepartments((prev) => {
      const next = { ...prev };
      if (tier === '') delete next[key];
      else next[key] = tier;
      return next;
    });
  }

  // What the department tier alone already grants for a form.
  function tierPermsFor(deptKey: string): FormPerms {
    const t = departments[deptKey];
    return t ? { ...accessTier(t).perms } : NO_PERMS;
  }

  // Action toggles mirror the stored cascade: Entry ⇒ View, Edit ⇒ View+Entry,
  // Approve ⇒ View. Approve deliberately does NOT imply Edit — an approver who
  // can also rewrite the document is not a separate pair of eyes.
  function toggleAction(key: string, action: Action): void {
    setForms((prev) => {
      const cur = prev[key] ?? { ...NO_PERMS };
      const next: FormPerms = { ...cur };
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
      } else {
        next.approve = !cur.approve;
        if (next.approve) next.view = true;
      }
      return { ...prev, [key]: next };
    });
  }

  // Export the current matrix as a pretty JSON string + copy to clipboard.
  function handleCopyJson(): void {
    const payload = { fullAccess, auditor, departments, forms };
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
    setDepartments(loadDeptTiers(m.departments));
    setForms(fillForms(m.forms));
    setShowImport(false);
    setImportText('');
  }

  async function onSave(): Promise<void> {
    setSubmitError(null);
    try {
      // Role + limit go FIRST (legacy L13996 ordering). If the role change is
      // refused — self-demotion is — the matrix is left untouched rather than
      // saved against a role that never moved.
      const trimmedLimit = approvalLimit.trim();
      const parsedLimit = trimmedLimit === '' ? null : Number(trimmedLimit);
      const roleChanged = userDetail ? role !== userDetail.role : false;
      const limitChanged = userDetail ? trimmedLimit !== (userDetail.approvalLimit ?? '') : false;
      if (roleChanged || limitChanged) {
        await updateUser.mutateAsync({
          role,
          approvalLimit: parsedLimit !== null && Number.isNaN(parsedLimit) ? null : parsedLimit,
        });
      }
      await save.mutateAsync({
        userId,
        input: { fullAccess, auditor, departments, forms },
      });
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  // Tiers the chosen role cannot actually deliver — the matrix would say yes
  // and the database would still say no. Warn, never block: an admin may set
  // the tier first and fix the role after.
  const overreaching = Object.entries(departments).flatMap(([deptKey, tier]) => {
    if (!tierExceedsRole(tier, role)) return [];
    const label = ACCESS_DEPTS.find((d) => d.key === deptKey)?.label ?? deptKey;
    return [`${label} ${tier}`];
  });

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
        style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div className="fw-700">🔒 Access Control — {userName}</div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={14} />
          </button>
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
          <div style={{ padding: 16 }}>
            {/* Header strip — user + role */}
            <div
              style={{
                marginBottom: 14,
                padding: '10px 14px',
                background: 'var(--bg3)',
                borderRadius: 8,
                border: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: 220, flex: 1 }}>
                <b style={{ fontSize: 14 }}>{userName}</b>
                <div className="text3" style={{ fontSize: 10, marginTop: 2 }}>
                  Role is the ceiling — it decides what the database will accept. Tier decides
                  how much of that ceiling this person actually gets. Highest tier this role can
                  deliver: <b>{maxTierForRole(role)}</b>.
                </div>
                <RoleCeilingHelp role={role} />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                <div className="form-grp" style={{ margin: 0 }}>
                  <label className="form-label" htmlFor="cfg-role" style={{ fontSize: 11 }}>
                    Role
                  </label>
                  <select
                    id="cfg-role"
                    className="innovic-select"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                    style={{ fontSize: 12, fontWeight: 700 }}
                  >
                    {USER_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                {/* Moved here from User Management: the PO approval ceiling is
                    an approval right, and approval is an Access Control action
                    now. Leaving it on the identity screen split one decision
                    across two places. */}
                <div className="form-grp" style={{ margin: 0, width: 170 }}>
                  <label className="form-label" htmlFor="cfg-limit" style={{ fontSize: 11 }}>
                    PO approval limit (₹)
                  </label>
                  <input
                    id="cfg-limit"
                    className="innovic-input"
                    type="number"
                    min={0}
                    step={1000}
                    autoComplete="off"
                    placeholder="e.g. 100000"
                    disabled={role === 'admin'}
                    value={approvalLimit}
                    onChange={(e) => setApprovalLimit(e.target.value)}
                    style={{ fontSize: 12 }}
                  />
                  <div className="form-help" style={{ fontSize: 10 }}>
                    {role === 'admin'
                      ? 'Admin approves any amount.'
                      : 'Blank = use the company limit from System Settings → Approvals.'}
                  </div>
                </div>
              </div>
            </div>

            {/* Matrix clone toolbar — export current as JSON / paste another */}
            <div
              style={{
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <button type="button" className="btn btn-ghost btn-sm" onClick={handleCopyJson}>
                <Copy size={13} /> {copyFlash ? 'Copied ✓' : 'Copy matrix as JSON'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowImport((v) => !v);
                  setImportError(null);
                }}
              >
                <ClipboardPaste size={13} /> Paste matrix JSON
              </button>
              <span className="text3" style={{ fontSize: 10 }}>
                Clone permissions from another user — copy here, paste there, then Save.
              </span>
            </div>

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
                <textarea
                  className="innovic-input"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='{"fullAccess":false,"auditor":false,"departments":{"sales":"L3"},"forms":{...}}'
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

            {/* Access level — Standard / L6 / L7 */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', marginBottom: 8 }}
              >
                🎚️ ACCESS LEVEL
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <LevelChip
                  checked={standard}
                  onSelect={() => setLevel('standard')}
                  color="var(--blue)"
                  title="Standard"
                  hint="Set a tier per department below"
                />
                <LevelChip
                  checked={fullAccess}
                  onSelect={() => setLevel('full')}
                  color="var(--green)"
                  title="L6 Super Admin"
                  hint="Everything, everywhere — ignores everything below"
                />
                <LevelChip
                  checked={auditor}
                  onSelect={() => setLevel('auditor')}
                  color="var(--amber)"
                  title="L7 Auditor"
                  hint="Reads every department. Saves nothing, anywhere."
                />
              </div>
            </div>

            {/* Department tiers */}
            <div style={{ marginBottom: 16, opacity: disabled ? 0.55 : 1 }}>
              <div
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}
              >
                🏢 DEPARTMENT TIERS
              </div>
              <div className="text3" style={{ fontSize: 10, marginBottom: 8 }}>
                One level per department. A person can hold different levels in different
                departments — L3 in Sales and L1 in Store is one user, not two accounts.
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                  gap: 8,
                }}
              >
                {ACCESS_DEPTS.map((d) => {
                  const tier = departments[d.key] ?? '';
                  const over = tier ? tierExceedsRole(tier, role) : false;
                  return (
                    <div
                      key={d.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 10px',
                        background: 'var(--bg4)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                      }}
                    >
                      <span
                        style={{ color: d.color, fontWeight: 600, fontSize: 12, minWidth: 84 }}
                      >
                        {d.label}
                      </span>
                      <select
                        className="innovic-select"
                        disabled={disabled}
                        value={tier}
                        onChange={(e) => setDeptTier(d.key, e.target.value as AccessTierKey | '')}
                        style={{ fontSize: 11, flex: 1 }}
                      >
                        <option value="">— no access —</option>
                        {ACCESS_TIERS.map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.key} {t.label}
                          </option>
                        ))}
                      </select>
                      {over ? (
                        <span
                          title={`Role "${role}" tops out at ${maxTierForRole(role)}`}
                          style={{ color: 'var(--amber)', fontSize: 13 }}
                        >
                          ⚠
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="text3" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.5 }}>
                {ACCESS_TIERS.map((t) => (
                  <div key={t.key}>
                    <b>
                      {t.key} {t.label}
                    </b>{' '}
                    — {t.hint}
                  </div>
                ))}
              </div>
            </div>

            {overreaching.length > 0 ? (
              <div
                style={{
                  marginBottom: 14,
                  padding: '8px 12px',
                  background: 'var(--bg3)',
                  border: '1px solid var(--amber)',
                  borderRadius: 6,
                  color: 'var(--amber)',
                  fontSize: 11,
                }}
              >
                ⚠ The role <b>{role}</b> tops out at <b>{maxTierForRole(role)}</b>, so{' '}
                <b>{overreaching.join(', ')}</b> will not take effect until the role is raised.
                The tier still saves — change the role above when you are ready.
              </div>
            ) : null}

            {/* Form / Feature table */}
            <div>
              <div
                style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}
              >
                📝 FORM / FEATURE EXTRAS
              </div>
              <div className="text3" style={{ fontSize: 10, marginBottom: 8 }}>
                💡 <b>View</b> = see data | <b>Entry</b> = create new records | <b>Edit</b> =
                change existing records | <b>Approve</b> = sign off / reject (never your own
                record). Ticks here <b>add</b> to the department tier — a locked, greyed tick is
                one the tier already granted. To take a right away, lower the tier.
              </div>
              <table className="innovic-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Form / Feature</th>
                    <th style={{ width: 130 }}>Department</th>
                    <th className="td-ctr" style={{ width: 56 }}>
                      View
                    </th>
                    <th className="td-ctr" style={{ width: 56, color: 'var(--amber)' }}>
                      Entry
                    </th>
                    <th className="td-ctr" style={{ width: 56 }}>
                      Edit
                    </th>
                    <th className="td-ctr" style={{ width: 66, color: 'var(--cyan)' }}>
                      Approve
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_FORMS.map((f) => {
                    const cur = forms[f.key] ?? { ...NO_PERMS };
                    const base = tierPermsFor(f.dept);
                    const deptTierKey = departments[f.dept];
                    // Displayed state = own ticks after cascade, unioned with
                    // whatever the department tier already gives.
                    const own: FormPerms = {
                      view: cur.view || cur.entry || cur.edit || cur.approve,
                      entry: cur.entry || cur.edit,
                      edit: cur.edit,
                      approve: cur.approve,
                    };
                    return (
                      <tr key={f.key}>
                        <td style={{ fontSize: 12 }}>{f.label}</td>
                        <td style={{ fontSize: 11 }}>
                          <span className="text3">{f.dept}</span>
                          {deptTierKey ? (
                            <span
                              className="badge b-grey"
                              style={{ marginLeft: 5, fontSize: 9 }}
                              title={accessTier(deptTierKey).hint}
                            >
                              {deptTierKey}
                            </span>
                          ) : null}
                        </td>
                        {(['view', 'entry', 'edit', 'approve'] as const).map((action) => {
                          const fromTier =
                            fullAccess || (auditor && action === 'view') || base[action];
                          return (
                            <td key={action} className="td-ctr">
                              <input
                                type="checkbox"
                                disabled={disabled || fromTier}
                                checked={fromTier || own[action]}
                                onChange={() => toggleAction(f.key, action)}
                                title={
                                  fromTier && deptTierKey && !disabled
                                    ? `Granted by the ${f.dept} tier (${deptTierKey})`
                                    : undefined
                                }
                                style={{
                                  width: 16,
                                  height: 16,
                                  accentColor: ACTION_COLOR[action],
                                }}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {submitError ? (
              <div
                style={{
                  marginTop: 12,
                  padding: '8px 12px',
                  background: 'rgba(239,68,68,0.06)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6,
                  color: 'var(--red)',
                  fontSize: 12,
                }}
              >
                {submitError}
              </div>
            ) : null}

            <div
              style={{
                marginTop: 14,
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 8,
              }}
            >
              <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={save.isPending || updateUser.isPending}
                onClick={() => void onSave()}
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

function LevelChip({
  checked,
  onSelect,
  color,
  title,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  color: string;
  title: string;
  hint: string;
}): React.JSX.Element {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '8px 12px',
        background: 'var(--bg4)',
        border: `1px solid ${checked ? color : 'var(--border)'}`,
        borderRadius: 6,
        cursor: 'pointer',
        flex: '1 1 240px',
      }}
    >
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        style={{ accentColor: color, marginTop: 2 }}
      />
      <span>
        <span style={{ color, fontWeight: 700, fontSize: 12 }}>{title}</span>
        <span className="text3" style={{ display: 'block', fontSize: 10 }}>
          {hint}
        </span>
      </span>
    </label>
  );
}
