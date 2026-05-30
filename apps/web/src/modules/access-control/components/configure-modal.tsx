// Configure-access modal — per-user permissions editor.
//
// Mirrors legacy `_editAccess` (HTML L13917):
//  - Header strip: user name + role select (inline edit)
//  - Full Access checkbox (green panel; ON disables all controls below)
//  - Department chips (9, colour-coded)
//  - Form/Feature table (39 rows × View/Entry/Edit)
//  - Save button → cascade View⊆Entry⊆Edit + persist
//
// On save: if the role changed, fire useUpdateUser FIRST (legacy L13996),
// then save the access matrix. Both succeed or modal stays open with error.

import {
  ACCESS_DEPTS,
  ACCESS_FORMS,
  USER_ROLES,
  type AccessFormPerms,
  type UserRole,
} from '@innovic/shared';
import { Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdateUser } from '@/modules/users/api';
import { useSaveUserAccess, useUserAccess } from '../api';

interface Props {
  userId: string;
  userName: string;
  userRole: UserRole;
  onClose: () => void;
}

type FormPerms = AccessFormPerms;

function emptyPerms(): FormPerms {
  return { view: false, entry: false, edit: false };
}

export function ConfigureAccessModal({
  userId,
  userName,
  userRole: initialRole,
  onClose,
}: Props): React.JSX.Element {
  const { data, isLoading, isError, error } = useUserAccess(userId);
  const save = useSaveUserAccess();
  const updateUser = useUpdateUser(userId);

  const [role, setRole] = useState<UserRole>(initialRole);
  const [fullAccess, setFullAccess] = useState(false);
  const [departments, setDepartments] = useState<Record<string, boolean>>({});
  const [forms, setForms] = useState<Record<string, FormPerms>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Seed once when the matrix loads.
  useEffect(() => {
    if (!data) return;
    setFullAccess(data.fullAccess);
    setDepartments({ ...data.departments });
    const filled: Record<string, FormPerms> = {};
    for (const f of ACCESS_FORMS) {
      const existing = data.forms[f.key];
      filled[f.key] = existing ? { ...existing } : emptyPerms();
    }
    setForms(filled);
  }, [data]);

  const disabled = fullAccess;

  function toggleDept(key: string): void {
    setDepartments((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  // Action toggles mirror legacy's up-cascade: Entry ⇒ View, Edit ⇒ View+Entry.
  // No down-cascade (matches legacy save handler L13981-13989).
  function toggleAction(key: string, action: 'view' | 'entry' | 'edit'): void {
    setForms((prev) => {
      const cur = prev[key] ?? emptyPerms();
      const next: FormPerms = { ...cur };
      if (action === 'view') {
        next.view = !cur.view;
      } else if (action === 'entry') {
        next.entry = !cur.entry;
        if (next.entry) next.view = true;
      } else {
        next.edit = !cur.edit;
        if (next.edit) {
          next.view = true;
          next.entry = true;
        }
      }
      return { ...prev, [key]: next };
    });
  }

  async function onSave(): Promise<void> {
    setSubmitError(null);
    try {
      if (role !== initialRole) {
        await updateUser.mutateAsync({ role });
      }
      await save.mutateAsync({
        userId,
        input: { fullAccess, departments, forms },
      });
      onClose();
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Save failed');
    }
  }

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
        style={{ width: 'min(900px, 96vw)', maxHeight: '92vh', overflow: 'auto' }}
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
              }}
            >
              <div>
                <b style={{ fontSize: 14 }}>{userName}</b>{' '}
                <span className="text3">({initialRole})</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="text3" style={{ fontSize: 11 }}>
                  Role:
                </span>
                <select
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
            </div>

            {/* Full Access banner */}
            <div
              style={{
                marginBottom: 16,
                padding: '10px 14px',
                background: 'rgba(34,197,94,0.06)',
                border: '1px solid rgba(34,197,94,0.2)',
                borderRadius: 8,
              }}
            >
              <label
                style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 700 }}
              >
                <input
                  type="checkbox"
                  checked={fullAccess}
                  onChange={(e) => setFullAccess(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: 'var(--green)' }}
                />
                ✅ Full Access (Admin) — overrides all settings below
              </label>
            </div>

            {/* Department chips */}
            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--cyan)',
                  marginBottom: 8,
                }}
              >
                🏢 DEPARTMENT VIEW ACCESS
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {ACCESS_DEPTS.map((d) => {
                  const checked = fullAccess || !!departments[d.key];
                  return (
                    <label
                      key={d.key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '6px 12px',
                        background: 'var(--bg4)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        fontSize: 12,
                        opacity: disabled ? 0.6 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        disabled={disabled}
                        checked={checked}
                        onChange={() => toggleDept(d.key)}
                        style={{ accentColor: d.color }}
                      />
                      <span style={{ color: d.color, fontWeight: 600 }}>{d.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Form / Feature table */}
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--cyan)',
                  marginBottom: 8,
                }}
              >
                📝 FORM / FEATURE ACCESS
              </div>
              <div
                className="text3"
                style={{ fontSize: 10, marginBottom: 8 }}
              >
                💡 <b>View</b> = see data | <b>Entry</b> = create new records | <b>Edit</b> = modify/delete existing records
              </div>
              <table className="innovic-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Form / Feature</th>
                    <th>Department</th>
                    <th style={{ width: 60 }}>View</th>
                    <th style={{ width: 60, color: 'var(--amber)' }}>Entry</th>
                    <th style={{ width: 60 }}>Edit</th>
                  </tr>
                </thead>
                <tbody>
                  {ACCESS_FORMS.map((f) => {
                    const cur = forms[f.key] ?? emptyPerms();
                    const view = fullAccess || cur.view || cur.entry || cur.edit;
                    const entry = fullAccess || cur.entry || cur.edit;
                    const edit = fullAccess || cur.edit;
                    return (
                      <tr key={f.key}>
                        <td style={{ fontSize: 12 }}>{f.label}</td>
                        <td style={{ fontSize: 11 }}>
                          <span className="text3">{f.dept}</span>
                        </td>
                        <td className="td-ctr">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={view}
                            onChange={() => toggleAction(f.key, 'view')}
                            style={{ width: 16, height: 16, accentColor: 'var(--blue)' }}
                          />
                        </td>
                        <td className="td-ctr">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={entry}
                            onChange={() => toggleAction(f.key, 'entry')}
                            style={{ width: 16, height: 16, accentColor: 'var(--amber)' }}
                          />
                        </td>
                        <td className="td-ctr">
                          <input
                            type="checkbox"
                            disabled={disabled}
                            checked={edit}
                            onChange={() => toggleAction(f.key, 'edit')}
                            style={{ width: 16, height: 16, accentColor: 'var(--green)' }}
                          />
                        </td>
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
