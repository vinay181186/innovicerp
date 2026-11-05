import { useEffect, useRef } from 'react';
import { FormField, FormGrid, SearchableSelect } from '@innovic/web';

const customers = [
  { id: 'c1', code: 'CUS-0012', name: 'Sample Engineering Pvt Ltd' },
  { id: 'c2', code: 'CUS-0027', name: 'Demo Fabricators LLP' },
  { id: 'c3', code: 'CUS-0041', name: 'Example Valves & Controls' },
  { id: 'c4', code: 'CUS-0058', name: 'Model Pumps Industries' },
];

const noop = () => {};

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <FormGrid>
      <FormField label={label} required={required} size="full">
        {children}
      </FormField>
    </FormGrid>
  );
}

export const Empty = () => (
  <Field label="Customer" required>
    <SearchableSelect value={null} onChange={noop} options={customers} placeholder="Type to search…" />
  </Field>
);

export const Selected = () => (
  <Field label="Customer" required>
    <SearchableSelect value="c1" valueLabel="CUS-0012 — Sample Engineering Pvt Ltd" onChange={noop} options={customers} clearable />
  </Field>
);

export const Disabled = () => (
  <Field label="SO No.">
    <SearchableSelect
      value="so1"
      valueLabel="IN-SO-00123 — Sample Engineering Pvt Ltd"
      onChange={noop}
      options={[]}
      disabled
    />
  </Field>
);

// The list opens on focus, exactly as it does for a user clicking the box.
function OpenOnMount({ error, options }: { error?: unknown; options: typeof customers }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector('input')?.focus();
  }, []);
  return (
    <div ref={box} style={{ minHeight: 190 }}>
      <Field label="Customer" required>
        <SearchableSelect value={null} onChange={noop} options={options} placeholder="Type to search…" error={error} />
      </Field>
    </div>
  );
}

export const OpenList = () => <OpenOnMount options={customers} />;

export const NoMatches = () => <OpenOnMount options={[]} />;

export const LoadFailed = () => (
  <OpenOnMount options={[]} error={new Error('You do not have access to the Customer list.')} />
);
