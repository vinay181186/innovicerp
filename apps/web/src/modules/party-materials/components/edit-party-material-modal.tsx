// Edit Customer Material modal.
//
// ADR-203: only the fields the user actually changed are sent. Customer,
// Customer RM item are fixed once the material has any register movement
// (received / in stock / issued / returned) — the server refuses a change
// then, so the screen locks those two and says why. UOM is always NOS
// (ADR-203 D1) — shown read-only and never sent.

import { type PartyMaterialListItem, type UpdatePartyMaterialInput } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useClientsList } from '../../clients/api';
import { useItemsList } from '../../items/api';
import { useUpdatePartyMaterial } from '../api';
import { ErrorBox, Field, ModalActions, ModalShell } from './party-material-modal-shell';

export function EditPartyMaterialModal({
  row,
  onClose,
}: {
  row: PartyMaterialListItem;
  onClose: () => void;
}): React.JSX.Element {
  const [name, setName] = useState(row.name);
  const [description, setDescription] = useState(row.description ?? '');
  const [material, setMaterial] = useState(row.material ?? '');
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(row.clientId);
  const [itemSearch, setItemSearch] = useState('');
  const [itemId, setItemId] = useState<string | null>(row.itemId);
  const [err, setErr] = useState<string | null>(null);

  // Any register movement fixes Customer / Customer RM (server rule).
  const hasMovement =
    row.stockQty > 0 || row.receivedQty > 0 || row.issuedQty > 0 || row.returnedQty > 0;

  const { data: clientsData, isFetching: clientsFetching } = useClientsList({
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

  // Customer RM — Party Supplied Material (-RM) items only.
  const { data: itemsData, isFetching: itemsFetching } = useItemsList(
    {
      ...(itemSearch.trim() ? { search: itemSearch.trim() } : {}),
      itemType: 'party_supplied_material',
      limit: 50,
      offset: 0,
    },
    { enabled: !hasMovement },
  );
  const itemLabel = useMemo(() => {
    if (itemId === row.itemId) {
      const code = row.itemCode ?? row.itemCodeText;
      return code ? `${code}${row.itemName ? ` — ${row.itemName}` : ''}` : undefined;
    }
    const it = itemsData?.items.find((i) => i.id === itemId);
    return it ? `${it.code} — ${it.name}` : undefined;
  }, [itemId, itemsData, row]);

  const updateMut = useUpdatePartyMaterial();

  const onSave = (): void => {
    setErr(null);
    const nm = name.trim();
    if (!nm) {
      setErr('Material Name is required.');
      return;
    }
    if (!clientId) {
      setErr('Customer is required.');
      return;
    }
    // Only what changed goes to the server.
    const input: UpdatePartyMaterialInput = {};
    if (nm !== row.name) input.name = nm;
    if (description.trim() !== (row.description ?? '')) input.description = description.trim();
    if (material.trim() !== (row.material ?? '')) input.material = material.trim();
    if (!hasMovement) {
      if (clientId !== row.clientId) input.clientId = clientId;
      if (itemId && itemId !== row.itemId) input.itemId = itemId;
    }
    if (Object.keys(input).length === 0) {
      onClose();
      return;
    }
    updateMut.mutate(
      { id: row.id, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not save changes. Try again.'),
      },
    );
  };

  const lockHint = hasMovement
    ? 'Fixed — this material already has stock movement (received, issued or returned).'
    : null;

  return (
    <ModalShell onClose={onClose} title={`Edit Customer Material ${row.code}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Code">
          <input
            type="text"
            className="innovic-input"
            value={row.code}
            readOnly
            style={{ background: 'var(--bg4)', color: 'var(--text3)', maxWidth: '14ch' }}
          />
        </Field>
        <Field label="UOM">
          <input
            type="text"
            className="innovic-input"
            value="NOS"
            readOnly
            title="Customer material is always counted in NOS — 1 per finished part"
            style={{ background: 'var(--bg4)', color: 'var(--text3)', maxWidth: '12ch' }}
          />
        </Field>

        {lockHint ? (
          <div className="text3" style={{ gridColumn: 'span 2', fontSize: 11 }}>
            Customer and Customer RM are fixed — this material already has stock movement (received,
            issued or returned).
          </div>
        ) : null}

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Customer RM">
            <SearchableSelect
              id="pmEditItem"
              value={itemId}
              onChange={setItemId}
              onSearch={setItemSearch}
              loading={itemsFetching}
              disabled={hasMovement}
              options={(itemsData?.items ?? []).map((i) => ({
                id: i.id,
                code: i.code,
                name: i.name,
              }))}
              placeholder="🔍 Type the -RM item code or name…"
              emptyText="No Party Supplied Material item matches"
              valueLabel={itemLabel}
            />
          </Field>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Material Name" required>
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
          <Field label="Grade">
            <input
              type="text"
              className="innovic-input"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
            />
          </Field>
        </div>

        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Customer" required>
            <SearchableSelect
              id="pmEditClient"
              value={clientId}
              onChange={setClientId}
              onSearch={setClientSearch}
              loading={clientsFetching}
              disabled={hasMovement}
              options={(clientsData?.clients ?? []).map((c) => ({
                id: c.id,
                code: c.code,
                name: c.name,
              }))}
              placeholder="🔍 Type customer code or name…"
              valueLabel={
                selectedClient?.code ? `${selectedClient.code} — ${selectedClient.name}` : undefined
              }
            />
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
