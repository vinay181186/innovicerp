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
//   - ADR-242: GST Category is required, and GSTIN is required unless the
//     category is Unregistered / Overseas. The shared checkPartyGst (the same
//     rule the server runs) is checked before sending; a server refusal's
//     fieldErrors land under the same fields. The State fills from the GSTIN
//     on the server when it is left blank.

import {
  GST_CATEGORIES,
  GST_CATEGORIES_WITHOUT_GSTIN,
  type GstCategory,
  checkPartyGst,
  gstCategoryLabel,
  normalizeGstin,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useId, useState } from 'react';
import { ApiError } from '@/lib/api';
import { useSaveKey } from '@/lib/use-save-key';
import { serverFieldErrorsOf } from '@/modules/settings/master-rules-ui';
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

/** The fields this box shows an error under. */
type FieldKey = 'name' | 'gstNumber' | 'gstCategory' | 'state';
type FieldErrs = Partial<Record<FieldKey, string>>;

/** ADR-242: the customer GST problems the server refuses in every mode, from
 *  the shared rule — GSTIN, GST Category, and a GSTIN that disagrees with the
 *  State. Other State notes (an unlisted free-text State) are not blocking. */
function gstErrors(gstNumber: string, gstCategory: string, state: string): FieldErrs {
  const { issues } = checkPartyGst({
    gstNumber: normalizeGstin(gstNumber),
    gstCategory: gstCategory || null,
    state: state.trim() || null,
  });
  const out: FieldErrs = {};
  const add = (k: FieldKey, m: string): void => {
    out[k] = out[k] ? `${out[k]} ${m}` : m;
  };
  for (const i of issues) {
    if (i.field === 'gstNumber' || i.field === 'gstCategory') add(i.field, i.message);
    else if (i.code === 'gstin_state_clash') add('state', i.message);
  }
  return out;
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
  // One save key per pop-up open (the SO / JWSO forms mount it only while open).
  const saveKey = useSaveKey();
  const create = useCreateClient(saveKey);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [phone, setPhone] = useState('');
  const [gstNumber, setGstNumber] = useState('');
  const [gstCategory, setGstCategory] = useState<GstCategory | ''>('');
  const [addressLine1, setAddressLine1] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [pincode, setPincode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrs, setFieldErrs] = useState<FieldErrs>({});
  const [existing, setExisting] = useState<ExistingClient | null>(null);

  const opt = (v: string): string | undefined => (v.trim() ? v.trim() : undefined);

  async function onSave(): Promise<void> {
    setErr(null);
    setExisting(null);
    const local: FieldErrs = {
      ...(name.trim() ? {} : { name: 'Customer is required.' }),
      ...gstErrors(gstNumber, gstCategory, state),
    };
    setFieldErrs(local);
    if (Object.keys(local).length > 0) return;
    try {
      const fields = {
        contactPerson: opt(contactPerson),
        phone: opt(phone),
        gstNumber: normalizeGstin(gstNumber) ?? undefined,
        gstCategory: gstCategory || undefined,
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
      // A refusal naming fields (ADR-242 GSTIN rules, …) lands under them;
      // anything not shown in this box stays in the line at the bottom.
      const server = serverFieldErrorsOf(e);
      if (server) {
        const shown: FieldErrs = {};
        const rest: string[] = [];
        for (const [k, msgs] of Object.entries(server)) {
          const key: FieldKey | null =
            k === 'name' || k === 'gstNumber' || k === 'gstCategory'
              ? k
              : k === 'state' || k === 'stateCode'
                ? 'state'
                : null;
          if (key) shown[key] = [shown[key], ...msgs].filter(Boolean).join(' ');
          else rest.push(...msgs);
        }
        setFieldErrs(shown);
        setErr(rest.length > 0 ? rest.join(' ') : null);
        return;
      }
      setErr(e instanceof Error ? e.message : 'Could not save Customer. Try again.');
    }
  }

  const input = (id: string, value: string, set: (v: string) => void): React.JSX.Element => (
    <input
      id={`${formId}-${id}`}
      className="innovic-input"
      autoComplete="off"
      value={value}
      onChange={(e) => set(e.target.value)}
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
            {create.isPending ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Saving…
              </>
            ) : (
              'Add Customer'
            )}
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
        <FormField label="Customer" required htmlFor={`${formId}-name`} error={fieldErrs.name}>
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
          />
        </FormField>
        <FormField label="Contact Person" htmlFor={`${formId}-contact`}>
          {input('contact', contactPerson, setContactPerson)}
        </FormField>
        <FormField label="Phone" htmlFor={`${formId}-phone`}>
          {input('phone', phone, setPhone)}
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormField
            label="GST Category"
            required
            htmlFor={`${formId}-gstcat`}
            error={fieldErrs.gstCategory}
          >
            <select
              id={`${formId}-gstcat`}
              className="innovic-select"
              value={gstCategory}
              onChange={(e) => setGstCategory(e.target.value as GstCategory | '')}
            >
              <option value="">— choose —</option>
              {GST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {gstCategoryLabel(c)}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="GSTIN"
            required={!(gstCategory && GST_CATEGORIES_WITHOUT_GSTIN.includes(gstCategory))}
            htmlFor={`${formId}-gst`}
            error={fieldErrs.gstNumber}
          >
            {input('gst', gstNumber, setGstNumber)}
          </FormField>
        </div>
        <FormField label="Address" htmlFor={`${formId}-addr`}>
          {input('addr', addressLine1, setAddressLine1)}
        </FormField>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
          <FormField label="City" htmlFor={`${formId}-city`}>
            {input('city', city, setCity)}
          </FormField>
          <FormField label="State" htmlFor={`${formId}-state`} error={fieldErrs.state}>
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
