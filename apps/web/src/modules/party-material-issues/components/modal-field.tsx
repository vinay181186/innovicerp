// Small labelled-field wrapper shared by the Customer Material Issue modals
// (new + cancel). Split out of party-material-issue-view.tsx (ADR-199, table
// standard 2026-10-01) so no file in this module exceeds the 400-line rule.

export function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div>
      <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
        {label}
        {required ? <span className="req">★</span> : null}
      </div>
      {children}
    </div>
  );
}
