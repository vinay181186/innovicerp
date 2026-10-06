// New Job Card — the QC Documents tab. The create form's old "QC Documents"
// panel (legacy jcModalBody L6014-6017 + jcModalDocsHtml L5809), moved under
// the second tab of the one filling panel so the page fits one screen. Same
// document types, same upload, same remove; the table is unchanged.

export const QC_DOC_TYPES = [
  'MIR',
  'MCR',
  'Inspection Report Protocol',
  'Inspection Report',
  'Drawing',
  'Certificate',
  'Other',
];

export interface JcCreateDoc {
  docType: string;
  fileName: string;
  storagePath: string;
  fileSize: number | null;
}

export function JcCreateDocsTable({
  docs,
  onTypeChange,
  onFile,
  onRemove,
}: {
  docs: JcCreateDoc[];
  onTypeChange: (idx: number, docType: string) => void;
  onFile: (idx: number, file: File | undefined) => void;
  onRemove: (idx: number) => void;
}): React.JSX.Element {
  return (
    <table className="innovic-table tbl-ctr tbl-edit tbl-fixed">
      <colgroup>
        <col style={{ width: 240 }} />
        <col />
        <col style={{ width: 56 }} />
      </colgroup>
      <thead>
        <tr>
          <th>Document Type</th>
          <th>Attached File</th>
          <th aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {docs.length === 0 ? (
          <tr>
            <td colSpan={3} className="empty-state">
              No QC documents.
            </td>
          </tr>
        ) : (
          docs.map((d, i) => (
            <tr key={i}>
              <td>
                <select
                  className="innovic-select"
                  value={d.docType}
                  aria-label={`Document Type, document ${i + 1}`}
                  onChange={(e) => onTypeChange(i, e.target.value)}
                >
                  {QC_DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <label className="jcc-doc-file" title={d.fileName || 'Attach a file'}>
                  📎 {d.fileName || 'Attach File'}
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    hidden
                    onChange={(e) => onFile(i, e.target.files?.[0])}
                  />
                </label>
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-danger btn-sm btn-icon"
                  onClick={() => onRemove(i)}
                  title="Remove"
                  aria-label={`Remove document ${i + 1}`}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
