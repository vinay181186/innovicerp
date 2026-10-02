// Access Control matrix list — columns, row tint and the per-row ⋯ menu for the
// shared FIT table (ADR-199: <DataTable tableKey=…>). Split out of routes/list.tsx
// so that file stays under the 400-line ceiling and matches the other converted
// lists (nc-register, job-cards …).
//
// Columns (first pinned): User · Home Dept · Tiers by Department · Departments ·
// Extras. The "still enforced as …" warning that used to sit inside the Tiers
// cell now rides the ▸ detail row as its own `defaultHidden` column, and a row
// tint flags the stale row at a glance. The tier logic itself is carried over
// unchanged from the retired UserAccessRow.

import { ACCESS_DEPTS, type UserAccessListItem } from '@innovic/shared';
import { ROW_TINT, type DataTableColumn } from '@/ui/data';
import type { RowMenuItem } from '@/ui/data/row-menu-logic';
import { roleLabel } from '@/lib/role-label';

export function deptLabel(key: string | null): { label: string; color: string } | null {
  if (!key) return null;
  const d = ACCESS_DEPTS.find((x) => x.key === key);
  return d ? { label: d.label, color: d.color } : null;
}

/** The stored role only catches up when someone presses Save Access. Until then
 *  the row can show departments while the server still enforces an older word —
 *  invisible unless we say so. Admins bypass the matrix entirely, so the mismatch
 *  is meaningless for them. (Carried over exactly from the retired row.) */
export function accessRowStale(u: UserAccessListItem): boolean {
  return u.role !== 'admin' && u.derivedRole !== '' && u.role !== u.derivedRole;
}

/** A stale row (enforced role lags the configured tiers) reads amber so the
 *  admin spots it before opening ▸ for the full warning. */
export function accessRowTint(u: UserAccessListItem): string | undefined {
  return accessRowStale(u) ? ROW_TINT.pending : undefined;
}

export function accessListColumns(): DataTableColumn<UserAccessListItem>[] {
  return [
    {
      // First column — pinned by the table standard (ADR-199).
      id: 'user',
      header: 'User',
      align: 'left',
      ellipsis: true,
      className: 'fw-700',
      render: (u) => u.userName ?? u.userEmail,
      title: (u) => u.userName ?? u.userEmail,
      filterValue: (u) => u.userName ?? u.userEmail,
    },
    {
      id: 'home_dept',
      header: 'Home Dept',
      nowrap: true,
      render: (u) => {
        const dept = deptLabel(u.mainDept);
        return dept ? (
          <span style={{ color: dept.color, fontWeight: 700, fontSize: 12 }}>{dept.label}</span>
        ) : (
          <span className="text3" style={{ fontSize: 11 }}>
            —
          </span>
        );
      },
      filterValue: (u) => deptLabel(u.mainDept)?.label ?? '',
    },
    {
      id: 'tiers',
      header: 'Tiers by Department',
      align: 'left',
      ellipsis: true,
      render: (u) => {
        if (u.fullAccess)
          return (
            <span style={{ color: 'var(--green2)', fontWeight: 700, fontSize: 11 }}>
              L6 Super Admin — everything
            </span>
          );
        if (u.auditor)
          return (
            <span style={{ color: 'var(--amber2)', fontWeight: 700, fontSize: 11 }}>
              L7 Auditor — reads everything, writes nothing
            </span>
          );
        if (u.tierSummary) return <span style={{ fontSize: 11 }}>{u.tierSummary}</span>;
        if (u.role === 'admin')
          return (
            <span style={{ color: 'var(--green2)', fontWeight: 700, fontSize: 11 }}>
              Admin — full access
            </span>
          );
        return (
          <span style={{ color: 'var(--red2)', fontWeight: 600, fontSize: 11 }}>
            Not configured — this person can see nothing. Click Configure.
          </span>
        );
      },
      title: (u) =>
        u.fullAccess
          ? 'L6 Super Admin — everything'
          : u.auditor
            ? 'L7 Auditor — reads everything, writes nothing'
            : u.tierSummary
              ? u.tierSummary
              : u.role === 'admin'
                ? 'Admin — full access'
                : 'Not configured — this person can see nothing.',
      filterValue: (u) => u.tierSummary,
    },
    {
      id: 'departments',
      header: 'Departments',
      nowrap: true,
      render: (u) => (u.fullAccess || u.auditor ? <>✅ All</> : `${u.deptCount}/${u.totalDepts}`),
    },
    {
      id: 'extras',
      header: 'Extras',
      nowrap: true,
      render: (u) => (
        <>
          {u.fullAccess ? <>✅ All</> : `${u.formCount}/${u.totalForms}`}
          {/* The drawing-download tick is a whole-account switch, not one of the
              form extras counted above — "who can take our drawings home" is
              exactly the question this screen gets opened to answer. L6 has it
              implicitly. */}
          {u.fullAccess || u.drawingDownload ? (
            <div
              className="badge b-cyan"
              style={{ fontSize: 11, marginTop: 3, display: 'inline-block' }}
              title="Can download drawing files"
            >
              📐 Drawings
            </div>
          ) : null}
        </>
      ),
    },
    {
      // Rides the ▸ detail row (defaultHidden) — the warning the Tiers cell used
      // to carry inline. Empty for an up-to-date row.
      id: 'enforcement_warning',
      header: 'Enforcement',
      align: 'left',
      render: (u) =>
        accessRowStale(u) ? (
          <span style={{ color: 'var(--amber2)', fontSize: 11 }}>
            ⚠ still enforced as <b>{roleLabel(u.role)}</b> — open Configure and Save to apply
          </span>
        ) : (
          '—'
        ),
      filterValue: (u) => (accessRowStale(u) ? `still enforced as ${roleLabel(u.role)}` : ''),
    },
  ];
}

/** Per-row ⋯ menu — the single Configure action the retired row carried. Opens
 *  the ConfigureAccessModal (no navigation, so no renderLink needed). */
export function accessRowMenu(onConfigure: () => void): RowMenuItem[] {
  return [{ key: 'configure', label: 'Configure', icon: 'lock', onSelect: onConfigure }];
}
