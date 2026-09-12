// Create DC from an NC — the return-to-vendor challan (docs/QC-NC-HANDLING-
// DESIGN.md §5). Shown on the NC detail while the NC is `return_to_vendor` +
// `disposed` with no challan yet. Inline panel, like the dispose panel.

import type { CreateNcDcInput, NcRegister } from '@innovic/shared';
import { Loader2, Truck } from 'lucide-react';
import { useState } from 'react';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { Note } from './nc-note';

// Return-to-vendor challan, raised from the NC (design §5). Every mandatory
// field opens blank — the date included; the qty is not asked because the
// challan line is the NC's full rejected qty by rule (interlock 4).
export function CreateNcDcPanel(props: {
  nc: NcRegister;
  pending: boolean;
  error: string | null;
  onSubmit: (input: CreateNcDcInput) => Promise<void> | void;
}): React.JSX.Element {
  const { nc, pending, error, onSubmit } = props;
  const [dcDate, setDcDate] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(null);
  // The picker's label is "CODE — Name"; the challan stores the code text
  // alongside the id (the DC's ADR-015 pair), so the code is peeled off here.
  const [vendorCodeText, setVendorCodeText] = useState('');
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
        <span className="text3" style={{ fontSize: 11 }}>
          Reference: <span className="mono">{nc.code}</span>
        </span>
      </div>
      <div className="panel-body">
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" htmlFor="ncDcDate">
                DC date<span className="req">★</span>
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
                Vehicle No
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
              Create DC
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
