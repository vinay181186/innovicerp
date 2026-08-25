// Party Material Master (Store slice 1) — catalogue of client-supplied
// materials for Job Work orders.
// Mirrors legacy renderPartyMaterial (HTML L24129) + addPartyMaterial
// (L24173) + editPartyMaterial (L24214) + delPartyMaterial (L24233).

import {
  type CreatePartyMaterialInput,
  PARTY_MATERIAL_UOMS,
  type PartyMaterialListItem,
  type PartyMaterialUom,
  type UpdatePartyMaterialInput,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useClientsList } from '../../clients/api';
import { useItem } from '../../items/api';
import { useJobWorkOrder, useJobWorkOrdersList } from '../../job-work-orders/api';
import { useSalesOrder, useSalesOrdersList } from '../../sales-orders/api';
import { usePlanningSoDetail } from '../../so-planning/api';
import {
  useCreatePartyMaterial,
  useDeletePartyMaterial,
  useNextPartyMaterialCode,
  usePartyMaterialsList,
  useUpdatePartyMaterial,
} from '../api';

const PAGE_SIZE = 50;

export const partyMaterialsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'party-material',
  component: PartyMaterialsListPage,
});

function PartyMaterialsListPage(): React.JSX.Element {
  // Tier-driven, per department (party_create sits in Store). Replaces the old
  // admin/manager flag, which collapsed all seven tiers into two.
  //   + Add -> entry (L2 Data Entry and up)
  //   Edit  -> edit  (L3 Editor and up; L2 creates but cannot alter)
  //   Del   -> edit AND approve. Delete is not one of the four tier actions, so
  //     it is expressed as the pair only L5 Department Admin and above hold: L3
  //     has edit without approve, L4 has approve without edit. Previously this
  //     was admin-only, which locked out the L5 Store Department Admin — the
  //     tier meant to have full rights inside Store.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'party_create');
  const canAdd = perms.entry;
  const canEdit = perms.edit;
  const canDelete = perms.edit && perms.approve;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState<PartyMaterialListItem | null>(null);

  const { data, isLoading, isError, error } = usePartyMaterialsList({
    search: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const deleteMut = useDeletePartyMaterial();

  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE));

  const onDelete = (row: PartyMaterialListItem): void => {
    if (row.stockQty > 0) {
      window.alert(
        `Cannot delete "${row.code}" — stock qty is ${row.stockQty}. Issue material first.`,
      );
      return;
    }
    if (!window.confirm(`Delete party material "${row.code} — ${row.name}"?`)) return;
    deleteMut.mutate(row.id);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">🏭 Party Supplied Material Master</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            className="innovic-input"
            placeholder="🔍 Search material, client…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{ width: 240, fontSize: 12 }}
          />
          {canAdd ? (
            <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={14} /> Add Material
            </button>
          ) : null}
        </div>
      </div>

      <div className="panel">
        {isLoading ? (
          <div className="panel-body">
            <div className="text3" style={{ fontSize: 12 }}>
              <Loader2 size={14} className="inline animate-spin" /> Loading…
            </div>
          </div>
        ) : isError ? (
          <div className="panel-body">
            <div className="empty-state" style={{ color: 'var(--red)' }}>
              {error instanceof Error ? error.message : 'Failed to load party materials'}
            </div>
          </div>
        ) : data ? (
          <div className="tbl-wrap">
            <table className="innovic-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Material</th>
                  <th className="td-ctr">UOM</th>
                  <th>Client</th>
                  <th className="td-ctr" style={{ color: 'var(--green)' }}>
                    In Stock
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--amber)' }}>
                    Issued
                  </th>
                  <th className="td-ctr" style={{ color: 'var(--cyan)' }}>
                    Total Received
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="empty-state">
                      No party materials — click + Add Material
                    </td>
                  </tr>
                ) : null}
                {data.items.map((pm) => (
                  <tr key={pm.id}>
                    <td>
                      <span className="td-code" style={{ color: 'var(--purple)' }}>
                        {pm.code}
                      </span>
                    </td>
                    <td className="fw-700">{pm.name}</td>
                    <td className="text2" style={{ fontSize: 11 }}>
                      {pm.description ?? '—'}
                    </td>
                    <td>{pm.material ?? '—'}</td>
                    <td className="td-ctr">
                      <span
                        className="tag"
                        style={{ background: 'var(--bg4)', color: 'var(--text2)' }}
                      >
                        {pm.uom}
                      </span>
                    </td>
                    <td className="fw-700">{pm.clientName ?? pm.clientCodeText ?? '—'}</td>
                    <td
                      className="td-ctr mono fw-700"
                      style={{
                        fontSize: 14,
                        color: pm.stockQty > 0 ? 'var(--green)' : 'var(--text3)',
                      }}
                    >
                      {pm.stockQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 12, color: 'var(--amber)' }}>
                      {pm.issuedQty}
                    </td>
                    <td className="td-ctr mono" style={{ fontSize: 12, color: 'var(--cyan)' }}>
                      {pm.receivedQty}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canEdit ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => setEditRow(pm)}
                          >
                            Edit
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            style={{ fontSize: 11 }}
                            onClick={() => onDelete(pm)}
                          >
                            Del
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {data ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: 8,
            fontSize: 12,
            color: 'var(--text3)',
          }}
        >
          <span>
            {data.total === 0
              ? 'No materials'
              : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, data.total)} of ${data.total}`}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span style={{ fontFamily: 'var(--mono)', padding: '0 8px' }}>
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}

      <div className="text3" style={{ fontSize: 11, marginTop: 6, padding: '0 4px' }}>
        💡 Party Material Master tracks raw materials supplied by clients for Job Work orders. Stock
        is updated via Party Material GRN. Separate from company inventory.
      </div>

      {showAdd ? <AddPartyMaterialModal onClose={() => setShowAdd(false)} /> : null}
      {editRow ? <EditPartyMaterialModal row={editRow} onClose={() => setEditRow(null)} /> : null}
    </div>
  );
}

// ─── Add modal ─────────────────────────────────────────────────────────────

function AddPartyMaterialModal({ onClose }: { onClose: () => void }): React.JSX.Element {
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
      orderLines.map((l) => ({
        id: l.id,
        code: (l as { itemCode?: string | null }).itemCode ?? l.itemCodeText ?? null,
        name: l.partName,
      })),
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

  const onSave = (): void => {
    setErr(null);
    const c = code.trim();
    const nm = autoName.trim();
    if (!c) {
      setErr('Material code is missing');
      return;
    }
    if (!clientId) {
      setErr('Client is required');
      return;
    }
    if (!nm) {
      setErr('Pick an item so the material name is filled');
      return;
    }
    const input: CreatePartyMaterialInput = { code: c, name: nm, uom, clientId };
    if (description.trim()) input.description = description.trim();
    if (autoMaterial.trim()) input.material = autoMaterial.trim();
    if (itemId) input.itemId = itemId;
    createMut.mutate(input, {
      onSuccess: () => onClose(),
      onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to create'),
    });
  };

  return (
    <ModalShell onClose={onClose} title="🏭 Add Party Material">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* 1. Material Code (auto, read-only) + UOM */}
        <Field label="Material Code (auto)">
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
          <Field label="Client ★ (who supplies this material)">
            <SearchableSelect
              id="pmClient"
              value={clientId}
              onChange={onClientChange}
              onSearch={setClientSearch}
              loading={clientsFetching}
              options={clientOptions}
              placeholder="🔍 Type client code or name…"
            />
          </Field>
        </div>

        {/* 3. SO / JWSO — filtered to the picked client */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="SO / JWSO No">
            <SearchableSelect
              id="pmOrder"
              value={orderId}
              onChange={onOrderChange}
              onSearch={setOrderSearch}
              loading={soFetching || jwFetching}
              options={orderOptions}
              disabled={!clientId}
              placeholder={clientId ? '🔍 Type SO / JWSO no…' : 'Pick a client first'}
              emptyText="No orders for this client"
            />
          </Field>
        </div>

        {/* 4. Item Code — from the picked order's line items */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Item Code">
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
          <Field label="Material Name ★ (auto)">
            <input
              type="text"
              className="innovic-input"
              value={autoName}
              readOnly
              disabled
              placeholder="Fills from the chosen item"
            />
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
              placeholder="Fills from the item — editable"
            />
          </Field>
        </div>

        {/* 7. Material / Grade — auto-fetched from the item, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material / Grade (auto)">
            <input
              type="text"
              className="innovic-input"
              value={autoMaterial}
              readOnly
              disabled
              placeholder="Fills from the chosen item"
            />
          </Field>
        </div>

        {/* 8. JC No — auto-fetched Job Card linked to the SO/JW line, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="JC No (auto)">
            <input
              type="text"
              className="innovic-input"
              value={lineId ? jcNo || '—' : ''}
              readOnly
              disabled
              placeholder="Job Card linked to this line"
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

// ─── Edit modal ────────────────────────────────────────────────────────────

function EditPartyMaterialModal({
  row,
  onClose,
}: {
  row: PartyMaterialListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description ?? '');
  const [material, setMaterial] = useState(row.material ?? '');
  const [uom, setUom] = useState<PartyMaterialUom>(
    (PARTY_MATERIAL_UOMS.includes(row.uom as PartyMaterialUom)
      ? row.uom
      : 'NOS') as PartyMaterialUom,
  );
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(row.clientId);
  const [err, setErr] = useState<string | null>(null);
  const [clientFocused, setClientFocused] = useState(false);

  const { data: clientsData } = useClientsList({
    search: clientSearch.trim() || undefined,
    limit: 50,
    offset: 0,
  });
  const selectedClient = useMemo(() => {
    if (clientId === row.clientId) {
      // Default: preserve the existing display until user types a search
      return {
        id: row.clientId ?? '',
        code: row.clientCodeText ?? '',
        name: row.clientName ?? row.clientCodeText ?? '',
      };
    }
    return clientsData?.clients.find((c) => c.id === clientId) ?? null;
  }, [clientId, clientsData, row]);

  const updateMut = useUpdatePartyMaterial();

  const onSave = (): void => {
    setErr(null);
    const nm = name.trim();
    if (!nm) {
      setErr('Name is required');
      return;
    }
    if (!clientId) {
      setErr('Client is required');
      return;
    }
    const input: UpdatePartyMaterialInput = {
      name: nm,
      uom,
      clientId,
    };
    input.description = description.trim();
    input.material = material.trim();
    updateMut.mutate(
      { id: row.id, input },
      {
        onSuccess: () => onClose(),
        onError: (e) => setErr(e instanceof Error ? e.message : 'Failed to update'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`🏭 Edit Party Material — ${row.code}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Material Code">
          <input
            type="text"
            className="innovic-input"
            value={row.code}
            readOnly
            style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
          />
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

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Linked Item (from Item Master)">
            <input
              type="text"
              className="innovic-input"
              value={`${row.itemCode ?? row.itemCodeText ?? '—'}${
                row.itemName ? ` — ${row.itemName}` : ''
              }`}
              readOnly
              style={{ background: 'var(--bg4)', color: 'var(--text3)' }}
            />
          </Field>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material Name ★">
            <input
              type="text"
              className="innovic-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </div>

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

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material / Grade">
            <input
              type="text"
              className="innovic-input"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </Field>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Client">
            <input
              type="text"
              className="innovic-input"
              placeholder="🔍 Click to browse or type client code / name to change…"
              value={
                selectedClient ? `${selectedClient.code} — ${selectedClient.name}` : clientSearch
              }
              onFocus={() => setClientFocused(true)}
              onBlur={() => setTimeout(() => setClientFocused(false), 150)}
              onChange={(e) => {
                setClientId(null);
                setClientSearch(e.target.value);
              }}
            />
            {!clientId && (clientSearch || clientFocused) && clientsData ? (
              <Picklist
                items={clientsData.clients.slice(0, 20).map((c) => ({
                  id: c.id,
                  label: `${c.code} — ${c.name}`,
                  sub: null,
                }))}
                onPick={(id) => {
                  setClientId(id);
                  setClientSearch('');
                }}
              />
            ) : null}
          </Field>
        </div>
      </div>

      {err ? <ErrorBox message={err} /> : null}

      <ModalActions
        onClose={onClose}
        onSave={onSave}
        saving={updateMut.isPending}
        saveLabel="Save Changes"
      />
    </ModalShell>
  );
}

