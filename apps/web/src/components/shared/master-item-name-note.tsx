// Plan v3 Step 4 — "same value everywhere". A line's own Item Name stays
// editable (the customer may call the part something else on their order), so
// when it differs from the item master's name the screen shows the master's
// name beside it as a small grey note. Renders nothing when the two agree or
// the line has no item.

export function MasterItemNameNote({
  lineName,
  masterItemName,
}: {
  lineName: string | null | undefined;
  masterItemName: string | null | undefined;
}): React.JSX.Element | null {
  const master = masterItemName?.trim() ?? '';
  if (master === '' || master === (lineName ?? '').trim()) return null;
  return (
    <div className="text3" style={{ fontSize: 11 }} title="Item Name on the Item Master">
      Master: {master}
    </div>
  );
}
