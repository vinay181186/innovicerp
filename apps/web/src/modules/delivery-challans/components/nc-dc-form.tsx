// The return-to-vendor DC form for ONE or SEVERAL NCs (owner 2026-11-01) —
// +New DC → Against NC and Against JW PO / DC both end here once the NCs are
// ticked. Every NC is of the same SO and goes to the same vendor (the picker
// enforces it; the server checks it again). One DC, one line per NC, saved by
// useCreateNcDcBatch → POST /nc-register/create-dc — the NC endpoint, NEVER
// createDeliveryChallan: only it sets each NC's linkage, flips it to
// sent_to_vendor and holds the one-challan-per-NC lock.
//
// The lines are read-only: each NC returns its full rejected qty (interlock 4)
// against its own JW PO, so different JW POs inside the one SO each show on
// their own line. Vendor (pre-filled from the NCs' source vendor, editable), DC
// Date, Transporter, Vehicle No. and Remarks are the user's.

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Truck } from 'lucide-react';
import { useRef, useState } from 'react';
import { VendorPicker } from '@/components/shared/vendor-picker';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { ApiError } from '@/lib/api';
import { todayIst } from '@/lib/date';
import type { ExitConfirm } from '@/lib/exit-guard';
import { useSaveKey } from '@/lib/use-save-key';
import { ncRegisterKeys, useCreateNcDcBatch } from '@/modules/nc-register/api';
import { DataTable, type DataTableColumn } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { Banner, useToast } from '@/ui/feedback';
import { FormField, FormGrid } from '@/ui/forms';
import { deliveryChallansKeys } from '../api';
import { type DcSaveCtl, useReportSave } from '../lib/dc-save-ctl';
import type { PickNc } from '../lib/nc-dc-pick';

const LINE_COLUMNS: DataTableColumn<PickNc>[] = [
  {
    id: 'lineNo',
    header: 'Ln',
    kind: 'num',
    align: 'right',
    className: 'mono',
    render: (_r, i) => i + 1,
  },
  { id: 'ncCode', header: 'NC No.', kind: 'code', className: 'mono fw-700', key: 'ncCode' },
  {
    id: 'pol',
    header: 'POL',
    headColor: 'var(--purple)',
    kind: 'code',
    className: 'mono fw-700',
    render: (r) => <span style={{ color: 'var(--purple)' }}>{r.clientPoLineNo ?? '—'}</span>,
  },
  {
    id: 'itemCode',
    header: 'Item Code',
    kind: 'code',
    render: (r) => (
      <b className="mono fw-700" style={{ color: 'var(--text)' }}>
        {r.itemCodeLabel}
      </b>
    ),
  },
  {
    id: 'itemName',
    header: 'Item Name',
    kind: 'text',
    ellipsis: true,
    render: (r) => r.itemName,
    title: (r) => r.itemName,
  },
  {
    id: 'qtyToReturn',
    header: 'Qty to Return',
    kind: 'num',
    align: 'right',
    className: 'mono fw-700',
    render: (r) => <span style={{ color: 'var(--red2)' }}>{Number(r.qtyToReturn)}</span>,
    total: (rows) => rows.reduce((s, r) => s + Number(r.qtyToReturn), 0),
  },
  {
    id: 'jwPoNo',
    header: 'JW PO No.',
    kind: 'code',
    className: 'mono',
    render: (r) => r.poCode ?? '—',
  },
  {
    // The outward challan the rejected pieces first went out on.
    id: 'sentOnDcNo',
    header: 'Sent on DC No.',
    kind: 'code',
    className: 'mono',
    render: (r) => r.sourceDcCode ?? '—',
  },
];

