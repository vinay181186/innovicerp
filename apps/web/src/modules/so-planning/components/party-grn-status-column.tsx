// Party GRN Status (ADR-279): one column for both Planning line tables, a JWSO's
// lines only. The first list adds its server Sort & Filter on top.

import { PARTY_GRN_STATUS_LABEL, type PartyGrnStatus } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';

const PARTY_GRN_STATUS_COLOR: Record<PartyGrnStatus, string> = {
  done: 'var(--green)',
  part_done: 'var(--amber)',
  not_done: 'var(--red2)',
  none: 'var(--text3)',
};

export function partyGrnStatusColumn<
  T extends { partyGrnStatus: PartyGrnStatus },
>(): DataTableColumn<T> {
  return {
    id: 'party_grn_status',
    header: (
      <>
        Party GRN
        <br />
        Status
      </>
    ),
    label: 'Party GRN Status',
    kind: 'badge',
    nowrap: true,
    render: (r) => (
      <span
        style={{
          fontSize: 'var(--fs-xs)',
          fontWeight: 700,
          color: PARTY_GRN_STATUS_COLOR[r.partyGrnStatus],
        }}
      >
        {PARTY_GRN_STATUS_LABEL[r.partyGrnStatus]}
      </span>
    ),
    filterValue: (r) => PARTY_GRN_STATUS_LABEL[r.partyGrnStatus],
  };
}
