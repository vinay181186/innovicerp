// ADR-264 — one department's numbered checks: "1. Plans available for
// production (2)" with a Show / Hide text button (owner rule: no ▸ arrow on a
// list row). An open check shows its documents (CheckTable). Header controls:
// Expand all / Collapse all for this department's checks (each check's state is
// saved per user). The "Lists open as" switch and the hint were removed (owner
// 31-Oct: unnecessary words); new users start Collapsed.

import type { DashCheckDeptBlock } from '@innovic/shared';
import { useCheckOpen } from '../use-check-open';
import { CheckTable } from './check-table';
import { ViewHead } from './view-head';

export function DeptView({
  block,
  label,
}: {
  block: DashCheckDeptBlock;
  label: string;
}): React.JSX.Element {
  const open = useCheckOpen();
  const checks = block.checks;
  return (
    <>
      <ViewHead title={label}>
        <div className="dh-ctl">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={checks.length === 0}
            onClick={() => open.setAll(checks, true)}
          >
            Expand all
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={checks.length === 0}
            onClick={() => open.setAll(checks, false)}
          >
            Collapse all
          </button>
        </div>
      </ViewHead>
      {checks.length === 0 ? (
        <div className="dh-emptytab">Nothing to check in {label} right now.</div>
      ) : (
        checks.map((c, i) => {
          const isOpen = open.isOpen(c.key);
          const bodyId = `dh-check-${c.key}`;
          return (
            <div key={c.key} className="dh-check">
              <div className="dh-check-line">
                <span className="dh-check-n">{i + 1}.</span>
                <span className="dh-check-label">{c.label}</span>
                <span className={`dh-cnt t-${c.tone}`}>({c.count})</span>
                <button
                  type="button"
                  className="dh-textbtn"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  aria-label={`${isOpen ? 'Hide' : 'Show'} ${c.label}`}
                  onClick={() => open.toggle(c.key)}
                >
                  {isOpen ? 'Hide' : 'Show'}
                </button>
              </div>
              {isOpen ? (
                <div id={bodyId}>
                  <CheckTable check={c} />
                </div>
              ) : null}
            </div>
          );
        })
      )}
    </>
  );
}
