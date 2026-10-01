// Add Customer Material modal — Client → SO/JWSO → Item(line) cascade.
// Split out of routes/list.tsx (ADR-199 table-standard conversion, 2026-10-01).
// Behaviour unchanged from the original in-file AddPartyMaterialModal.

import {
  type CreatePartyMaterialInput,
  PARTY_MATERIAL_UOMS,
  type PartyMaterialUom,
} from '@innovic/shared';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { useClientsList } from '../../clients/api';
import { useItem } from '../../items/api';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useSalesOrder, useSalesOrdersList } from '../../sales-orders/api';
import { usePlanningSoDetail } from '../../so-planning/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { useCreatePartyMaterial, useNextPartyMaterialCode } from '../api';
import { ErrorBox, Field, ModalActions, ModalShell } from './party-material-modal-shell';

export function AddPartyMaterialModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  // Material code — auto, read-only (PM-NNNN from the server).
  const [code, setCode] = useState('');
  const [uom, setUom] = useState<PartyMaterialUom>('NOS');
  const [err, setErr] = useState<string | null>(null);

  // Cascade: Client → SO/JWSO → Item(line). Picking a parent resets its children.
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [orderSource, setOrderSource] = useState<'so' | 'jw' | null>(null);
  const [orderSearch, setOrderSearch] = useState('');
  const [lineId, setLineId] = useState<string | null>(null); // picked SO/JW line id
  const [description, setDescription] = useState(''); // auto-filled from item, editable

  const createMut = useCreatePartyMaterial();

  const nextCodeQ = useNextPartyMaterialCode();
  useEffect(() => {
    if (nextCodeQ.data?.code && !code) setCode(nextCodeQ.data.code);
  }, [nextCodeQ.data, code]);

  // 1) Clients — server ?search=.
  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
    ...(clientSearch.trim() ? { search: clientSearch.trim() } : {}),
    limit: 50,
    offset: 0,
  });
  const clientOptions = (clientsData?.clients ?? []).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
  }));

  // 2) SO + JWSO for the picked client — server ?search= + clientId.
  const { data: soData, isFetching: soFetching } = useSalesOrdersList(
    {
      ...(orderSearch.trim() ? { search: orderSearch.trim() } : {}),
      clientId: clientId ?? undefined,
      limit: 50,
      offset: 0,
    },
    { enabled: !!clientId },
  );
  const { data: jwData, isFetching: jwFetching } = useJobWorkOrdersList(
    {
      ...(orderSearch.trim() ? { search: orderSearch.trim() } : {}),
      clientId: clientId ?? undefined,
      limit: 50,
      offset: 0,
    },
    { enabled: !!clientId },
  );
  const orderSourceById = useMemo(() => {
    const m = new Map<string, 'so' | 'jw'>();
    (soData?.items ?? []).forEach((o) => m.set(o.id, 'so'));
    (jwData?.items ?? []).forEach((o) => m.set(o.jwId, 'jw'));
    return m;
  }, [soData, jwData]);
  const orderOptions = useMemo(
    () => [
      ...(soData?.items ?? []).map((o) => ({
        id: o.id,
        code: o.code,
        name: o.customerName ?? 'SO',
      })),
      ...(jwData?.items ?? []).map((o) => ({
        id: o.jwId,
        code: o.code,
        name: o.customerName ?? 'JWSO',
      })),
    ],
    [soData, jwData],
  );

  // 3) Line items of the picked order (client-side filtered by the picker).
  const soDetail = useSalesOrder(orderSource === 'so' ? (orderId ?? undefined) : undefined);
  const jwDetail = useJobWorkOrder(orderSource === 'jw' ? (orderId ?? undefined) : undefined);
  const orderLines = useMemo(() => {
    if (orderSource === 'so') return soDetail.data?.lines ?? [];
    if (orderSource === 'jw') return jwDetail.data?.lines ?? [];
    return [];
  }, [orderSource, soDetail.data, jwDetail.data]);
  const itemOptions = useMemo(
    () =>
      orderLines.map((l) => {
        const code = (l as { itemCode?: string | null }).itemCode ?? l.itemCodeText ?? null;
        // CODE/REV: the row IS an order line (SO or JWSO), so the customer's
        // drawing revision typed on that line belongs with the code wherever it
        // is shown (user rule 2026-09-23). A line with no code stays null.
        return {
          id: l.id,
          code: code
            ? itemCodeWithRev(code, (l as { revision?: string | null }).revision, code)
            : null,
          name: l.partName,
        };
      }),
    [orderLines],
  );
  const selectedLine = useMemo(
    () => orderLines.find((l) => l.id === lineId) ?? null,
    [orderLines, lineId],
  );
  const itemId = selectedLine?.itemId ?? null;

  // 4) Item-master detail → auto-fetched Material Name + Material/Grade.
  const itemDetail = useItem(itemId ?? undefined);
  const autoName = itemDetail.data?.name ?? selectedLine?.partName ?? '';
  const autoMaterial = itemDetail.data?.material ?? selectedLine?.material ?? '';

  // Description auto-fills from the item on pick, then stays editable.
  useEffect(() => {
    if (!lineId) {
      setDescription('');
      return;
    }
    setDescription(itemDetail.data?.description ?? '');
  }, [lineId, itemDetail.data?.description]);

  // 5) JC No linked to the selected SO/JW line (via planning detail).
  const planningDetail = usePlanningSoDetail(orderId);
  const jcNo = useMemo(() => {
    if (!lineId || !planningDetail.data) return '';
    const ln = planningDetail.data.lines.find((l) => l.soLineId === lineId);
    if (!ln) return '';
    const codes = [
      ...ln.plans.map((p) => p.jcCode).filter((v): v is string => !!v),
      ...ln.directJcCodes,
    ];
    return codes.join(', ');
  }, [lineId, planningDetail.data]);

  // Cascade resets: picking a parent clears its children + auto-fetched fields.
  const onClientChange = (id: string | null): void => {
    setClientId(id);
    setOrderId(null);
    setOrderSource(null);
    setOrderSearch('');
    setLineId(null);
    setDescription('');
  };
  const onOrderChange = (id: string | null): void => {
    setOrderId(id);
    setOrderSource(id ? (orderSourceById.get(id) ?? null) : null);
    setLineId(null);
    setDescription('');
  };

  // ESC / a click outside asks before throwing away what was picked.
  const guard = useDiscardGuard(
    Boolean(clientId || orderId || lineId || description.trim()) || uom !== 'NOS',
    onClose,
  );

  const onSave = (): void => {
    setErr(null);
    const c = code.trim();
    const nm = autoName.trim();
    if (!c) {
      setErr('Code is required.');
      return;
    }
    if (!clientId) {
      setErr('Customer is required.');
      return;
    }
    if (!orderId) {
      setErr('SO / JWSO No. is required — the Item Code is picked from its lines.');
      return;
    }
    if (!nm) {
      setErr('Item Code is required. Material Name fills from it.');
      return;
    }
    const input: CreatePartyMaterialInput = { code: c, name: nm, uom, clientId };
    if (description.trim()) input.description = description.trim();
    if (autoMaterial.trim()) input.material = autoMaterial.trim();
    if (itemId) input.itemId = itemId;
    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) =>
        setErr(e instanceof Error ? e.message : 'Could not save Material. Try again.'),
    });
  };

  return (
    <ModalShell onClose={guard.requestClose} title="Add Customer Material">
      {guard.dialog}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 1. Material Code (auto, read-only) + UOM */}
        <Field label="Code">
          <input type="text" className="innovic-input" value={code} readOnly disabled />
        </Field>
        <Field label="UOM">
          <select
            className="innovic-select"
            value={uom}
            onChange={(e) => setUom(e.target.value as PartyMaterialUom)}
          >
            {PARTY_MATERIAL_UOMS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>

        {/* 2. Client — who supplies the material */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Customer" required>
            <SearchableSelect
              id="pmClient"
              value={clientId}
              onChange={onClientChange}
              onSearch={setClientSearch}
              loading={clientsFetching}
              options={clientOptions}
              placeholder="🔍 Type customer code or name…"
            />
          </Field>
        </div>

        {/* 3. SO / JWSO — filtered to the picked client */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="SO / JWSO No." required>
            <SearchableSelect
              id="pmOrder"
              value={orderId}
              onChange={onOrderChange}
              onSearch={setOrderSearch}
              loading={soFetching || jwFetching}
              options={orderOptions}
              disabled={!clientId}
              placeholder={clientId ? '🔍 Type SO / JWSO no…' : 'Pick a customer first'}
              emptyText="No orders for this customer"
            />
          </Field>
        </div>

        {/* 4. Item Code — from the picked order's line items */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Item Code" required>
            <SearchableSelect
              id="pmItem"
              value={lineId}
              onChange={setLineId}
              onSearch={() => undefined}
              loading={soDetail.isFetching || jwDetail.isFetching}
              options={itemOptions}
              disabled={!orderId}
              placeholder={orderId ? '🔍 Pick an item from this order…' : 'Pick an order first'}
              emptyText="No items on this order"
            />
          </Field>
        </div>

        {/* 5. Material Name — auto-fetched from the item, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material Name">
            <input type="text" className="innovic-input" value={autoName} readOnly disabled />
          </Field>
        </div>

        {/* 6. Description — auto-filled from the item, editable */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Description">
            <input
              type="text"
              className="innovic-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>

        {/* 7. Material / Grade — auto-fetched from the item, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Grade">
            <input type="text" className="innovic-input" value={autoMaterial} readOnly disabled />
          </Field>
        </div>

        {/* 8. JC No — auto-fetched Job Card linked to the SO/JW line, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="JC No.">
            <input
              type="text"
              className="innovic-input"
              value={lineId ? jcNo || '—' : ''}
              readOnly
              disabled
            />
          </Field>
        </div>
      </div>

      {err ? <ErrorBox message={err} /> : null}

      <ModalActions
        onClose={onClose}
        onSave={onSave}
        saving={createMut.isPending}
        saveLabel="Save Material"
      />
    </ModalShell>
  );
}
