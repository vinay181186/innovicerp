// ADR-252 Dossier — right pane with a POL (or one of its folders) selected:
// the line header, one chip per required report, and the file sheet
// Report | File | JC No. | QC Entry | Uploaded By | Uploaded At | Added From |
// symbols. A QC entry saved without its report is a red "no report" row.
// Symbols follow the rights (owner rule: no symbol without the right):
//   👁 everyone with the page · ⬇ download tick · ＋ ↻ qcdocs_upload entry ·
//   ✕ delete right, and only on QC Documents uploads.

import type { QcDossierLine, QcDossierOrderKind } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { fmtDateTime } from '@/lib/date';
import { itemCodeWithRev } from '@/lib/item-code';
import { Badge } from '@/ui/core';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ConfirmDialog } from '@/ui/feedback';
import { saveQcDoc, useDeleteQcDocument } from '../api';
import {
  entryLabel,
  entryRemarks,
  folderFiles,
  missingEntryText,
  onlyOptionalMissing,
  SOURCE_LABEL,
  type DossierRow,
} from './dossier-model';
import { polLabel } from './dossier-tree';
import { openStoragePath } from './qc-doc-shared';
import { uploadSlotKey, type UploadTarget } from './use-dossier-upload';

const NO_SLOTS: ReadonlySet<string> = new Set();

/** Shown in place of ＋ / ↻ once an upload saved, until the dossier refetches. */
function Refreshing(): React.JSX.Element {
  return <span className="text3">uploaded — refreshing…</span>;
}

export interface DossierRights {
  canUpload: boolean;
  canDelete: boolean;
  maySave: boolean;
}

function Sym({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Line header + report chips. Null for the "files on no POL" node. */
export function DossierLineHead({
  line,
  kind,
  folder,
  rights,
  onUpload,
  zipButton,
  refreshing = NO_SLOTS,
}: {
  line: QcDossierLine;
  kind: QcDossierOrderKind;
  folder: string | undefined;
  rights: DossierRights;
  onUpload: (t: UploadTarget) => void;
  zipButton: React.ReactNode;
  refreshing?: ReadonlySet<string>;
}): React.JSX.Element {
  const f = folder ? line.folders.find((x) => x.reportName === folder) : undefined;
  const steps = line.folders.filter((x) => x.isStep);
  return (
    <>
      <div className="qd-head">
        <span className="qd-t">
          POL {polLabel(line)} ·{' '}
          <span className="qd-code">{itemCodeWithRev(line.itemCode, line.itemRevision)}</span>
        </span>
        {line.itemName ? <span className="qd-kv">{line.itemName}</span> : null}
        <span className="qd-kv">
          Order Qty <b className="mono">{line.orderQty}</b>
        </span>
        <span className="qd-kv">
          JC No. <b className="mono">{line.jobCards.map((j) => j.code).join(', ') || '—'}</b>
        </span>
        <span style={{ flex: 1 }} />
        {rights.canUpload &&
        f?.reportTypeId &&
        refreshing.has(
          uploadSlotKey({
            reportTypeId: f.reportTypeId,
            ...(kind === 'so' ? { soLineId: line.lineId } : { jwLineId: line.lineId }),
          }),
        ) ? (
          <Refreshing />
        ) : rights.canUpload && f?.reportTypeId ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() =>
              onUpload({
                reportTypeId: f.reportTypeId ?? '',
                ...(kind === 'so' ? { soLineId: line.lineId } : { jwLineId: line.lineId }),
                label: f.reportName,
              })
            }
          >
            ＋ Upload {f.reportName}
          </button>
        ) : null}
        {zipButton}
      </div>
      <div className="qd-chips">
        {line.state === 'no_jc' || line.state === 'no_qc_steps' || steps.length === 0 ? (
          <Badge tone="grey" className="qd-chip">
            {line.state === 'no_jc' ? 'No JC yet' : 'No QC steps'} — nothing required
          </Badge>
        ) : (
          steps.map((s) => {
            // A gap whose report was not compulsory (Last Stage Only on a
            // middle stage) is orange, not red (owner rule 2026-10-31).
            const tone =
              s.state === 'report_missing'
                ? onlyOptionalMissing([s])
                  ? 'orange'
                  : 'red'
                : s.state === 'qc_not_done'
                  ? 'grey'
                  : 'green';
            const mark = tone === 'red' || tone === 'orange' ? '✕' : tone === 'grey' ? '⏳' : '✓';
            return (
              <Badge key={s.reportName} tone={tone} className="qd-chip">
                {mark} {s.reportName}
                {!s.mandatory || onlyOptionalMissing([s]) ? ' (optional)' : ''}
              </Badge>
            );
          })
        )}
      </div>
    </>
  );
}

/** Red for a missing compulsory report; orange for one that was optional. */
function missingColor(e: { reportMandatory: boolean }): string {
  return e.reportMandatory ? 'var(--red2)' : 'var(--orange2)';
}

