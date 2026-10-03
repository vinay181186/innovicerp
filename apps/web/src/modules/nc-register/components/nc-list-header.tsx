// NC Register list toolbar — the ListHeader with its StatStrip, search box,
// status + reason filters and the "Report NC" button. Split out of routes/list.tsx
// so that file stays under the 400-line ceiling. Behaviour is unchanged: the
// filters drive the same URL params, the StatStrip reads the same summary.

import {
  NC_REASON_CATEGORIES,
  NC_FILTER_STATUSES,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  type NcReasonCategory,
  type NcRegisterSummary,
  type NcStatus,
  roundQty,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import { StatStrip } from '@/components/shared/stat-strip';
import { ListHeader } from '@/ui/layout';

export interface NcListHeaderProps {
  count: number | undefined;
  searchInput: string;
  onSearch: (v: string) => void;
  updating: boolean;
  status: NcStatus | undefined;
  reasonCategory: NcReasonCategory | undefined;
  onStatusChange: (v: NcStatus | undefined) => void;
  onReasonChange: (v: NcReasonCategory | undefined) => void;
  onClearFilters: () => void;
  /** A column ▾ filter is applied (Sort & Filter, ADR-200) — lights Clear. */
  columnFiltering: boolean;
  canReportNc: boolean;
  summary: NcRegisterSummary | undefined;
}

export function NcListHeader({
  count,
  searchInput,
  onSearch,
  updating,
  status,
  reasonCategory,
  onStatusChange,
  onReasonChange,
  onClearFilters,
  columnFiltering,
  canReportNc,
  summary,
}: NcListHeaderProps): React.JSX.Element {
  return (
    <ListHeader
      title="NC Register"
      icon="⚠️"
      count={count}
      noun="NC"
      filterNote={
        status || reasonCategory
          ? [
              status ? NC_STATUS_LABELS[status] : null,
              reasonCategory ? NC_REASON_CATEGORY_LABELS[reasonCategory] : null,
            ]
              .filter(Boolean)
              .join(' · ')
          : undefined
      }
      // Server-side search over code / reason / item (service.ts L215); it does
      // NOT match JC, so the placeholder does not claim it.
      search={searchInput}
      onSearch={onSearch}
      searchPlaceholder="Search NC No., item code, item name, reason…"
      updating={updating}
      filters={
        <>
          <select
            className="innovic-select"
            aria-label="NC status"
            title="NC status"
            value={status ?? ''}
            onChange={(e) => {
              const v = e.target.value as NcStatus | '';
              onStatusChange(v === '' ? undefined : v);
            }}
          >
            <option value="">All Status</option>
            {/* S8 — every status NCs are written in (legacy rework_done hidden). */}
            {NC_FILTER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {NC_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            className="innovic-select"
            aria-label="Reason category"
            title="Reason category"
            value={reasonCategory ?? ''}
            onChange={(e) => {
              const v = e.target.value as NcReasonCategory | '';
              onReasonChange(v === '' ? undefined : v);
            }}
          >
            <option value="">All Reasons</option>
            {NC_REASON_CATEGORIES.map((r) => (
              <option key={r} value={r}>
                {NC_REASON_CATEGORY_LABELS[r]}
              </option>
            ))}
          </select>
        </>
      }
      onClearFilters={onClearFilters}
      filtersActive={columnFiltering || !!status || !!reasonCategory || searchInput.trim() !== ''}
      primary={
        canReportNc ? (
          <Link to="/nc-register/new" className="btn btn-primary">
            ⚠️ Report NC
          </Link>
        ) : null
      }
    >
      {/* Counts as ONE single-row strip (styling skill Rule 3 + SO Master).
          Read-only metrics — no onClick, so each cell renders as a div. */}
      <StatStrip
        items={[
          {
            key: 'total',
            label: 'NCs',
            count: summary?.total == null ? '—' : Math.round(summary.total),
            color: 'var(--red2)',
          },
          {
            key: 'pending',
            label: 'NC Raised',
            count: summary?.pending == null ? '—' : Math.round(summary.pending),
            color: 'var(--amber2)',
          },
          {
            key: 'totalQty',
            label: 'Deviated Qty',
            count: summary?.totalQty == null ? '—' : roundQty(summary.totalQty),
          },
          {
            key: 'rework',
            label: 'Rework Qty',
            count: summary?.reworkQty == null ? '—' : roundQty(summary.reworkQty),
            color: 'var(--cyan)',
          },
          {
            key: 'scrap',
            label: 'Scrap Qty',
            count: summary?.scrapQty == null ? '—' : roundQty(summary.scrapQty),
            color: 'var(--red2)',
          },
        ]}
      />
    </ListHeader>
  );
}
