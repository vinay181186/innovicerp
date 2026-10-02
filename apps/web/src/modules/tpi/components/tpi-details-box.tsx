// TPI — the purple "TPI Details" box of the TPI entry form: Inspector (picked
// from TPI Master), Organisation, TPI Certificate No., Remarks. Split out of
// the pending TPI card (ADR-201 file split) so each file stays under 400 lines.
// State stays with the card; this box only draws and edits it.

import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useTpiMastersList } from '@/modules/tpi-masters/api';

export function TpiDetailsBox(props: {
  jcOpId: string;
  inspector: string;
  setInspector: (v: string) => void;
  organization: string;
  setOrganization: (v: string) => void;
  certNo: string;
  setCertNo: (v: string) => void;
  remarks: string;
  setRemarks: (v: string) => void;
}): React.JSX.Element {
  const {
    jcOpId,
    inspector,
    setInspector,
    organization,
    setOrganization,
    certNo,
    setCertNo,
    remarks,
    setRemarks,
  } = props;
  // Inspector now picks from TPI Master instead of being typed free-hand — the
  // same person used to arrive as "Mr. Sharma", "Mr sharma" and "R. Sharma", so
  // no TPI history could be grouped by inspector. Only ACTIVE inspectors are
  // offered; a retired one stays readable on the records he already signed.
  // Server-side search (limit 50) — never load the whole master into the page.
  const [inspectorSearch, setInspectorSearch] = useState('');
  const inspectorQuery = useTpiMastersList({
    search: inspectorSearch || undefined,
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const inspectorOptions = useMemo(
    () =>
      (inspectorQuery.data?.items ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.organization ?? '',
      })),
    [inspectorQuery.data],
  );

  // Legacy L21421-21428: purple "TPI DETAILS (Required)" box. The purple
  // belongs to the box + its heading — legacy's labels inside are plain.
  return (
    <div
      style={{
        border: '1px solid var(--purple)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 12,
        background: 'rgba(139,92,246,0.04)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>
        🔍 TPI Details
      </div>
      <div className="form-grid" style={{ gap: 10 }}>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 11 }}>
            Inspector Name<span className="req">★</span>
          </label>
          {/* What gets SAVED is unchanged: still the inspector's name as
              plain text (tpiInspector / operatorName), never an id — a TPI
              log is a record of what was true on the day and keeps its own
              name snapshot. Picking also fills Organization, which stays
              editable because a one-off site visit can differ from the
              inspector's usual firm. */}
          <SearchableSelect
            id={`tpi-inspector-${jcOpId}`}
            value={inspectorOptions.find((op) => op.code === inspector)?.id ?? null}
            valueLabel={inspector || undefined}
            onChange={(id) => {
              const picked = inspectorOptions.find((op) => op.id === id);
              setInspector(picked?.code ?? '');
              if (picked?.name) setOrganization(picked.name);
            }}
            onSearch={setInspectorSearch}
            loading={inspectorQuery.isFetching}
            options={inspectorOptions}
            selectedLabel={(op) => op.code ?? op.name}
            placeholder="Search Inspector…"
            emptyText="No Inspectors match. Add one in TPI Master."
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 11 }}>
            Organisation<span className="req">★</span>
          </label>
          <input
            className="innovic-input"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            placeholder="e.g. L&T QA Department"
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 11 }}>
            TPI Certificate No.
          </label>
          <input
            className="innovic-input"
            style={{ fontWeight: 700, color: 'var(--purple)' }}
            value={certNo}
            onChange={(e) => setCertNo(e.target.value)}
            placeholder="e.g. TPI-2026-045"
          />
        </div>
        <div className="form-grp">
          <label className="form-label" style={{ fontSize: 11 }}>
            Remarks
          </label>
          <input
            className="innovic-input"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Observations…"
          />
        </div>
      </div>
    </div>
  );
}