// ─── Shared bits ───────────────────────────────────────────────────────────

function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          {title}
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalActions({
  onClose,
  onSave,
  saving,
  saveLabel,
}: {
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  saveLabel: string;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        Cancel
      </button>
      <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
        {saving ? (
          <>
            <Loader2 size={14} className="inline animate-spin" /> Saving…
          </>
        ) : (
          saveLabel
        )}
      </button>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div
        className="text3"
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

function Picklist({
  items,
  onPick,
}: {
  items: Array<{ id: string; label: string; sub: string | null }>;
  onPick: (id: string) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        border: '1px solid var(--border)',
        borderRadius: 4,
        background: 'var(--bg2)',
        marginTop: 4,
        maxHeight: 180,
        overflowY: 'auto',
      }}
    >
      {items.map((it) => (
        <div
          key={it.id}
          onClick={() => onPick(it.id)}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            fontSize: 12,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--purple)', fontWeight: 700 }}>{it.label}</span>
          {it.sub ? <span style={{ color: 'var(--text3)', marginLeft: 6 }}>· {it.sub}</span> : null}
        </div>
      ))}
    </div>
  );
}

function ErrorBox({ message }: { message: string }): React.JSX.Element {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 8,
        background: 'rgba(239,68,68,0.08)',
        color: 'var(--red)',
        borderRadius: 4,
        fontSize: 12,
      }}
    >
      {message}
    </div>
  );
}
