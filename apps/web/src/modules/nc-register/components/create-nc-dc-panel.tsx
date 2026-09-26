// Create DC from an NC — the return-to-vendor challan (docs/QC-NC-HANDLING-
// DESIGN.md §5). Shown on the NC detail while the NC is `return_to_vendor` +
// `disposed` with no challan yet. Inline panel, like the dispose panel.

import type { CreateNcDcInput, NcRegister } from '@innovic/shared';
import { Loader2, Truck } from 'lucide-react';
import { useState } from 'react';
import { todayIst } from '@/lib/date';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { Note } from './nc-note';

// Return-to-vendor challan, raised from the NC (design §5). The DC date defaults
// to today (like every other DC/receipt screen); the qty is not asked because
// the challan line is the NC's full rejected qty by rule (interlock 4).
export function CreateNcDcPanel(props: {
  nc: NcRegister;
  pending: boolean;
  error: string | null;
  onSubmit: (input: CreateNcDcInput) => Promise<void> | void;
}): React.JSX.Element {
  const { nc, pending, error, onSubmit } = props;
  // Defaults to today, like every other DC / receipt screen (delivery-challans
  // create + receive, nc-register-form). It opened blank before, which left the
  // Save DC button disabled after a vendor was picked — a required ★ field the
  // user could not see was empty. Still editable.
  const [dcDate, setDcDate] = useState(todayIst());
  // Preselect the return vendor from the NC's source when the material came
  // from a vendor (GRN/OSP reject) — the server also defaults it, but showing
  // it here lets the operator see and confirm the supplier. Still overridable.
  const [vendorId, setVendorId] = useState<string | null>(nc.sourceVendorId ?? null);
  // The picker's label is "CODE — Name"; the challan stores the code text
  // alongside the id (the DC's ADR-015 pair), so the code is peeled off here.
  const [vendorCodeText, setVendorCodeText] = useState(nc.sourceVendorCode ?? '');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');

  const canSubmit = dcDate !== '' && vendorId != null && vendorCodeText !== '';

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!canSubmit) return;
    void onSubmit({
      dcDate,
      vendorId,
      vendorCodeText,
      transport: transport.trim() || null,
      vehicleNo: vehicleNo.trim() || null,
      remarks: remarks.trim() || null,
    });
  };

  return (
    <div className="panel">
      <div className="panel-hdr">
        <div className="panel-title">
          <Truck size={14} style={{ verticalAlign: -2 }} /> Create DC — return{' '}
          {Number(nc.rejectedQty)} pcs to vendor
        </div>
      </div>
      <div className="panel-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" htmlFor="ncDcDate">
                DC Date<span className="req">★</span>
              </label>
              <input
                id="ncDcDate"
                type="date"
                className="innovic-input"
                value={dcDate}
                onChange={(e) => setDcDate(e.target.value)}
                required
              />
            </div>
            <VendorPicker
              id="ncDcVendor"
              value={vendorId}
              initialLabel={
                nc.sourceVendorId && nc.sourceVendorCode
                  ? `${nc.sourceVendorCode}${nc.sourceVendorName ? ` — ${nc.sourceVendorName}` : ''}`
                  : ''
              }
              onChange={(id, label) => {
                setVendorId(id);
                setVendorCodeText(id ? (label.split(' — ')[0] ?? label) : '');
              }}
            />
            <div className="form-grp">
              <label className="form-label" htmlFor="ncDcTransport">
                Transport
              </label>
              <input
                id="ncDcTransport"
                className="innovic-input"
                maxLength={200}
                value={transport}
                onChange={(e) => setTransport(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="ncDcVehicle">
                Vehicle No.
              </label>
              <input
                id="ncDcVehicle"
                className="innovic-input"
                maxLength={50}
                value={vehicleNo}
                onChange={(e) => setVehicleNo(e.target.value)}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="ncDcRemarks">
                Remarks
              </label>
              <textarea
                id="ncDcRemarks"
                className="innovic-textarea"
                rows={2}
                maxLength={500}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          {error ? <Note tone="red">{error}</Note> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={pending || !canSubmit}>
              {pending ? <Loader2 size={13} className="animate-spin" /> : <Truck size={13} />}
              Save DC
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
