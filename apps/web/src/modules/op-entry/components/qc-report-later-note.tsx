// Owner rule 2026-10-31 (D4a) — a middle-stage QC entry (e.g. DIR) whose
// Report Type is "Last Stage Only" may be submitted without its report. Right
// after such a submit the Op Entry box says so and offers the SAME upload-later
// path Home "Reports to upload" uses: the QC Dossier, opened on the card's
// order + POL line. A card with no order behind it opens the Job Card instead
// (Home does the same). No new uploader.

import { Link } from '@tanstack/react-router';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { Banner } from '@/ui/feedback';
import { useJobCard } from '@/modules/job-cards/api';

export function QcReportLaterNote({
  jobCardId,
  reportName,
  onDone,
}: {
  jobCardId: string;
  reportName: string;
  onDone: () => void;
}): React.JSX.Element {
  const { data: eff } = useMyAccess();
  const canUpload = effectiveFormPerms(eff, 'qcdocs_upload').entry;
  const jc = useJobCard(canUpload ? jobCardId : undefined);
  const src = jc.data?.sourceLink ?? null;

  const uploadLink = !canUpload ? null : src ? (
    <Link
      to="/qc-docs"
      search={{
        view: 'dossier',
        kind: src.type === 'jw' ? 'jwso' : 'so',
        orderId: src.type === 'jw' ? src.jobWorkOrderId : src.salesOrderId,
        lineId: src.type === 'jw' ? src.jobWorkOrderLineId : src.salesOrderLineId,
      }}
      className="btn btn-primary btn-sm"
    >
      Upload report
    </Link>
  ) : jc.data ? (
    <Link to="/job-cards/$id" params={{ id: jobCardId }} className="btn btn-primary btn-sm">
      Open Job Card
    </Link>
  ) : null;

  return (
    <Banner tone="warn" accent title={`Inspection saved. ${reportName} report not uploaded.`}>
      <div>
        It is optional on this QC stage. You can upload it later — it stays on Home under Reports to
        upload.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        {uploadLink}
        <button type="button" className="btn btn-sm" onClick={onDone}>
          Close
        </button>
      </div>
    </Banner>
  );
}
