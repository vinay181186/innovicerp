// Pending PO Tracker filter — a labelled datalist input (legacy L17030 Vendor /
// Item / SO-JW drill-down). Split out of the dashboard page so page.tsx stays
// under the file-size ceiling.

export function FilterInput({
  label,
  listId,
  value,
  onChange,
  options,
  width,
}: {
  label: string;
  listId: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  width: number;
}): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-1)' }}>
      <label
        style={{
          fontSize: 'var(--fs-xs)',
          color: 'var(--text3)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        {label}:
      </label>
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <input
        list={listId}
        className="innovic-input"
        value={value}
        placeholder="🔍 All"
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: 'var(--fs-sm)', padding: 'var(--sp-1) var(--sp-2)', width }}
      />
    </div>
  );
}
