// One tinted line under the form. Tokens only: `--X2` text on `--X3` tint,
// bordered in `--X` (was three copies with hard-coded hex borders).
export function Note(props: {
  tone: 'amber' | 'blue' | 'red' | 'green';
  children: React.ReactNode;
}): React.JSX.Element {
  const t = props.tone;
  return (
    <div
      style={{
        marginTop: 12,
        color: `var(--${t}2)`,
        background: `var(--${t}3)`,
        border: `1px solid var(--${t})`,
        borderRadius: 6,
        padding: '6px 10px',
        fontSize: 12,
      }}
    >
      {props.children}
    </div>
  );
}
