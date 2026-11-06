// NC Register list toolbar — the ListHeader with its search box,
// status + reason filters and the "Report NC" button. Split out of routes/list.tsx
// so that file stays under the 400-line ceiling. Behaviour is unchanged: the
// filters drive the same URL params.

import {
  NC_REASON_CATEGORIES,
  NC_FILTER_STATUSES,
  NC_REASON_CATEGORY_LABELS,
  NC_STATUS_LABELS,
  type NcReasonCategory,
  type NcStatus,
} from '@innovic/shared';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
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
  orderFilter: ReactNode;
  /** The page's tab strip, drawn under the header. */
  tabs?: ReactNode;
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
  orderFilter,
  tabs,
}: NcListHeaderProps): React.JSX.Element {
  return (
    <ListHeader
      title="NC Register"
      orderFilter={orderFilter}
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
      searchPlaceholder="Search NC No., JC No., SO / JWSO No., item code, item name, reason…"
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
      {tabs}
    </ListHeader>
  );
}
