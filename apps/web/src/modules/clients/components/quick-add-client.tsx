// Quick-add Customer pop-up — the ONE used by the New SO and New JWSO forms
// (legacy addClientQuick). It used to be a hand-rolled overlay rendered INSIDE
// the parent SO/JWSO <form>, so pressing Enter after typing the name tried to
// save the whole order, and nothing stopped a second "ABC Industries" being
// added under a fresh CLI-### code.
//
// Now:
//   - it sits on the shared Modal, which portals to document.body, and carries
//     its OWN <form> — Enter = Add Customer. React still bubbles the portal's
//     submit event up the component tree to the parent form, so onSubmit
//     stops propagation. Ctrl+S is already ignored by useSaveShortcut while a
//     dialog is open.
//   - the server refuses a name a live customer already carries (any case) and
//     hands back that customer; the pop-up shows it with "Use this customer",
//     which selects it on the order instead of creating a duplicate.
//   - optional Address / City / State / Pincode, so a quick-added customer's
//     invoice and challan prints are not blank until the master is edited.

import { Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiError } from '@/lib/api';
import { Banner, Modal } from '@/ui/feedback';
import { FormField } from '@/ui/forms';
import { useCreateClient } from '../api';

interface ExistingClient {
  id: string;
  code: string;
  name: string;
}

/** Pull the existing customer out of the server's duplicate-name 409, if any. */
function existingClientFrom(e: unknown): ExistingClient | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = e.details as { existingClient?: Partial<ExistingClient> } | undefined;
  const c = d?.existingClient;
  if (c && typeof c.id === 'string' && typeof c.code === 'string' && typeof c.name === 'string') {
    return { id: c.id, code: c.code, name: c.name };
  }
  return null;
}

export function QuickAddClient({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** Called with the chosen customer — a new one, or the existing one the user picked. */
  onCreated: (id: string, label: string) => void;
}): React.JSX.Element {
  const formId = useId();
  const create = useCreateClient();
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingClient | null>(null);

  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

  async function onSave(): Promise<void> {
    setErr(null);
    setExisting(null);
    if (!name.trim()) {
      setErr('Customer is required.');
      return;
    }
    try {
      const fields = {
        contactPerson: opt(contactPerson),
        phone: opt(phone),
        gstNumber: opt(gstNumber),
        addressLine1: opt(addressLine1),
        city: opt(city),
        state: opt(state),
        pincode: opt(pincode),
      };
      const c = await create.mutateAsync({
        name: name.trim(),
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        isActive: true,
      });
      onCreated(c.id, `${c.code} — ${c.name}`);
    } catch (e) {
      const dup = existingClientFrom(e);
      if (dup) {
        setExisting(dup);
        return;
      }
      setErr(e instanceof Error ? e.message : 'Could not save Customer. Try again.');
    }
  }

  const input = (
    id: string,
    value: string,
    set: (v: string) => void,
    placeholder = 'Optional',
  ): React.JSX.Element => (
    <input
      id={`${formId}-${id}`}
      className="innovic-input"
      autoComplete="off"
      value={value}
      onChange={(e) => set(e.target.value)}
      placeholder={placeholder}
    />
  );

  return (
    <Modal
      title="New Customer"
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
            {create.isPending ? <Loader2 size={13} className="animate-spin" /> : null} Add Customer
          </button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        onSubmit={(e) => {
          // A portal still bubbles React events to the parent SO/JWSO <form>;
          // without this, Enter here would also submit the order.
          e.preventDefault();
          e.stopPropagation();
          void onSave();
        }}
      >
        {existing ? (
          <Banner tone="warn">
            <div>
              A customer with this name already exists:{' '}
              <strong className="mono" style={{ color: 'var(--text)' }}>
                {existing.code}
              </strong>{' '}
              — {existing.name}.
            </div>
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => onCreated(existing.id, `${existing.code} — ${existing.name}`)}
              >
                Use this customer
              </button>
            </div>
          </Banner>
        ) : null}
        <FormField label="Customer" required htmlFor={`${formId}-name`}>
          <input
            id={`${formId}-name`}
            className="innovic-input"
            autoFocus
            autoComplete="off"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setExisting(null);
            }}
            placeholder="Company / customer name"
          />
        </FormField>
        <FormField label="Contact Person" htmlFor={`${formId}-contact`}>
          {input('contact', contactPerson, setContactPerson)}
        </FormField>
        <FormField label="Phone" htmlFor={`${formId}-phone`}>
          {input('phone', phone, setPhone)}
        </FormField>
        <FormField label="GSTIN" htmlFor={`${formId}-gst`}>
          {input('gst', gstNumber, setGstNumber)}
        </FormField>
        <FormField label="Address" htmlFor={`${formId}-addr`}>
          {input('addr', addressLine1, setAddressLine1)}
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <FormField label="City" htmlFor={`${formId}-city`}>
            {input('city', city, setCity)}
          </FormField>
          <FormField label="State" htmlFor={`${formId}-state`}>
            {input('state', state, setState)}
          </FormField>
          <FormField label="Pincode" htmlFor={`${formId}-pin`}>
            {input('pin', pincode, setPincode)}
          </FormField>
        </div>
        <div className="form-help">Code auto-generates (CLI-###).</div>
        {err ? (
          <div className="form-error" style={{ marginTop: 6 }}>
            {err}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
