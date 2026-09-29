// Quick-add Party Supplied Material pop-up — the +New used by the JWSO form's
// "Customer Material (Item -rm)" picker (ADR-195). It creates a party-supplied
// item WITHOUT leaving the half-filled JWSO, so the order in progress is never
// lost.
//
// It deliberately does NOT embed the full item-form.tsx: that form renders its
// own sticky PageHeader (Back + Cancel + Save, Ctrl+S shortcut) and a product-
// image upload, all sized for a standalone page — dropping it inside a Modal
// would give two headers and two Save buttons. Instead this mirrors the
// established QuickAddClient pattern: the shared Modal + its own <form>, the same
// useCreateItem hook the item page uses, with the Item Type locked to Party
// Supplied Material and the -rm code pre-filled.
//
//   - it sits on the shared Modal, which portals to document.body, and carries
//     its OWN <form> — Enter = Add Item. React still bubbles the portal's submit
//     up to the parent JWSO form, so onSubmit stops propagation.
//   - the code is pre-filled ITM-####-rm (editable) and always saved with -rm.

import { type Item, type Uom, UOMS, withPartyMaterialSuffix } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useCreateItem, useNextItemCode } from '@/modules/items/api';
import { Modal } from '@/ui/feedback';
import { FormField } from '@/ui/forms';

export function QuickAddPartyMaterial({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called with the created party-supplied item so the JWSO picker selects it. */
  onCreated: (item: Item) => void;
}): React.JSX.Element {
  const formId = useId();
  const create = useCreateItem();
  const { data: nextCode } = useNextItemCode();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [material, setMaterial] = useState('');
  const [uom, setUom] = useState<Uom>('NOS');
  const [err, setErr] = useState<string | null>(null);

  // Prefill ITM-####-rm once the next code arrives (editable; still saved -rm).
  useEffect(() => {
    if (nextCode?.code && !code) setCode(withPartyMaterialSuffix(nextCode.code));
  }, [nextCode, code]);

  async function onSave(): Promise<void> {
    setErr(null);
    if (!name.trim()) {
      setErr('Item Name is required.');
      return;
    }
    try {
      const created = await create.mutateAsync({
        code: code.trim() ? withPartyMaterialSuffix(code) : undefined,
        name: name.trim(),
        ...(material.trim() ? { material: material.trim() } : {}),
        uom,
        itemType: 'party_supplied_material',
        procurementType: 'make',
        revision: 'A',
      });
      onCreated(created);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save item. Try again.');
    }
  }

  return (
    <Modal
      title="New Customer Material (Item -rm)"
      onClose={onClose}
      size="md"
      maxWidth="520px"
      closeOnOverlayClick={false}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-primary"
            disabled={create.isPending}
          >
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Add Item
          </button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          // A portal still bubbles React events to the parent JWSO <form>;
          // without this, Enter here would also submit the order.
          e.preventDefault();
          e.stopPropagation();
          void onSave();
        }}
      >
        <FormField label="Item Type" htmlFor={`${formId}-type`}>
          <input
            id={`${formId}-type`}
            className="innovic-input"
            value="Party Supplied Material"
            readOnly
          />
        </FormField>
        <FormField label="Item Code" htmlFor={`${formId}-code`}>
          {/* The item code is the main thing: mono 700 in --text. */}
          <input
            id={`${formId}-code`}
            className="innovic-input mono fw-700"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Auto on save"
          />
        </FormField>
        <FormField label="Item Name" required htmlFor={`${formId}-name`}>
          <input
            id={`${formId}-name`}
            className="innovic-input"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Full item name"
          />
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
          <FormField label="Material" htmlFor={`${formId}-material`}>
            <input
              id={`${formId}-material`}
              className="innovic-input"
              autoComplete="off"
              value={material}
              onChange={(e) => setMaterial(e.target.value)}
              placeholder="EN8, SS304..."
            />
          </FormField>
          <FormField label="UOM" htmlFor={`${formId}-uom`}>
            <select
              id={`${formId}-uom`}
              className="innovic-select"
              value={uom}
              onChange={(e) => setUom(e.target.value as Uom)}
            >
              {UOMS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="form-help">
          Item Type is locked to Party Supplied Material; the code auto-carries -rm (ITM-####-rm).
        </div>
        {err ? (
          <div className="form-error" style={{ marginTop: 6 }}>
            {err}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
