// Add Customer Material modal.
//
// ADR-203: a customer material is booked against a Customer RM item — an
// Item Master row of type Party Supplied Material (`<item code>-RM`). The user
// picks the Customer and that item; Material Name / Grade / Description / UOM
// fill from the item. The PM code is assigned by the server on save ("auto"),
// so it is no longer prefilled or sent.
//
// The old Customer → SO/JWSO → order-line cascade picked the PART being made,
// not the material — it is gone with this change. A JWSO line gets its Customer
// RM automatically when the JWSO is saved, so most materials never need this
// screen; it is for adding one by hand.

import { PARTY_MATERIAL_UOMS, type PartyMaterialUom } from '@innovic/shared';
import { useEffect, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useClientsList } from '../../clients/api';
import { useItem, useItemsList } from '../../items/api';
import { useDiscardGuard } from '../../store-inventory/components/discard-guard';
import { type NewPartyMaterialInput, useCreatePartyMaterial } from '../api';
import { ErrorBox, Field, ModalActions, ModalShell } from './party-material-modal-shell';

/** Item Master UOM → customer-material UOM (the two lists spell KG differently). */
function toPmUom(itemUom: string | null | undefined): PartyMaterialUom | null {
  if (!itemUom) return null;
  const u = itemUom === 'KGS' ? 'KG' : itemUom;
  return (PARTY_MATERIAL_UOMS as readonly string[]).includes(u) ? (u as PartyMaterialUom) : null;
}

export function AddPartyMaterialModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [uom, setUom] = useState<PartyMaterialUom>('NOS');
  const [err, setErr] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState('');
  const [itemId, setItemId] = useState<string | null>(null);
  const [itemSearch, setItemSearch] = useState('');
  const [description, setDescription] = useState(''); // auto-filled from item, editable

  const createMut = useCreatePartyMaterial();

  // Customer — server ?search=.
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

  // Customer RM — only Party Supplied Material (-RM) items, server-searched.
  const { data: itemsData, isFetching: itemsFetching } = useItemsList({
    ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
    itemType: 'party_supplied_material',
    limit: 50,
    offset: 0,
  });
  const itemOptions = (itemsData?.items ?? []).map((i) => ({
    id: i.id,
    code: i.code,
    name: i.name,
  }));

  // The picked item's own row → Material Name / Grade / Description / UOM.
  const itemQ = useItem(itemId ?? undefined);
  const item = itemQ.data && itemQ.data.id === itemId ? itemQ.data : null;
  const autoName = item?.name ?? '';
  const autoMaterial = item?.material ?? '';

  // Dependent fields follow the item: a new item refills them, a cleared item
  // clears them — never a stale value from the previous pick.
  useEffect(() => {
    if (!itemId) {
      setDescription('');
      setUom('NOS');
      return;
    }
    if (!item) return;
    setDescription(item.description ?? '');
    setUom(toPmUom(item.uom) ?? 'NOS');
  }, [itemId, item]);

  const guard = useDiscardGuard(Boolean(clientId || itemId || description.trim()), onClose);

  const onSave = (): void => {
    setErr(null);
    if (!clientId) {
      setErr('Customer is required.');
      return;
    }
    if (!itemId || !item) {
      setErr('Customer RM is required — pick the -RM item from the Item Master.');
      return;
    }
    const nm = autoName.trim();
    if (!nm) {
      setErr('The picked item has no name. Fix it in the Item Master first.');
      return;
    }
    const input: NewPartyMaterialInput = { name: nm, uom, clientId, itemId };
    if (description.trim()) input.description = description.trim();
    if (autoMaterial.trim()) input.material = autoMaterial.trim();
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
        {/* Code — assigned by the server on save. */}
        <Field label="Code">
          <input
            type="text"
            className="innovic-input"
            value=""
            placeholder="auto"
            readOnly
            disabled
            style={{ maxWidth: '14ch' }}
          />
        </Field>
        <Field label="UOM">
          <select
            className="innovic-select"
            value={uom}
            onChange={(e) => setUom(e.target.value as PartyMaterialUom)}
            style={{ maxWidth: '12ch' }}
          >
            {PARTY_MATERIAL_UOMS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </Field>

        {/* Customer — who supplies the material */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Customer" required>
            <SearchableSelect
              id="pmClient"
              value={clientId}
              onChange={setClientId}
              onSearch={setClientSearch}
              loading={clientsFetching}
              options={clientOptions}
              placeholder="🔍 Type customer code or name…"
            />
          </Field>
        </div>

        {/* Customer RM — a Party Supplied Material (-RM) item */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Customer RM" required>
            <SearchableSelect
              id="pmItem"
              value={itemId}
              onChange={setItemId}
              onSearch={setItemSearch}
              loading={itemsFetching}
              options={itemOptions}
              placeholder="🔍 Type the -RM item code or name…"
              emptyText="No Party Supplied Material item matches"
              valueLabel={item ? `${item.code} — ${item.name}` : undefined}
            />
          </Field>
        </div>

        {/* Material Name — from the item, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material Name">
            <input type="text" className="innovic-input" value={autoName} readOnly disabled />
          </Field>
        </div>

        {/* Description — from the item, editable */}
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

        {/* Grade — from the item, read-only */}
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Grade">
            <input type="text" className="innovic-input" value={autoMaterial} readOnly disabled />
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
