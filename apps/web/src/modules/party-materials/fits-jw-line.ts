import type { PartyMaterialListItem } from '@innovic/shared';

/** ADR-102 part-identity rule, widened for ADR-195 — mirrors the API's
 *  `partyMaterialFitsJwLine` (apps/api/src/modules/party-materials/service.ts)
 *  so the screen flags exactly what Save would refuse.
 *
 *  A party material fits a JWSO line when it is pinned to that line's part, OR
 *  to the JWSO's own customer material (`clientMaterial`, the -rm item code the
 *  JWSO save bridged into the party store). Rows with no item link on either
 *  side cannot be checked and pass. */
export function partyMaterialFitsJwLine(
  pm: Pick<PartyMaterialListItem, 'itemId' | 'itemCode' | 'itemCodeText'>,
  lineItemId: string | null | undefined,
  jwClientMaterial: string | null | undefined,
): boolean {
  if (pm.itemId == null || lineItemId == null) return true;
  if (pm.itemId === lineItemId) return true;
  const cm = (jwClientMaterial ?? '').trim().toLowerCase();
  const pmCode = (pm.itemCode ?? pm.itemCodeText ?? '').trim().toLowerCase();
  return cm !== '' && pmCode === cm;
}