export function DossierFileSheet({
  rows,
  orderCode,
  showReport,
  rights,
  onUpload,
  refreshing = NO_SLOTS,
}: {
  rows: DossierRow[];
  /** What the access log calls this order. */
  orderCode: string;
  showReport: boolean;
  rights: DossierRights;
  onUpload: (t: UploadTarget) => void;
  refreshing?: ReadonlySet<string>;
}): React.JSX.Element {
  const del = useDeleteQcDocument();
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [delErr, setDelErr] = useState<string | null>(null);

  const columns = useMemo<DataTableColumn<DossierRow>[]>(() => {
    const cols: DataTableColumn<DossierRow>[] = [
      {
        id: 'report',
        header: 'Report',
        nowrap: true,
        className: 'fw-700',
        render: (r) => r.reportName,
      },
      {
        id: 'file',
        header: 'File',
        align: 'left',
        ellipsis: true,
        render: (r) =>
          r.kind === 'missing' ? (
            <span style={{ color: missingColor(r.entry) }}>{missingEntryText(r.entry)}</span>
          ) : (
            <>
              {r.file.fileName}
              {!r.file.current ? (
                <Badge tone="grey" className="qd-chip" style={{ marginLeft: 6 }}>
                  earlier
                </Badge>
              ) : null}
            </>
          ),
        title: (r) => (r.kind === 'file' ? r.file.fileName : missingEntryText(r.entry)),
      },
      {
        id: 'jc_code',
        kind: 'code',
        header: 'JC No.',
        nowrap: true,
        className: 'mono',
        render: (r) =>
          (r.kind === 'file' ? (r.file.jcCode ?? r.entry?.jcCode) : r.entry.jcCode) ?? '—',
      },
      {
        id: 'qc_entry',
        header: 'QC Entry',
        nowrap: true,
        render: (r) =>
          r.entry ? (
            <span
              style={r.kind === 'missing' ? { color: missingColor(r.entry) } : undefined}
              title={entryRemarks(r.entry) ?? undefined}
            >
              {entryLabel(r.entry)}
              {r.kind === 'missing' ? ` · ${missingEntryText(r.entry)}` : ''}
              {entryRemarks(r.entry) ? (
                <>
                  {' · '}
                  <span
                    style={{
                      display: 'inline-block',
                      maxWidth: '28ch',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      verticalAlign: 'bottom',
                      color: 'var(--text3)',
                    }}
                  >
                    &ldquo;{entryRemarks(r.entry)}&rdquo;
                  </span>
                </>
              ) : null}
            </span>
          ) : (
            <span className="text3">—</span>
          ),
      },
      {
        id: 'uploaded_by',
        header: 'Uploaded By',
        nowrap: true,
        render: (r) => (r.kind === 'file' ? (r.file.uploadedByName ?? '—') : '—'),
      },
      {
        id: 'uploaded_at',
        kind: 'date',
        header: 'Uploaded At',
        nowrap: true,
        render: (r) => (r.kind === 'file' ? fmtDateTime(r.file.uploadedAt) : '—'),
      },
      {
        id: 'added_from',
        header: 'Added From',
        nowrap: true,
        render: (r) => (r.kind === 'file' ? SOURCE_LABEL[r.file.source] : '—'),
      },
      {
        id: 'actions',
        kind: 'actions',
        header: '',
        label: 'Actions',
        nowrap: true,
        stopRowClick: true,
        filterable: false,
        render: (r) => (
          <span className="qd-acts">
            {r.kind === 'missing' ? (
              refreshing.has(uploadSlotKey({ opLogId: r.entry.opLogId })) ? (
                <Refreshing />
              ) : rights.canUpload ? (
                <Sym
                  title={`Upload ${r.reportName} report`}
                  onClick={() => onUpload({ opLogId: r.entry.opLogId, label: r.reportName })}
                >
                  ＋
                </Sym>
              ) : null
            ) : (
              <>
                <Sym
                  title="View"
                  onClick={() => void openStoragePath(r.file.storagePath, orderCode)}
                >
                  👁
                </Sym>
                {rights.maySave ? (
                  <Sym
                    title="Download"
                    onClick={() =>
                      void saveQcDoc(r.file.storagePath, r.file.fileName, orderCode).catch((e) =>
                        window.alert(e instanceof Error ? e.message : 'Could not download.'),
                      )
                    }
                  >
                    ⬇
                  </Sym>
                ) : null}
                {r.entry &&
                r.file.current &&
                refreshing.has(uploadSlotKey({ opLogId: opLogIdOf(r) })) ? (
                  <Refreshing />
                ) : rights.canUpload && r.entry && r.file.current ? (
                  <Sym
                    title="Replace — upload a newer file; this one stays as earlier"
                    onClick={() => onUpload({ opLogId: opLogIdOf(r), label: r.reportName })}
                  >
                    ↻
                  </Sym>
                ) : null}
                {rights.canDelete && r.file.source === 'qc_document' && r.file.qcDocumentId ? (
                  <Sym
                    title="Delete"
                    onClick={() =>
                      setPendingDelete({ id: r.file.qcDocumentId ?? '', name: r.file.fileName })
                    }
                  >
                    ✕
                  </Sym>
                ) : null}
              </>
            )}
          </span>
        ),
      },
    ];
    return showReport ? cols : cols.filter((c) => c.id !== 'report');
  }, [showReport, rights, onUpload, orderCode, refreshing]);

  return (
    <>
      {delErr ? (
        <div role="alert" className="qd-msg" style={{ color: 'var(--red2)' }}>
          {delErr}
        </div>
      ) : null}
      <DataTable
        tableKey={TABLE_KEYS.qcDocsDossierFiles}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.key}
        sortFilter={false}
        emptyText="No files here yet."
        rowClassName={(r) =>
          r.kind === 'missing' ? 'qd-missing' : !r.file.current ? 'qd-earlier' : undefined
        }
      />
      {pendingDelete ? (
        <ConfirmDialog
          title={`Delete ${pendingDelete.name}?`}
          message="The file is removed from QC Documents."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          tone="danger"
          onConfirm={async () => {
            setDelErr(null);
            try {
              await del.mutateAsync(pendingDelete.id);
            } catch (e) {
              setDelErr(e instanceof Error ? e.message : 'Could not delete. Try again.');
            }
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </>
  );
}

function opLogIdOf(r: DossierRow): string {
  return r.entry?.opLogId ?? '';
}

/** File count of one line (for the ZIP button). */
export function lineFileCount(line: QcDossierLine): number {
  return line.folders.reduce((n, f) => n + folderFiles(f).length, 0);
}
