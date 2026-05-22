# PARITY — SO Status Review (`renderSOStatus`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L4255–4561.
> **Shipped status (2026-05-22):** PL-1b commit `22bbea5 feat(so-status): PL-1b — Equipment-BOM banner + items table + OSP alerts + Create JC bridge` shipped Equipment-BOM banner + items table + 3 OSP alert rows + inline PR Op buttons + Create Job Card bridge to `apps/web/src/modules/so-status/routes/detail.tsx` (779 lines). **Multiple ❌ BLOCKERs below are now ✅ shipped.** Re-verify before treating any item as open work.
> **Shipped today (PL-1):** single-pane detail at `/sales-orders/$id/status` — header + per-line panel + JC table + op chips. Missing: Equipment-BOM banner, Equipment-BOM items table, per-line tracker chips beyond the 6 basic, per-line action buttons, left-pane SO selector, Export Excel + Edit-in-Master actions, OSP-aware op chips, GRN-QC alert lines.
> **Status legend:** ✅ present · ⚠️ partial · ❌ missing.
> **Tag every gap:** **BLOCKER** (team can't work without it) · **DELTA** (different but workable) · **POLISH** (visual only).

---

## 0. Route + entry points

- ✅ Route `/sales-orders/$id/status` exists; reached from SO detail "Status" link.
- ⚠️ Legacy is a stand-alone screen at nav('sostatus') with its own left-pane SO selector. Today there's no `/so-status` route — only the per-SO drill from a known SO id. **DELTA** (the SO Overview list at `/so-overview` covers the "pick an SO" role; a left-pane picker on this page is duplicative).
- ❌ `_soStatusCreateJC(soLineId)` bridge (L4565-4569) — sets `window._planPreSelectLine` then navigates to `/planning`. With PL-4b shipped, the new flow is "click + Create Job Card → land on `/planning?soId=<x>&line=<y>`." **BLOCKER** (this is the natural action coming out of SO Status; without it, the user has to retype the SO code in the planner).
- ❌ `_soStatusCreatePO(soLineId)` bridge (L4572-4658) — modal that picks SO lines and pre-populates a PO form. **DELTA** (PO can be created from the PO list with a SO line filter; less direct but the workflow exists).

---

## 1. Header — top of right pane (L4283–4310)

Today's header (shipped):
- ✅ SO code (cyan, 16 px) + customer + status badge.
- ✅ SO date + Client PO no.
- ✅ Total qty / done / overall % rollup.
- ✅ Overall progress bar.

Legacy adds:
- ❌ **Line count chip** — `"<N> line(s)"` next to type label. **POLISH**
- ❌ **Type label** (e.g. "Equipment") next to header — currently only available via the SO Overview screen. **DELTA**
- ❌ **Due-date colour** — red when `dueDate < today()`. **POLISH** (today's chip column has the colour, header doesn't).
- ❌ **Remarks** displayed inline when present. **DELTA**

### 1.1 Equipment SO BOM info banner (L4294–4309) — THE NAMED GAP

When `header.type === 'equipment'` AND `header.bomMasterId` is set, legacy renders a fully styled banner with:

- ❌ Equipment item label: `<partNo> <partName>` (purple, bold). **BLOCKER**
- ❌ Equipment qty: large numeric (16 px). **BLOCKER**
- ❌ **BOM Status badge** color-coded: `BOM Pending` = amber · `BOM Planned` = green · other = cyan. **BLOCKER**
- ❌ **Linked BOM** label: BOM no (green, bold) + revision + name + `(N items)` count. **BLOCKER**
- ❌ **📦 Plan BOM Items** button (cyan-outline) — opens `showEquipBOMPlanning` modal. **BLOCKER** (this is the only path from the SO Status screen into the new PL-4b Equipment BOM Planning modal).
- ❌ When `bomMasterId` is NOT set: amber warning `⚠ No BOM linked — assign a BOM in SO Master to plan items.` **BLOCKER** (without this the planner doesn't know why the BOM-related actions are missing).

---

## 2. Per-line panel (L4437–4463)

### 2.1 Line header strip (L4438–4453)

- ✅ LINE # (mono, uppercase).
- ✅ Item code (purple) + part name.
- ✅ SO qty.
- ❌ **`[CPO:<clientPoLineNo>]` chip in purple** — already in the data, not rendered in legacy-faithful styling here. **POLISH** (today shows "client PO L#X" suffix in subtitle; not as a distinct chip).
- ✅ Progress bar (90 px) + status badge.

### 2.2 Tracker chips strip (L4420–4435) — **biggest deepening gap**

Today: 6 chips in a single grid row (JC Issued / PO Raised / GRN Recd / QC Accepted / Produced / Dispatched) with qty/total + progress bar. **✅ structure present**.

Legacy adds these **alert lines below the chip strip** (each one its own coloured info row, only when count > 0):

- ❌ **At Vendor**: `🏭 At Vendor: <qty> pcs across <N> outsource op(s)` (purple). **BLOCKER** (outsource visibility is one of the named workflow issues).
- ❌ **Awaiting PR**: `📋 <N> outsource op(s) awaiting Purchase Request` (amber). **BLOCKER**
- ❌ **PR Raised**: `🛒 <N> PR(s) raised, awaiting PO creation` (blue). **BLOCKER**
- ❌ **GRN QC Pending**: `⏳ QC Pending: <N> pcs (material received, awaiting inspection)` (amber). **DELTA**
- ❌ **GRN QC Rejected**: `⚠ GRN QC Rejected: <N> pcs` (red). **DELTA**
- ❌ **Production QC Rejected**: `⚠ Production QC Rejected: <N> pcs` (red). **DELTA**

Today's shipped UI has a `line.outsourceAlert` block (atVendorQty, pendingPrCount, prRaisedCount) with badges — covers the **first 3** legacy alert lines but at a different visual weight (badges vs. coloured info rows).

### 2.3 Linked JC table (L4456–4458)

Headers per legacy: JC No · Item Code · JC Qty · Completed · Remaining · Priority · Due Date · JC Status · Operations · (View action).

Today (✅ all 9 columns + View link present). Mismatches:

- ✅ JC No clickable (legacy → `viewJCStatus`, today → `/op-entry?jc=<code>`).
- ❌ **Running indicator**: `▶<N> running` next to the JC code when `db.runningOps` has entries for it (amber). **DELTA** (today's op chips already show running state at the op level).
- ❌ **Inline OSP PR buttons**: per-op `📋 PR Op<N>` button shown when an outsource op has no `outsourceStatus` or status is `Pending` (L4343-4346). **BLOCKER** (this is how the planner triggers PR creation from SO Status today — without it the cascade stalls).
- ❌ **OSP-aware op chip styling**: `🏭` prefix + amber background tint + tooltip with outsource status (L4338-4340). Today's chip has `🏭` icon but no background tint. **POLISH**

### 2.4 Per-line action footer (L4459–4462)

Right-aligned button row, NEW for parity:

- ❌ **+ Create Job Card** (cyan) — shown when `lineBalance > 0` (orderQty − totalJCQty); navigates to Planning with the line pre-selected. **BLOCKER**
- ❌ **✓ Fully allocated** label — shown when balance ≤ 0. **POLISH**
- ❌ **🛒 Create PO** (purple) — always shown. **DELTA** (PO can be created via the PO list module).

---

## 3. Equipment SO BOM items table (L4467–4506) — THE NAMED GAP

When `header.type === 'equipment'` AND `header.bomMasterId` is set AND the BOM has items, legacy renders an additional card BELOW the per-line cards:

- ❌ Card header: `📦 BOM Items — <bomNo> × <equipQty> sets` (cyan label) + helper text `(Equipment Qty × Qty per Set = Total Need)`. **BLOCKER**
- ❌ Table columns: `#` · Item Code (purple) · Item Name · Qty/Set · **Total Need** (cyan, 14 px bold = qty/set × equipQty) · Type chip (🏭 Mfg / 🛒 Buy / 🏭 Outsrc, color-coded) · Stock (green) · Shortfall (red if > 0, green ✅ if 0) · **Plan Status** (color-coded by plan status + linked JC code chip). **BLOCKER**
- ❌ Row background: green-tinted if shortfall = 0, red-tinted if shortfall > 0. **POLISH**

**API change required:** the existing `GET /so-status/:soId` response has `header.bomMasterId` but does NOT include the BOM children with stock + shortfall + plan-by-child-code lookup. New endpoint OR extend the existing response with `bomItems: PlanningBomChild[]` shape (already defined in PL-4b's `packages/shared/src/schemas/so-planning.ts`). **Recommended: extend** — keeps `/so-status/:soId` as the one-stop endpoint for the page and avoids a second round-trip.

---

## 4. Left pane — SO selector (L4509–4549)

Today: NO left pane. The page is opened with a known SO id.

Legacy:

- ❌ 260px fixed sidebar with search input ("🔍 Search SO / customer…"). **DELTA** (SO Overview at `/so-overview` covers this role with richer filtering).
- ❌ Per-SO row: status dot (color = JC rollup), SO no (bold cyan when active), line count chip, customer, BOM Pending warning (amber), Qty / Done / overall progress bar.
- ❌ Active-row indicator: 3px cyan left border + `bg4` background.

**Recommendation: skip the left pane** in this parity port — the SO Overview screen at `/so-overview` already lets the user pick an SO, and replicating the picker here is duplication. Mark as **DELTA — superseded by SO Overview**.

---

## 5. Page header actions (L4553–4556)

Right of the page title:

- ❌ **⬇ Export Excel** — calls `_soStatusExportExcel(soNo)`. **DELTA** (Excel export not built for any screen yet).
- ❌ **✎ Edit in SO Master** — `nav('somaster')` → navigates to SO list. **POLISH** (the existing "Back to SO detail" link is functionally equivalent; renaming is enough).

---

## 6. Math + data corrections

Today's calc-engine handles the per-op enrichment + per-JC rollup + per-line stage. Cross-checking legacy:

- ✅ Per-line `totalCompleted` = sum of per-JC `done` where `done = lastOp.qcReq ? qcAccepted : completed`.
- ✅ Per-line `pct` = `min(100, round(totalCompleted/orderQty × 100))`.
- ✅ Per-line `lineStatus` enum: `'No JC' | 'Complete' | 'QC Pending' | 'In Progress'`.
- ⚠️ **`lineBalance` (`orderQty − totalJCQty`)** is used by the legacy "Create JC" button condition. Today's shipped response doesn't expose `totalJCQty` directly — but it can be derived from `jobCards.reduce(jc.orderQty)`. **Compute client-side.** No API change needed.
- ✅ Per-line tracker math (poQty, poRecvQty, grnRecvd, grnAccepted, grnRejected, qcAccepted, qcRejected, dispQty) is already in the `line.chips` payload.
- ❌ **`outsourceAtVendor` per-op detail** — legacy shows count + sentQty across all OSP ops with status Sent/PO Created. Today exposes `line.outsourceAlert.atVendorQty` (totalled). To render the alert line `"<atVendorQty> pcs across <N> outsource op(s)"`, need to add `atVendorOpCount` to `line.outsourceAlert`. **Small wire shape addition.**

---

## 7. Summary — what counts as a **BLOCKER** for daily use

Ranked for this slice (PL-1b):

1. **Equipment-BOM banner in the header** (§1.1) — the planner needs to see BOM status + linked BOM at a glance + reach the Equipment-BOM Planning modal from this screen.
2. **Equipment-BOM items table at the bottom** (§3) — the named gap from 2026-05-21. Needs a wire-shape extension (`bomItems[]` on the response) reusing PL-4b's `PlanningBomChild` shape.
3. **OSP alert lines** (§2.2 first 3 bullets) — `🏭 At Vendor`, `📋 awaiting PR`, `🛒 PR(s) awaiting PO`. Procurement uses this to find what to push next.
4. **Inline OSP PR buttons** in the JC ops chip strip (§2.3) — the trigger point for raising a PR for a JC's outsource op.
5. **+ Create Job Card** button on the per-line footer (§2.4) — bridge into PL-4b's `/planning` workflow. Single button, one navigate call.

Lower priority (defer to backlog):

- DELTA: GRN QC alert lines (§2.2 last 3 bullets), `[CPO:x]` chip styling (§2.1), running-indicator (§2.3), 🛒 Create PO button (§2.4), Excel export + Edit-in-master (§5), `outsourceAtVendor` per-op detail (§6).
- POLISH: line count chip + type label + due-date red (§1), background tint on BOM items table (§3), green ✅ on shortfall 0 (§3).
- DELTA: left-pane SO picker (§4) — superseded by `/so-overview`.

---

## 8. API contract — what changes

To ship the 5 BLOCKERs above, the wire shape needs:

1. **`header.equipmentInfo`** (when `type === 'equipment'`):
   ```ts
   {
     equipmentItemCode: string | null;     // partNo
     equipmentItemName: string | null;     // partName
     equipmentQty: number;                 // orderQty of the only equipment line
     bomNo: string | null;
     bomRev: number | null;
     bomName: string | null;
     bomPartsCount: number;
   }
   ```
2. **`bomItems`** (top-level, when equipmentInfo + bomMasterId set):
   ```ts
   PlanningBomChild[]   // reuse PL-4b's shape from so-planning.ts — same totalNeed / stock / shortfall / bomType / existingPlan
   ```
3. **`line.outsourceAlert.atVendorOpCount`** — int, count of OSP ops with status Sent/PO Created. (Already have qty; add the op count.)
4. **`line.outsourceAlert.pendingOps`** — `Array<{ jcCode: string, opSeq: number }>` so the UI can render the inline `📋 PR Op<N>` buttons inside each JC's op chip strip. Caller posts to existing `/purchase-requests` endpoint.
5. **No new endpoint** — extend `GET /so-status/:soId`.

Migration: **none** (read-only). All data exists in the DB.

---

## 9. What's NOT in scope for this slice

- Per-op OSP status update from this screen (e.g., flip Pending → PR Raised). Stays in `/op-entry`'s outsource sub-flow.
- BOM Master editing. Lives in `/bom-masters`.
- SO Master editing. Lives in `/sales-orders`.
- Excel export. Project-wide gap, separate ticket.
- Left-pane SO picker. Superseded by `/so-overview`.

---

**Sign-off needed before code:**
- Confirm the **5 BLOCKERs** in §7 are the right scope for the first pass.
- Approve the **4 wire-shape additions** in §8 (zero schema changes; just response-shape extensions to `GET /so-status/:soId`).
- Tell me which legacy items you want **moved** from BLOCKER → DELTA.
