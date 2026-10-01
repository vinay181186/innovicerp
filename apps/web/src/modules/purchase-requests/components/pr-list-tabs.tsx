// The two tabs above the Purchase Requests screen — Purchase Requests and the
// folded-in Outsource Jobs view (UI-only merge). Extracted from routes/list.tsx
// to keep that file under 400 lines; behaviour and styling are unchanged.

export type PrListTab = 'pr' | 'osp';

export function PrListTabs({
  tab,
  onChange,
}: {
  tab: PrListTab;
  onChange: (t: PrListTab) => void;
}): React.JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        borderBottom: '1px solid var(--border)',
        marginBottom: 14,
      }}
    >
      {(['pr', 'osp'] as const).map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => onChange(t)}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: tab === t ? '2px solid var(--cyan)' : '2px solid transparent',
            color: tab === t ? 'var(--cyan)' : 'var(--text3)',
            fontSize: 12,
            fontWeight: 700,
            padding: '6px 12px',
            cursor: 'pointer',
            marginBottom: -1,
          }}
        >
          {t === 'pr' ? 'Purchase Requests' : 'Outsource Jobs'}
        </button>
      ))}
    </div>
  );
}
