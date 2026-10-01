// Edit Customer Material modal.
// Split out of routes/list.tsx (ADR-199 table-standard conversion, 2026-10-01).
// Behaviour unchanged from the original in-file EditPartyMaterialModal.

import {
  PARTY_MATERIAL_UOMS,
  type PartyMaterialListItem,
  type PartyMaterialUom,
  type UpdatePartyMaterialInput,
} from '@innovic/shared';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { useClientsList } from '../../clients/api';
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
  const [uom, setUom] = useState<PartyMaterialUom>(
    (PARTY_MATERIAL_UOMS.includes(row.uom as PartyMaterialUom)
      ? row.uom
      : 'NOS') as PartyMaterialUom,
  );
  const [clientSearch, setClientSearch] = useState('');
  const [clientId, setClientId] = useState<string | null>(row.clientId);
  const [err, setErr] = useState<string | null>(null);

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
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not save changes. Try again.'),
      },
    );
  };

  return (
    <ModalShell onClose={onClose} title={`Edit Customer Material ${row.code}`}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Code">
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
          <Field label="Item Code">
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
