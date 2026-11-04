// Design Project — Checklist tab. This is a form/checklist, NOT a data list, so
// per the ADR-199 table-standard brief it is LEFT on its own markup (no
// DataTable). Split out of detail.tsx unchanged.

import { type DesignProjectDetail } from '@innovic/shared';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ConfirmDialog } from '@/ui/feedback';
import { useReleaseDesignProject, useToggleDesignChecklist } from '../api';
import {
  CHECKLIST,
  allIssuesClosedOf,
  allTasksDoneOf,
  isChecked,
  isSystemCheck,
} from './checklist-data';

export function ChecklistTab({
  detail,
  checkDone,
}: {
  detail: DesignProjectDetail;
  checkDone: number;
}): React.JSX.Element {
  // Checklist + release live on the Design Project form (dsnproj_create).
  // Toggling a checklist item is `edit`; releasing the package is `approve`.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'dsnproj_create');
  const canEdit = perms.edit;
  const canApprove = perms.approve;
  const allTasksDone = allTasksDoneOf(detail);
  const allIssuesClosed = allIssuesClosedOf(detail);
  const [askRelease, setAskRelease] = useState(false);
  const allChecked = checkDone === CHECKLIST.length;

  const cats: Record<string, typeof CHECKLIST> = {};
  CHECKLIST.forEach((c) => {
    if (!cats[c.cat]) cats[c.cat] = [];
    cats[c.cat]!.push(c);
  });

  const toggleMut = useToggleDesignChecklist();
  const releaseMut = useReleaseDesignProject();

  return (
    <div>
      <div className="section-hdr">Design Release Checklist</div>
      {!allTasksDone && detail.tasks.length > 0 ? (
        <div
          style={{
            background: 'var(--amber3)',
            border: '1px solid var(--amber)',
            borderRadius: 'var(--radius2)',
            padding: '10px 14px',
            marginBottom: 'var(--sp-3)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--amber2)',
          }}
        >
          ⚠ {detail.tasks.filter((t) => t.status !== 'Completed').length} task(s) incomplete
        </div>
      ) : null}
      {!allIssuesClosed && detail.issues.length > 0 ? (
        <div
          style={{
            background: 'var(--red3)',
            border: '1px solid var(--red)',
            borderRadius: 'var(--radius2)',
            padding: '10px 14px',
            marginBottom: 'var(--sp-3)',
            fontSize: 'var(--fs-sm)',
            color: 'var(--red2)',
          }}
        >
          ⚠ {detail.issues.filter((i) => i.status !== 'Resolved' && i.status !== 'Closed').length}{' '}
          issue(s) open
        </div>
      ) : null}

      <div className="panel" style={{ padding: 'var(--sp-4)' }}>
        {Object.entries(cats).map(([cat, items]) => (
          <div key={cat} style={{ marginBottom: 14 }}>
            <div
              className="text3"
              style={{
                fontSize: 'var(--fs-xs)',
                fontWeight: 700,
                marginBottom: 'var(--sp-2)',
                paddingBottom: 'var(--sp-1)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {cat}
            </div>
            {items.map((c) => {
              const checked = isChecked(detail, c.key);
              // System rows tick themselves from the tasks / issues on this page.
              const system = isSystemCheck(detail, c.key);
              const clickable = canEdit && !system;
              return (
                <div
                  key={c.key}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '7px 0',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                  onClick={() =>
                    clickable &&
                    toggleMut.mutate({
                      id: detail.project.id,
                      input: { key: c.key },
                    })
                  }
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 'var(--radius-sm)',
                      border: `2px solid ${checked ? 'var(--green)' : 'var(--border2)'}`,
                      background: checked ? 'var(--green)' : 'var(--bg)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    {checked ? (
                      <span style={{ color: 'var(--bg)', fontSize: 'var(--fs-sm)' }}>✓</span>
                    ) : null}
                  </div>
                  <span
                    style={{
                      fontSize: 'var(--fs-sm)',
                      color: checked ? 'var(--text3)' : undefined,
                      textDecoration: checked ? 'line-through' : undefined,
                    }}
                  >
                    {c.label}
                  </span>
                  {system ? (
                    <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
                      (checked by the system)
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {allChecked && allTasksDone && allIssuesClosed ? (
        <div
          style={{
            background: 'var(--green3)',
            border: '1px solid var(--green)',
            borderRadius: 'var(--radius2)',
            padding: 20,
            marginTop: 14,
            textAlign: 'center',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--green2)', fontSize: 'var(--fs-sm)' }}>
            Ready for Release
          </div>
          {canApprove && detail.project.status !== 'Released' ? (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 'var(--sp-3)' }}
              disabled={releaseMut.isPending}
              onClick={() => setAskRelease(true)}
            >
              Release Design Package
            </button>
          ) : null}
        </div>
      ) : null}
      <ConfirmDialog
        open={askRelease}
        title={`Release ${detail.project.code}?`}
        message={`Release the design package for ${detail.project.projectName}.`}
        confirmLabel="Release Design Package"
        tone="primary"
        onCancel={() => setAskRelease(false)}
        onConfirm={async () => {
          await releaseMut.mutateAsync(detail.project.id);
          setAskRelease(false);
        }}
      />
    </div>
  );
}
