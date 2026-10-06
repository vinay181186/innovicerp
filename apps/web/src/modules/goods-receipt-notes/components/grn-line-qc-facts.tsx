// What a GRN line hides behind `▸ More` — two labelled groups on the house
// ClusterGrid, so the row itself never grows and nothing has to become a
// twelfth column.
//
//   Line paperwork   the line's own Vendor Challan No. and Remarks. Editable
//                    until Incoming QC CLEARS the line (not merely starts on
//                    it): the server accepts those two edits while `Received`
//                    is already frozen. Once cleared they read as facts.
//   Quality          what Incoming QC recorded, in the owner's order —
//                    Accepted → Deviated → QC Date → Inspected By → QC Remarks
//                    → QC Report. Read-only here, always (ADR-189: QC is
//                    recorded in Incoming QC and nowhere else). Three of these
//                    six used to be greyed-out controls on the edit card; the
//                    other three were stored and shown on no surface at all.
//
// Group names sit in the 104px left gutter, not as headings (layout rule 5).
// `.cl-gut` is `white-space: nowrap`, so each is broken over two short lines
// rather than overflowing into the first fact.

import { fmtDate } from '@/lib/date';
import { Cluster, ClusterFact, ClusterGrid, FormField } from '@/ui/forms';
import type { GrnLineQcFacts } from './grn-receipt-figures';

export interface GrnLineMoreProps {
  /** The row's stable key — makes each input's id unique across mounted rows. */
  lineKey: string;
  /** The row's index, as the table's change handlers expect it. */
  idx: number;
  remarks: string;
  onRemarks: (idx: number, value: string) => void;
  /** The line's own Vendor Challan No. Omit `challan` and the field is not
   *  offered at all (the DC / NC receive payload has no per-line challan
   *  field), and Remarks takes all four cells. */
  dcRefNo?: string | undefined;
  challan?: { headerValue: string; onChange: (idx: number, value: string) => void } | undefined;
  /** QC has CLEARED this line: the paperwork is read-only. */
  paperLocked: boolean;
  /** Present on the edit screen only — a new GRN has not been inspected yet. */
  qc?: GrnLineQcFacts | undefined;
}

export function GrnLineMore({
  lineKey,
  idx,
  remarks,
  onRemarks,
  dcRefNo,
  challan,
  paperLocked,
  qc,
}: GrnLineMoreProps): React.JSX.Element {
  const typedChallan = (dcRefNo ?? '').trim();
  return (
    <ClusterGrid>
      <Cluster
        name={
          <>
            Line
            <br />
            paperwork
          </>
        }
      >
        {challan ? (
          paperLocked ? (
            <ClusterFact
              label="Vendor Challan No."
              value={typedChallan || challan.headerValue || '—'}
              empty={!(typedChallan || challan.headerValue)}
            />
          ) : (
            <FormField
              label="Vendor Challan No."
              htmlFor={`dcRef-${lineKey}`}
              {...(challan.headerValue && !typedChallan
                ? { help: `Saves as the header's ${challan.headerValue} unless changed.` }
                : {})}
            >
              <input
                id={`dcRef-${lineKey}`}
                className="innovic-input"
                autoComplete="off"
                value={dcRefNo ?? ''}
                placeholder={challan.headerValue || undefined}
                onChange={(e) => challan.onChange(idx, e.target.value)}
              />
            </FormField>
          )
        ) : null}
        {paperLocked ? (
          <ClusterFact
            label="Remarks"
            span={challan ? 3 : 4}
            wrap
            value={remarks || '—'}
            empty={!remarks}
          />
        ) : (
          <FormField
            label="Remarks"
            htmlFor={`remarks-${lineKey}`}
            className={challan ? 'cl-span-3' : 'cl-span-4'}
          >
            <input
              id={`remarks-${lineKey}`}
              className="innovic-input"
              autoComplete="off"
              value={remarks}
              onChange={(e) => onRemarks(idx, e.target.value)}
            />
          </FormField>
        )}
      </Cluster>

      {qc ? (
        <>
          <Cluster
            name={
              <>
                Quality
                <br />
                Incoming QC
              </>
            }
          >
            <ClusterFact
              label="Accepted"
              num
              value={<span className="green">{qc.acceptedQty}</span>}
            />
            <ClusterFact
              label="Deviated"
              num
              value={<span className="red">{qc.rejectedQty}</span>}
            />
            <ClusterFact label="QC Date" num value={fmtDate(qc.qcDate)} empty={!qc.qcDate} />
            <ClusterFact
              label="Inspected By"
              value={qc.inspectedBy ?? '—'}
              empty={!qc.inspectedBy}
              {...(qc.inspectedBy ? { title: qc.inspectedBy } : {})}
            />
          </Cluster>
          {/* `name={null}` keeps the gutter TRACK on the continuation row, so
              these two cells stay in the same tracks as the four above. */}
          <Cluster name={null}>
            <ClusterFact
              label="QC Remarks"
              span={2}
              wrap
              value={qc.qcRemarks ?? '—'}
              empty={!qc.qcRemarks}
            />
            <ClusterFact
              label="QC Report"
              span={2}
              value={qc.qcReportName ?? '—'}
              empty={!qc.qcReportName}
              {...(qc.qcReportName ? { title: qc.qcReportName } : {})}
            />
          </Cluster>
        </>
      ) : null}
    </ClusterGrid>
  );
}
