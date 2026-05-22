# PARITY — Customer 360° View (`renderCustomer360`)

> **DEFERRED (2026-05-23):** Paired with CRM bundle; deferred together. Gated by the new `communications` table — bigger lift than Leads + Reminders alone.

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L16429–16523. Helpers: `_crmSelectCustomer` L16525, `_crmAddReminderForCust` L16530, `_crmLogComm` (referenced — find body).
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/customer-360` or `/customers/$code/360` route.
> **Status:** ❌ entire feature absent.

---

## 0. What this page is

A single-customer drill view: customer header + 6 KPI tiles + two-column body (Recent Orders | Communications timeline). The sales rep uses it to walk into a meeting knowing the customer's full status at a glance.

Required data sources:
- `db.clients` (customer master)
- `db.salesOrders` (filtered by `clientCode === cust.code` OR `client === cust.name`)
- `db.communications` (filtered by `customerCode === cust.code`) — **NEW MODEL not in current schema**
- `db.crmReminders` (filtered by `customerCode === cust.code`, status≠Done)

---

## 1. Page chrome

| # | Element | Legacy (line) | Tag |
|---|---|---|---|
| 1 | Section header | `👤 Customer 360° View` (L16456) | needs port |
| 2 | Customer picker | `<select>` with all clients sorted by name; sets `window._crm360CustCode` (L16457) | **BLOCKER** (the page's primary nav) |
| 3 | Empty state | when no clients exist — friendly 👤 prompt (L16431–16438) | **POLISH** |

---

## 2. Customer header card (L16461–16473)

A `bg2` panel with a 4px sig-info left border + 2 columns:

**Left block:**
- Customer name (18px bold)
- Code + optional `· GST: <gst>` (11px muted)
- Optional contact row: `👤 <contactPerson> · 📞 <phone> · 📧 <email>` (12px)
- Optional `📍 <address>` (11px muted)

**Right block (action buttons, when canEntry):**
- **💬 Log Communication** (primary) → `_crmLogComm(custCode, null)`
- **⏰ Add Reminder** (ghost) → `_crmAddReminderForCust(custCode)` (opens reminder form with `customerCode` prefilled)

**Tag:** **BLOCKER**.

---

## 3. KPI stat strip (L16476–16483) — 6 tiles

Auto-fit grid:

| # | Label | Formula |
|---|---|---|
| 1 | Total Business | Σ `salesOrders.totalAmount \|\| amount` (₹, sig-info, IN-formatted) |
| 2 | YTD Business | same Σ filtered to FY (`>= currentYear-04-01`), sig-ok green |
| 3 | Total Orders | `sos.length` |
| 4 | Open Orders | count where `status not in {Closed, Cancelled}`, sig-warn |
| 5 | Last Order | most recent `soDate` formatted |
| 6 | Open Reminders | count `openRems`, sig-warn if > 0 else text3 |

**Tag:** **BLOCKER**.

---

## 4. Two-column body (L16486–16520)

### 4.1 Recent Orders panel (L16489–16501)

`<table>` with 4 columns:

| col | header | data | format |
|---|---|---|---|
| 1 | SO/JW No. | `s.soNo \|\| s.jwNo` | mono cyan 11px bold |
| 2 | Date | `fmt(s.soDate \|\| s.date)` | 11px |
| 3 | Amount | `₹ <amount>` IN-formatted | mono, right-aligned, 11px |
| 4 | Status | `s.status` | colour-coded text (sig-ok / text3 / sig-warn) |

Sort: `soDate` desc. Slice to **top 10**. Empty state: "No orders yet".

Panel header: `📄 Recent Orders (N, showing 10)` if N>10 else `(N)`.

**Tag:** **BLOCKER**.

### 4.2 Communications timeline (L16504–16518)

Not a table — vertical timeline list. Each item:

- Top row: type icon + type label + optional `(auto)` tag + timestamp on right
- Middle: `c.summary` body (line-height 1.5)
- Bottom: `by <c.loggedBy>` muted 10px

**Type icon map (L16505):**
| type | icon |
|---|---|
| `Phone Call` | 📞 |
| `Email` | 📧 |
| `WhatsApp` | 💬 |
| `Meeting` | 🤝 |
| `Site Visit` | 🏢 |
| `Quote Sent` | 💰 |
| `Order Placed` | 📦 |
| `Invoice Sent` | 🧾 |
| `Payment Received` | ✅ |
| (default) | 📝 |

Sort: `loggedAt` desc. Slice to **top 15**. Max-height 400px with overflow-y scroll.

Panel header: `💬 Communication History (N, showing 15)` if N>15 else `(N)`.

Empty state: "No communications logged yet. Click 'Log Communication' to add the first one."

**Tag:** **BLOCKER**.

---

## 5. Required new schema — `communications` table

This module is gated by a `communications` table that doesn't exist in the current schema. Fields needed:

```sql
communications (
  id uuid PK,
  company_id uuid NOT NULL FK→companies,
  customer_code text,           -- FK to clients.code (loose)
  lead_id uuid FK→leads,        -- one of customer_code / lead_id is set
  type text NOT NULL,            -- one of the 10 above
  summary text NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now(),
  logged_by text,                -- user name
  auto_logged boolean DEFAULT false,  -- true when emitted by another flow
  created_at, created_by, updated_at, updated_by, deleted_at  -- standard
)
```

`auto_logged` flag (L16508) is set when the communication is created as a side effect of another action (e.g. Quote Sent on PR creation, Payment Received from invoice).

**Tag:** **BLOCKER** (table required).

---

## 6. Summary — building from scratch

### BLOCKERs
1. New `communications` table + Drizzle schema + RLS.
2. Customer picker (with URL search-state, not `window._crm360CustCode`).
3. Customer header card.
4. 6-tile KPI strip with FY math.
5. Recent Orders panel (top 10).
6. Communications timeline (top 15, max-height scroll).
7. Log Communication modal (the `_crmLogComm` body — find in legacy, write separate parity doc).
8. Add Reminder action with `customerCode` pre-filled (links to `crm-reminders.md`).

### DELTAs
- FY start hard-coded to `April 1` — confirm with finance/sales.
- Communications-as-side-effect (`auto_logged=true`) is a cross-cutting concern — best done as a service helper invoked by other modules.

### POLISH
- 32px 👤 icon in empty state.
- IN-style ₹ formatting.

---

**Sign-off needed:**
- Confirm scope. Estimate: ~800–1000 LOC (page + comm table + service + side-effect emitters).
- Confirm FY start: `04-01` per the file, or company-configurable?
- Decide: communications table standalone, or part of a broader "activity_log"-style table?
