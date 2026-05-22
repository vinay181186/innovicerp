# PARITY — SO Timeline (`renderSOTimeline`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L19971–19991 (top-level page) + L17679–17900+ (`_soTimeline(soNo)` heavy lifter).
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/so-timeline` route.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

A **per-SO event timeline** that aggregates events across the entire ERP lifecycle for a single SO. Top of screen: SO picker. Body: chronological list of events from sales → design → planning → production → store → QC → dispatch → invoicing.

---

## 1. Page chrome (L19979–19990)

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `📅 SO Timeline` | needs port |
| 2 | SO picker | `<select>` of all SO numbers with `<soNo> — <customer> (<type>)` labels (250px min) | **BLOCKER** |
| 3 | Empty state | "Select a Sales Order above to view its timeline." | **POLISH** |

---

## 2. Timeline events aggregated by `_soTimeline(soNo)` (L17679–17900+)

The helper walks **10+ data sources** to build a chronologically-sorted event list:

| # | Event | Source table(s) | Dept colour | Icon |
|---|---|---|---|---|
| 1 | SO Created | `salesOrders` | sales `#22C55E` | 📋 |
| 2 | Design Assigned / Submitted / Approved / Revised | `designTracker` + history | design `#8B5CF6 / #2563EB / #22C55E / #F59E0B` | 🎨 / ↩ |
| 3 | BOM Linked | `bomMasters` (via `salesOrders.bomMasterId`) | design `#8B5CF6` | 📦 |
| 4 | Plan Created | `plans` (via `soRefId` OR `soNo`) | planning `#8B5CF6` | 📋 |
| 5 | Job Card Created / Completed | `jobCards` | production `#06B6D4 / #22C55E` | 📝 / ✅ |
| 6 | Party Material Received | `partyGrn` (Job Work) | store `#F59E0B` | 📥 |
| 6b | Party Material Returned | `dispatchLog.dispatchType=='party_return'` | dispatch `#0D9488` | 📤 |
| 6c | JW DC Outward | `jwDCOutward` (via PO) | store `#F59E0B` | 🚚 |
| 6d | JW DC Inward | `jwDCInward` | store `#22C55E` | 📥 |
| 7 | PR Raised | `purchaseRequests` (via `soNo` OR `soRefId`) | purchase `#2563EB` | 📨 |
| 8 | PO Created | `purchaseOrders` (via `soRefId`) | purchase `#2563EB` | 💳 |
| 9 | GRN Received | `grn` (via PO) | store `#F59E0B` | 📥 |
| 10 | Material Issued | `storeIssues` (via `refNo`) | store `#F59E0B` | 📤 |
| 10b | Op Started / Completed | `opLog` aggregated by `(jcNo, opSeq)` | production | (see legacy) |

Each event has: `date`, `icon`, `label`, `detail`, `dept`, `color`.

---

## 3. Building this in React

This is a **read-only aggregated view** — 10+ data sources. Server-side aggregation is the right call (vs. fetching 10 lists client-side).

```
GET /so-timeline/:soId
  → { events: TimelineEvent[] }
TimelineEvent = {
  date: string,
  icon: string,
  label: string,
  detail: string,
  dept: 'sales'|'design'|'planning'|'production'|'store'|'purchase'|'dispatch'|'qc',
  color: string,
}
```

UI: vertical timeline list (similar to Customer 360° communications timeline pattern) with dept-coloured left border per event.

---

## 4. Summary

### BLOCKERs
1. Schema: no new tables needed — pure aggregation over existing data.
2. Endpoint `GET /so-timeline/:soId` to build the event list server-side.
3. SO picker + timeline UI.

### DELTAs
- Op Started / Op Completed event derivation (§2 #10b) — requires walking `opLog` grouped by `(jcNo, opSeq)` and computing first / qty-reached entries. Defer if `opLog` table is large.

### POLISH
- Dept-coloured left border per event matches legacy palette exactly.

---

**Sign-off needed:**
- Confirm this is desired (read-only timeline is high-value for ops/customer-service teams).
- Estimate: ~300–400 LOC (endpoint + UI). Schedule with `crm-leads` / `crm-reminders` slice.
