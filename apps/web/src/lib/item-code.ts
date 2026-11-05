// `CODE/REV` — the rule lives in packages/shared so the server's search and
// Sort & Filter read it too (ADR-268).
import { docItemsSummary } from '@innovic/shared';

export { docDrawingRev, docItemsSummary, itemCodeWithRev, itemLineLabel } from '@innovic/shared';

/** How a picker names a document raised on a party (a PO, a DC): one item reads
 *  "POL 20 · ABC/1 · Shaft 50mm · Vendor"; several read "Vendor · 3 items: ABC/1,
 *  DEF/2 +1 more". `searchText` keeps every line findable; pass it to the option
 *  and to any client filter. An empty part drops out. */
export function partyDocName(
  party: string | null | undefined,
  lines: Parameters<typeof docItemsSummary>[0] = [],
): { name: string; searchText: string } {
  const { label, searchText } = docItemsSummary(lines);
  const parts = lines.length > 1 ? [party, label] : [label, party];
  return { name: parts.filter(Boolean).join(' · '), searchText };
}
