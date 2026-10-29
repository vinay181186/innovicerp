// Upload QC Document modal (register view's 📎 Upload Document). Split out of
// routes/list.tsx. ADR-252: the Document Type list is the Report Types master
// (reportTypeId is sent; the server writes the type's own name).

import { QC_DOC_CATEGORIES, type CreateQcDocumentInput, type QcDocCategory } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { SearchableSelect } from '@/ui/forms';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { useSaveKey } from '@/lib/use-save-key';
import { useJobCardsList } from '@/modules/job-cards/api';
import { useReportTypes } from '@/modules/report-types/api';
import { useSalesOrdersList } from '@/modules/sales-orders/api';
import {
  QC_REPORT_ACCEPT,
  QC_REPORT_TYPES_LABEL,
  attachmentSizeError,
  attachmentTypeAllowed,
} from '@innovic/shared';
import { uploadQcFile, useCreateQcDocument } from '../api';
import { CATEGORY_LABEL } from './qc-doc-shared';

export function UploadModal({
  companyId,
  onClose,
}: {
  companyId: string;
  onClose: () => void;
}): React.JSX.Element {
  const saveKey = useSaveKey();
  const create = useCreateQcDocument(saveKey);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<QcDocCategory>('qc-docs');
  // Document Type = a Report Types master row (Active ones only).
  const reportTypes = useReportTypes({ limit: 1000, offset: 0 });
  const typeOptions = (reportTypes.data?.items ?? []).filter((t) => t.status === 'Active');
  const [reportTypeId, setReportTypeId] = useState<string>('');
  // JC / SO are picked from their masters (a hand-typed code broke the link on
  // every typo). The picked id is SAVED with the code — the SO matrix and the
  // line detail find a JC's files by job_card_id, so code text alone never
  // showed the MIR as done there.
  const [jcId, setJcId] = useState<string | null>(null);
  const [jcCode, setJcCode] = useState('');
  const [jcSearch, setJcSearch] = useState('');
  const [soId, setSoId] = useState<string | null>(null);
  const [soCode, setSoCode] = useState('');
  const [soSearch, setSoSearch] = useState('');
  const jcQuery = useJobCardsList({ search: jcSearch || undefined, limit: 20, offset: 0 });
  const soQuery = useSalesOrdersList({ search: soSearch || undefined, limit: 20, offset: 0 });
  const jcItems = jcQuery.data?.items ?? [];
  const soItems = soQuery.data?.items ?? [];
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setErr(null);
    if (!file) {
      setErr('Choose a file to upload.');
      return;
    }
    if (!reportTypeId) {
      setErr('Pick the Document Type.');
      return;
    }
    if (!attachmentTypeAllowed(file.name, QC_REPORT_ACCEPT)) {
      setErr(`${file.name}: only ${QC_REPORT_TYPES_LABEL} files.`);
      return;
    }
    const tooBig = attachmentSizeError(file);
    if (tooBig) {
      setErr(tooBig);
      return;
    }
    setBusy(true);
    try {
      const storagePath = await uploadQcFile(file, companyId);
      const input: CreateQcDocumentInput = {
        category,
        reportTypeId,
        fileName: file.name,
        storagePath,
        ...(jcId ? { jobCardId: jcId } : {}),
        ...(jcCode.trim() ? { jcCodeText: jcCode.trim() } : {}),
        ...(soId ? { salesOrderId: soId } : {}),
        ...(soCode.trim() ? { soCodeText: soCode.trim() } : {}),
      };
      await create.mutateAsync(input);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not upload document. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        zIndex: 50,
        padding: 24,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        className="panel"
        style={{ width: 'min(1100px, 96vw)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-hdr">
          <span className="panel-title">📎 Upload QC Document</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp form-full">
              <label className="form-label">
                File<span className="req">★</span>
              </label>
              <input
                type="file"
                className="innovic-input"
                accept={QC_REPORT_ACCEPT}
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">
                Document Type<span className="req">★</span>
              </label>
              <select
                className="innovic-select"
                value={reportTypeId}
                onChange={(e) => setReportTypeId(e.target.value)}
              >
                <option value="">{reportTypes.isLoading ? 'Loading…' : 'Select…'}</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">Category</label>
              <select
                className="innovic-select"
                value={category}
                onChange={(e) => setCategory(e.target.value as QcDocCategory)}
              >
                {QC_DOC_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-grp">
              <label className="form-label">JC No.</label>
              <SearchableSelect
                id="qc-doc-upload-jc"
                value={jcId}
                valueLabel={jcCode || undefined}
                onChange={(id) => {
                  const jc = jcItems.find((j) => j.id === id);
                  setJcId(id);
                  setJcCode(jc?.code ?? '');
                  // Fetch-from: a JC raised against an SO line already knows
                  // its SO, so SO No. fills from it.
                  if (jc?.sourceLink?.type === 'so') {
                    setSoId(jc.sourceLink.salesOrderId);
                    setSoCode(jc.sourceLink.code);
                  }
                }}
                onSearch={setJcSearch}
                loading={jcQuery.isFetching}
                placeholder="Search JC No. or item…"
                selectedLabel={(o) => o.code ?? o.name}
                options={jcItems.map((j) => ({
                  id: j.id,
                  code: j.code,
                  name: `${itemCodeWithRev(j.itemCode, j.itemRevision)} ${j.itemName}`,
                }))}
              />
            </div>
            <div className="form-grp">
              <label className="form-label">SO No.</label>
              <SearchableSelect
                id="qc-doc-upload-so"
                value={soId}
                valueLabel={soCode || undefined}
                onChange={(id) => {
                  setSoId(id);
                  setSoCode(soItems.find((so) => so.id === id)?.code ?? '');
                }}
                onSearch={setSoSearch}
                loading={soQuery.isFetching}
                placeholder="Search SO No. or customer…"
                selectedLabel={(o) => o.code ?? o.name}
                options={soItems.map((so) => ({
                  id: so.id,
                  code: soNoWithInternal(so.code, so.internalSoNo),
                  name: so.customerName ?? '',
                }))}
              />
            </div>
          </div>
          {err ? (
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginTop: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Save QC Document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
