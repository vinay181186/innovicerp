// ADR-264 — the header row of every home view: title · hint · the view's own
// controls on the right.

export function ViewHead({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="dh-vh">
      <h2>{title}</h2>
      {hint ? <span className="dh-hint">{hint}</span> : null}
      <span className="dh-sp" />
      {children}
    </div>
  );
}
