# PARITY — SO/JW Planning workflow (`renderSOPlanning`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L9299–9437 (+ supporting modals L7116, L8848, L9440, L9500, L9777, L9942).
> **Shipped today (PL-4):** generic Plans list + per-plan form at `/plans` and `/plans/new`. SO-centric workflow does NOT exist yet.
> **Status legend:** ✅ present · ⚠️ partial · ❌ missing.
> **Tag every gap:** **BLOCKER** (team can't work without it) · **DELTA** (different but workable) · **POLISH** (visual only).

---

## 0. Route + entry points

- ❌ **Route `/planning`** — not registered. Sidebar should link "📋 Planning" in the Planning dept (separate from `/plans` list). **BLOCKER**
- ❌ **SO Status → Planning bridge** — legacy sets `window._planPreSelectLine = soLineId` before navigating (L9314); the Planning screen auto-selects the SO that owns that line. Today no path exists. **DELTA**

---

## 1. Two-pane layout (L9427–9436)

- ❌ Full-viewport-height container: `display:flex; height:calc(100vh - 70px)`. **BLOCKER**
- ❌ Left pane: **fixed 250 px**, scrollable, `bg2` background, right border. **BLOCKER**
- ❌ Right pane: `flex:1`, scrollable, 16 px padding. **BLOCKER**
- ❌ Right pane header: `"Planning: <SO#>"` (or `"Select an SO"` if none selected). **BLOCKER**
- ❌ Right pane empty state when no SO selected: `"Select an SO from the left panel to view and plan its lines."` **POLISH**

---

## 2. Left pane — SO/JW selector (L9322–9344)

Source data: `CASCADE.allOpenOrders()` grouped by `soNo || jwNo || _refNo`, sorted **descending** by SO number.

Per row:

- ❌ SO number (mono, 12 px, cyan, bold). **BLOCKER**
- ❌ Customer name (11 px, muted). **BLOCKER**
- ❌ **Planning % badge** on the right (rounded pill, 10 px white text on coloured background):
  - **Green** (`fullyPlanned`): `totalPlannedQty >= totalQty`
  - **Amber** (`partialPlanned`): `0 < totalPlannedQty < totalQty`
  - **Grey** (text3): `totalPlannedQty === 0`
  - **BLOCKER** (this is the single most useful signal in the whole screen — sales/planner sees at-a-glance which SOs still need work).
- ❌ Active-row indicator: 3-px cyan left border + `bg3` background. **BLOCKER**
- ❌ Click handler: `window._planSelSO = soNo; render()`. **BLOCKER**
- ❌ Title strip: `"Select SO/JW"` (uppercase 11 px header, 12 px padding, border-bottom). **POLISH**
- ❌ Empty state: `"No SOs found"` (16 px padding empty-state component). **POLISH**

---

## 3. Right pane — per-line plan cards (L9350–9424)

For the selected SO, one card per SO line sorted by `lineNo`. Card border-left colour:

- Green = fully planned · Amber = partial · Grey = unplanned.

### 3.1 Card header (L9400–9410)

- ❌ `"LINE N"` label (10 px, mono, uppercase, text3). **BLOCKER**
- ❌ Optional `[CPO:<clientPoLineNo>]` chip in purple. **DELTA** (today's plan list doesn't show CPO at all)
- ❌ Item code (purple, bold). **BLOCKER**
- ❌ Item name (12 px). **BLOCKER**
- ❌ Right side: `SO: <orderQty>` + `Due: <dueDate>`. **BLOCKER**

### 3.2 Quantity bar (L9412–9418)

- ❌ Text: `"Planned: N / total pcs (pct%)"` (cyan N). **BLOCKER**
- ❌ Status label on right with colour (`Fully Planned` / `Partial (N left)` / `Unplanned`). **BLOCKER**
- ❌ 6-px progress bar (cyan if partial, green if 100%, grey if 0%). **POLISH**

### 3.3 Existing plan sub-cards (L9361–9387, one per `db.plans` linked to the SO line)

Per plan row (rounded grey pill):

- ❌ Type icon: 🏭 (manufacture/assembly) · 📦 (full_outsource) · 🛒 (direct_purchase). **BLOCKER**
- ❌ Plan number (mono, 11 px, cyan). **BLOCKER**
- ❌ `"<typeLabel> · <planQty> pcs"` (Mfg / OSP / Buy). **BLOCKER**
- ❌ For manufacture: `(N ops, 🏭 outsrc)` if any op is outsource. **BLOCKER**
- ❌ For full_outsource: `→ <foVendorCode>`. **BLOCKER**
- ❌ Status badge (right-aligned). Colours: `In Planning`=amber · `Planned`=blue · `JC Created`=cyan · `PR Created`=purple · `Complete`=green. **BLOCKER**
- ❌ **Per-status action buttons:**
  - `In Planning` → ✏ Edit (amber). **BLOCKER**
  - `Planned` → ⚡ Execute (green) + ✏ edit (ghost). **BLOCKER**
  - `PR Created` (full_outsource) → `PR:<foPRNo>` + optional `Mat:<foMatPRNo>` + `OSP →` button (nav to outsourcejobs). **BLOCKER**
  - `PR Created` (direct_purchase) → `PR:<dpPRNo>` + View. **BLOCKER**
  - `JC Created`/`In Production`/`Complete` → linked `<jcNo>` (cyan, click → `viewJCStatus`) + View. **BLOCKER**

### 3.4 Card footer (L9421–9422)

Right-aligned buttons (visibility depends on line type):

- ❌ **Equipment BOM Planning** (cyan outline, `📦 Equipment BOM Planning (N parts)`) — shows when `line.type === 'Equipment'` && `line.bomMasterId` is set and the BOM exists. **BLOCKER**
- ❌ Warning `⚠ Linked BOM not found` (amber) — when bomMasterId is set but row missing. **POLISH**
- ❌ **BOM Planning** (cyan outline, `📦 BOM Planning (N parts)`) — shows when the line item is an assembly with `item.bom.length > 0`. **DELTA** (today's BOM Master cascade already handles this on SO creation; legacy lets the planner re-trigger it from here)
- ❌ **+ Plan N pcs** (cyan filled) — shows when `remaining > 0` AND line is NOT an Equipment-BOM line. Triggers `createPlan(soLineId)`. **BLOCKER**

---

## 4. `createPlan(soLineId)` modal (L9440–9496)

Small modal triggered by the "+ Plan N pcs" button.

- ❌ Title: `"Create Plan — <itemCode>"`. **BLOCKER**
- ❌ Summary card showing: SO/JW + line, Item code, SO qty, **Already Planned** (cyan), **Remaining** (green) — both as big counters. **BLOCKER**
- ❌ Single input: `"Plan Qty ★"` (max = remaining, default = remaining, 22-px font, cyan border, centered). **BLOCKER**
- ❌ Hint text below: `"Max: N pcs (SO: X − Already Planned: Y)"`. **POLISH**
- ❌ On save: validates 0 < qty ≤ remaining; auto-loads route-card ops if the item has an active route card (L9472–9477); creates plan with status `In Planning` and `planType='manufacture'`; logs activity; toast confirms route-card load; **immediately opens the edit modal** after 150 ms (chain create → edit). **BLOCKER** (the chain is what makes the create-then-edit feel like a single workflow)

---

## 5. `editPlan(planId)` modal (L9500–9721)

Large modal. If plan status ∈ {`JC Created`, `PR Created`, `In Production`, `Complete`} → redirect to `viewPlanDetail` (read-only).

### 5.1 Header summary (L9583–9590)

- ❌ Big plan-number (mono cyan), SO/JW + line, Item, SO qty (16 px), **Plan Qty ★** input (max = orderQty, 16 px, cyan-bordered). **BLOCKER**

### 5.2 3-tab plan-type picker (L9591–9612)

Three large clickable cards, side-by-side, change border + bg when active. Hidden input `#fPlanType` holds the value.

- ❌ 🏭 **Manufacture** (cyan) — "Job Card + Operations". **BLOCKER**
- ❌ 📦 **Full Outsource** (purple) — "Our material, vendor does all". **BLOCKER**
- ❌ 🛒 **Direct Purchase** (green) — "Buy finished item (with material)". **BLOCKER**
- Today's form has a type dropdown that disables on edit; legacy keeps the tabs visible even on edit. **DELTA**

### 5.3 Date strip (L9613–9616)

- ❌ `Planned Start / Required Date` + `Planned End Date`. **BLOCKER** (today's form has these as plain date inputs — labels match, OK; just verify the legacy labels are kept)

### 5.4 Manufacture section (L9617–9629, visible when type ≠ direct_purchase)

Operations Routing table with 3 add buttons:

- ❌ **+ Add Op** — appends process op `{opType:'process'}` with empty machine + operation. **BLOCKER**
- ❌ **+ Add OSP Op** (purple) — appends `{opType:'OSP', isOSP:true, ospLeadDays:5, ospVendorCode:'', ospVendor:''}`. **BLOCKER**
- ❌ **+ Add QC Op** (green) — appends `{machineId:'QC', opType:'QC', qcRequired:true}`. **BLOCKER**
- ❌ Ops counter (`N ops`) on the right. **POLISH**
- ❌ Per-row rendering (L9536–9578):
  - **QC row** (green left border, 🔬 QC badge, QC-process dropdown that auto-fills cycle time from `db.qcProcesses[*].defaultCycleTime`). **BLOCKER**
  - **OSP row** (purple left border, 🏭 OSP badge, leadDays + vendor display, free-text operation input). **BLOCKER**
  - **Regular row** (zebra striped, machine datalist, operation input, cycle hours input, outsource toggle that reveals vendor + cost-per-pc inputs). **BLOCKER**
  - Delete-row icon button. **BLOCKER**
- Today's `plan-form.tsx` already has an ops table — verify it covers QC + OSP rows with correct styling. Likely **⚠️ partial**.

### 5.5 Full Outsource section (L9630–9643, visible when type === full_outsource)

Bordered card with purple tint, info note (`Our material will be sent to vendor…`), and fields:

- ❌ Vendor ★ (datalist) · Rate ₹/pc · Process Description ★ · Material Source (`From Stock` / `Purchase New`) · Expected Delivery Date · 🏢 Cost Center (datalist from `db.costCenters`) · Outsource Remarks. **BLOCKER**
- Today's form is missing **Cost Center**, **Material Source**, **Expected Delivery Date**, **Outsource Remarks** as named fields. **BLOCKER**

### 5.6 Direct Purchase section (L9644–9652, visible when type === direct_purchase)

Bordered card with green tint:

- ❌ Vendor ★ (datalist) · Est. Cost / pc · Purchase Remarks. **BLOCKER** (today's form covers vendor + cost; verify remarks field)

### 5.7 Remarks (L9653)

- ❌ Free-text Notes input. **BLOCKER** (verify today's form has it)

### 5.8 **Required QC Documents** section (L9654–9662)

Per-row table with red header `📋 REQUIRED QC DOCUMENTS`:

- ❌ Document name (datalist of presets from `db.reportTypes`, fallback to `['Dimensional Inspection Report', 'First Article Inspection (FAI)', 'Material Test Certificate (MTC)', 'Surface Finish Report', 'Visual Inspection Report']`). **BLOCKER**
- ❌ Requirement dropdown: `★ Mandatory` / `Optional`. **BLOCKER**
- ❌ + Add Document button. **BLOCKER**
- ❌ Empty state: `"— No document requirements. Click + Add Document."` **POLISH**
- ❌ Footer note: `"QC person must upload these documents during inspection. Mandatory docs will block QC completion."` **BLOCKER** (this is the contract that makes the field non-cosmetic)
- Persists as `plan.requiredDocs = [{name, mandatory}]`. Today's API has NO column for this. **BLOCKER + schema change**.

### 5.9 Save validation (L9665–9719)

- ❌ Manufacture: ≥1 op, all ops have an operation name, in-house ops have a machine, outsource ops have a vendor. Sets status → `Planned`. **BLOCKER**
- ❌ Full Outsource: vendor + process required; vendor validated via `_validateVendor`. **BLOCKER**
- ❌ Direct Purchase: vendor required. **BLOCKER**
- ❌ Total-planned guard: `planQty + otherPlanned <= orderQty` (L9671–9673). **BLOCKER** (today's API has the same guard from PL-3, verify it triggers on this code path)

---

## 6. `executePlan(planId)` modal (L9777–…)

Plan must be in `Planned` status. (Today PL-4 has this end-to-end already — single-button click on the detail page.) ✅ **present** in `apps/api/src/modules/plans/service.ts` (`executePlan`).

- ❌ Legacy launches the modal **inline from the per-line plan sub-card** with a green ⚡ Execute button. Today it lives on the plan detail page only. **DELTA** (the action exists, just needs surfacing on the SO Planning screen)

---

## 7. `viewPlanDetail(planId)` modal (L9942–…)

Read-only view for executed plans (status ∈ {JC Created, PR Created, In Production, Complete}). Today `/plans/$id` shows the same data as a route. **⚠️ partial** — works as a route, not a modal; the SO Planning screen needs to invoke it from the per-plan-card View button.

---

## 8. `showEquipBOMPlanning(soLineId)` modal (L8848–8949)

Triggered by the Equipment-BOM card-footer button. Opens a large modal:

- ❌ Title: `"📦 Equipment BOM Planning — <SO#>"`. **BLOCKER**
- ❌ Summary card: Equipment SO, Equipment item, Equip qty, BOM no + rev, BOM items count. **BLOCKER**
- ❌ Explosion header: `"📦 BOM Explosion — N sets × <bomNo>"`. **BLOCKER**
- ❌ Per-component table row (`_explodeBOMMaster` data):
  - `#`, Child item code (purple), Child item name, Qty/Set, **Total Need** (= qtyPerSet × equipQty), **Stock** (green), **Shortfall** (red if > 0, green ✅ if 0), Type chip (🏭 Mfg / 🛒 Buy / 🏭 Outsrc), Plan Status (chip showing existing plan status + linked JC# if any), **Plan? checkbox** (auto-checked if there's a shortfall; disabled if existing plan), **Qty** input (default = shortfall, max = totalNeed; disabled if existing plan). **BLOCKER**
  - Row background green-tinted if `hasSufficientStock`. **POLISH**
- ❌ Footer note: `"ℹ Total Need = Equipment Qty × Qty per Set. Shortfall = Total Need − Current Stock."` **POLISH**
- ❌ **On save:** for each checked row with planQty > 0, create a plan (`planType` from `bomType`: purchase→direct_purchase, else manufacture), auto-load route-card ops if manufacture, link via `bomParentCode`/`bomChildCode`/`bomMasterId` to the parent Equipment SO. Save bumps `so.bomStatus='BOM Planned'`. **BLOCKER**
- Today's BOM Master `cascadeBomToSoLine` already auto-creates these plans on SO create. Legacy lets the planner **re-trigger** + **partially plan** here, so the manual modal still earns its keep. **DELTA → BLOCKER for parity**.

---

## 9. `showBOMPlanning(soLineId)` modal (L7116–7249)

Same shape as #8 but for `item.bom` (assembly items, not Equipment SOs). Extra row at the bottom:

- ❌ **🛠 Final Assembly Job Card** checkbox — creates an extra `planType:'assembly'` plan for the parent item (operations planned separately later). **BLOCKER** (the "assembly" plan-type was added in PL-3 for this exact case but no UI invokes it today)

---

## 10. Validation, telemetry, edge cases

- ❌ Activity log `PLAN_CREATE`, `PLAN_UPDATE`, `BOM_PLAN` events with `(planNo / soNo / item)` context. Verify today's API emits these on every write path. **DELTA**
- ❌ `_planTypeSwitch(type)` (L9723–9743) — swap visible section + recolour active tab. **POLISH**
- ❌ `_planRefreshOps()` (L9745–9748) — re-render ops table after add/remove. **POLISH**
- ❌ `_planAddDoc()` + `_planRefreshDocs()` — same for QC docs section. **POLISH**

---

## 11. Out of scope for the parity port

- The `setTimeout(..., 150)` chain `create → edit`: we can wire this as a route transition (`/planning?openPlan=<id>`). **DELTA — keep behaviour, change mechanism.**
- Legacy `db.plans.push(...)` is in-memory + `save()` writes to Firestore; we already have the `plans` + `plan_ops` tables. Nothing to do for the data side except adding `requiredDocs` (§5.8). **DELTA**
- Legacy `_validateVendor` cross-checks vendor against `db.vendors` for type + status; we can run the same validation server-side as part of the existing `superRefine` on the plan input schema. **DELTA**

---

## Summary — what counts as a **BLOCKER** for daily use

If we ship only the BLOCKERs and defer the rest, the planner can still run a real day's work:

1. **Route `/planning` with the two-pane SO-centric workflow** — left list, right cards. (§0, §1, §2, §3)
2. **createPlan modal** with auto-load-route-card + auto-chain-to-edit. (§4)
3. **editPlan modal** with 3-tab type picker + ops table (process/QC/OSP) + Full Outsource section with all 7 fields + Direct Purchase section + Required QC Documents. (§5.1–5.9 — needs new `requiredDocs` column)
4. **executePlan** action button on the per-line plan sub-card. (§6)
5. **showEquipBOMPlanning + showBOMPlanning** modals. (§8, §9)
6. **SO Status → Planning bridge** so the planner can drill from SO Status into Planning for one SO. (§0)

DELTAs (CPO chip, activity-log audit, vendor-cross-check) and POLISH (empty states, progress-bar colours, hint text, info notes) go to backlog.

---

**Sign-off needed before code:**
- Confirm the **BLOCKER** list above is the right scope for the first pass.
- Approve the one schema change (`plan.requiredDocs` column).
- Tell me which legacy items you want **moved** from BLOCKER → DELTA (i.e. you'd ship without them).
