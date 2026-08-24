// Purchase Order type. Legacy seen value: 'Job Work'. The other 3 values
// (standard / outsource / service) are forward — explicit beats derived
// for filtering and reporting (ADR-015 #6).
export const PO_TYPES = ['standard', 'job_work', 'outsource', 'service'] as const;
export type PoType = (typeof PO_TYPES)[number];

// Does this PO type send OUR material out to the vendor and expect it back?
//
// 'job_work' always did: the outward Delivery Challan / receive-back chain
// (PO -> Issue DC -> at vendor -> receive -> auto-GRN -> Incoming QC) exists
// because a part physically leaves the building.
//
// 'service' now joins it. A service PO buys work, not goods (calibration,
// heat-treat, plating, rewinding) — but the thing being worked on still goes
// out and comes back, so it follows the same chain. Before this, a service PO
// fell into the `!== 'job_work'` bucket and was offered "Receive (new GRN)",
// which asked the user to book stock in against a purchase that had no
// incoming material.
//
// Kept as one function so the rule lives in ONE place: every screen and guard
// that used to test `poType === 'job_work'` asks this instead.
export function poSendsMaterialOut(poType: PoType): boolean {
  return poType === 'job_work' || poType === 'service';
}