export function NcDcFormBody({
  picked,
  onChangeNcs,
  exit,
  saveCtl,
}: {
  /** The ticked NCs, in line order. */
  picked: PickNc[];
  /** Back to the picker, ticks kept. */
  onChangeNcs: () => void;
  exit: ExitConfirm;
  saveCtl: DcSaveCtl;
}): React.JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: eff } = useMyAccess();
  // Same gate the NC detail page and the server enforce for this challan
  // (ADR-211): OSP Outward DC ENTRY raises the return challan, on every route.
  const canCreateDc = effectiveFormPerms(eff, 'ospdc_create').entry;
  // R2 — one idempotency key per open form, reused on a retry after a dropped save.
  const saveKey = useSaveKey();
  const createDc = useCreateNcDcBatch(saveKey);
  const toast = useToast();

  // The goods go back to the vendor they came from: the NCs' shared source
  // vendor (all ticked NCs agree, or have none). Editable.
  const source = picked.find((p) => p.vendorId !== null);
  const sourceVendorId = source?.vendorId ?? null;
  const sourceVendorCode = source?.vendorCode ?? '';
  const sourceVendorLabel = source
    ? [source.vendorCode, source.vendorName].filter(Boolean).join(' — ')
    : '';

  const [dcDate, setDcDate] = useState(todayIst());
  const [vendorId, setVendorId] = useState<string | null>(sourceVendorCode ? sourceVendorId : null);
  // The picker's label is "CODE — Name"; the challan stores the code text.
  const [vendorCodeText, setVendorCodeText] = useState(sourceVendorId ? sourceVendorCode : '');
  const [transport, setTransport] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Double-click / Ctrl+S twice before the re-render: the ref stops the second.
  const inFlight = useRef(false);

  const canSubmit = picked.length > 0 && dcDate !== '' && vendorId != null && vendorCodeText !== '';
  // The pre-filled source vendor is not the user's typing — only a change is.
  const dirty =
    vendorId !== (sourceVendorCode ? sourceVendorId : null) ||
    transport !== '' ||
    vehicleNo !== '' ||
    remarks !== '';
  useReportSave(saveCtl, {
    canSave: canCreateDc && canSubmit,
    saving: submitting,
    dirty,
    reason: !canCreateDc
      ? 'You do not have permission to create a return DC'
      : picked.length === 0
        ? 'Tick at least one NC first'
        : dcDate === ''
          ? 'Enter the DC Date'
          : vendorId == null || vendorCodeText === ''
            ? 'Pick the Vendor first'
            : null,
  });

  const onSubmit = async (): Promise<void> => {
    if (inFlight.current || !canSubmit) return;
    inFlight.current = true;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await createDc.mutateAsync({
        ncIds: picked.map((p) => p.ncId),
        dcDate,
        vendorId,
        vendorCodeText,
        transport: transport.trim() || null,
        vehicleNo: vehicleNo.trim() || null,
        remarks: remarks.trim() || null,
      });
      toast.ok(`DC ${created.deliveryChallanCode} saved`);
      exit.leave(
        () =>
          void navigate({
            to: '/delivery-challans/$id',
            params: { id: created.deliveryChallanId },
          }),
      );
    } catch (e) {
      // 409 — another user / route raised a challan for one of these NCs
      // first, or the set broke the same-SO / same-vendor rule. Refetch both
      // pickers so the stale rows go.
      if (e instanceof ApiError && e.status === 409) {
        void qc.invalidateQueries({ queryKey: deliveryChallansKeys.rtvCandidatesAll() });
        void qc.invalidateQueries({ queryKey: ncRegisterKeys.lists() });
      }
      setSubmitError(e instanceof Error ? e.message : 'Could not save DC. Try again.');
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  // The page's bottom Save (and Ctrl+S) run this body's save.
  saveCtl.submitRef.current = () => void onSubmit();

  if (eff && !canCreateDc) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)' }}>
        You do not have permission to create a return DC. Ask an admin.
      </div>
    );
  }

  const soLabel = picked[0]?.soLabel ?? null;

  return (
    <>
      {submitError ? (
        <Banner tone="error" role="alert">
          {submitError}
        </Banner>
      ) : null}
      <div
        style={{
          fontSize: 'var(--fs-sm)',
          fontWeight: 700,
          color: 'var(--blue)',
          marginBottom: 'var(--sp-2)',
        }}
      >
        <Truck size={14} style={{ verticalAlign: -2 }} /> Create Return-to-Vendor Challan
        {soLabel ? (
          <span className="text2" style={{ fontWeight: 400, marginLeft: 'var(--sp-2)' }}>
            SO No. <b className="mono">{soLabel}</b> · {picked.length} NC
            {picked.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {/* Read off the NCs — none of it is typed here, none of it can be edited. */}
      <DataTable
        tableKey={TABLE_KEYS.dcRtvNcLines}
        columns={LINE_COLUMNS}
        rows={picked}
        rowKey={(r) => r.ncId}
        sortFilter={false}
        showTotals
      />
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)', margin: '8px 0 14px' }}
      >
        {/* Back to the picker WITHOUT leaving the screen; the ticks are kept. */}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onChangeNcs}>
          <ArrowLeft size={12} /> Change NCs
        </button>
        <span className="text3" style={{ fontSize: 'var(--fs-xs)' }}>
          Each NC goes back in full on its own line. The vendor is pre-filled from the NCs and may
          be changed.
        </span>
      </div>

      {/* 12-column grid, party first: Vendor · DC Date · Transporter ·
          Vehicle No (4 + 3 + 3 + 2), then Remarks (full). */}
      <FormGrid>
        <VendorPicker
          id="ncdc-vendor"
          className="form-grp f-md"
          value={vendorId}
          initialLabel={sourceVendorLabel}
          onChange={(id, label) => {
            setVendorId(id);
            setVendorCodeText(id ? (label.split(' — ')[0] ?? label) : '');
          }}
        />
        <FormField label="DC Date" required size="sm" htmlFor="ncdc-date">
          <input
            id="ncdc-date"
            type="date"
            className="innovic-input"
            value={dcDate}
            onChange={(e) => setDcDate(e.target.value)}
            required
          />
        </FormField>
        <FormField label="Transporter" size="sm" htmlFor="ncdc-transport">
          <input
            id="ncdc-transport"
            className="innovic-input"
            maxLength={200}
            value={transport}
            onChange={(e) => setTransport(e.target.value)}
            placeholder="Transporter name"
          />
        </FormField>
        <FormField label="Vehicle No." size="xs" htmlFor="ncdc-vehicle-no">
          <input
            id="ncdc-vehicle-no"
            className="innovic-input"
            maxLength={50}
            value={vehicleNo}
            onChange={(e) => setVehicleNo(e.target.value)}
            placeholder="GJ-01-AB-1234"
          />
        </FormField>
        <FormField label="Remarks" size="full" htmlFor="ncdc-remarks">
          <textarea
            id="ncdc-remarks"
            className="innovic-textarea"
            rows={2}
            maxLength={500}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="optional"
          />
        </FormField>
      </FormGrid>
    </>
  );
}
