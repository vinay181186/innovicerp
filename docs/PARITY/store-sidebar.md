# PARITY — Store sidebar block (#sidebar > .sb-mod-store)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L425–440. Dept color `--dept-store:#d97706`. Page-title map L2219–2221, icon map L2258, render map L2408–2471.
> **React target:** `apps/web/src/components/shared/sidebar.tsx` SECTIONS[2] `key:'store'`.
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.
> **Tag every gap:** **BLOCKER** · **DELTA** · **POLISH**.

---

## Comparison matrix

### Section header (L425)

| # | Element | Legacy (L425) | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Section key | `'store'` | `key: 'store'` | ✅ | — |
| 2 | Section label | `Store` | `Store` | ✅ | — |
| 3 | Section icon | 🏬 (`&#127980;`) | 🏬 | ✅ | — |
| 4 | Mod class | `sb-mod-store` | `modClass: 'store'` | ✅ | — |

### Group + items (L427–439)

| # | Group | Pos | Legacy item (line) | React item | Match? | Tag |
|---|---|---|---|---|---|---|
| 1 | Entry | 1 | `grn` · 📥 **"GRN (Goods Receipt)"** (L428) | `/goods-receipt-notes` · 📥 **"GRN"** | ⚠️ label trim | **POLISH** (legacy adds "(Goods Receipt)" suffix) |
| 2 | Entry | 2 | `issueregister` · 📋 **"Item Issue Register"** (L429) | *(missing)* | ❌ MISSING | **BLOCKER** (production team uses this daily to issue items to JCs) |
| 3 | Entry | 3 | `toolissue` · 🔧 **"Tool Issue Register"** (L430) | *(missing)* | ❌ MISSING | **DELTA** (tool tracking — useful but lower freq) |
| 4 | Entry | 4 | `partygrn` · 📥 **"Party Material GRN"** (L431) | *(missing)* | ❌ MISSING | **BLOCKER** (JW workflow — client material in) |
| 5 | Entry | 5 | `jwdc` · 📋 **"JW Delivery Challan"** (L432) | *(missing — `/delivery-challans` is sales-side DC)* | ❌ MISSING | **BLOCKER** (JW workflow — material out to vendor) |
| 6 | Master | 1 | `items` · ◉ **"Item Master"** (L434) | `/items` · ◉ **"Item Master"** | ✅ | — |
| 7 | Master | 2 | `partymaterial` · 🏭 **"Party Material Master"** (L435) | *(missing)* | ❌ MISSING | **BLOCKER** (catalogue of customer-supplied raw materials) |
| 8 | Report | 1 | `store` · 📦 **"Store / Inventory"** (L437) | *(missing — different page from stockledger)* | ❌ MISSING | **BLOCKER** (consolidated current-stock view across items) |
| 9 | Report | 2 | `stockledger` · 📖 **"Stock Ledger"** (L438) | `/store-transactions` · 📖 **"Stock Ledger"** | ✅ | — |
| 10 | Report | 3 | `rpt_store` · 📊 **"Store Reports"** (L439) | *(could exist via /reports?group=Store)* | ❌ MISSING | **DELTA** (generic reports dept variant) |

### React Store sidebar today (3 items in 3 groups)

```
Store
├── Entry      · GRN
├── Master     · Item Master
└── Report     · Stock Ledger
```

vs. legacy 10 items in 3 groups → React is at **30% structural parity**.

---

## Page-title map (legacy L2219–2221)

| page | title |
|---|---|
| `grn` | `GRN` |
| `issueregister` | `Item Issue Register` (verify) |
| `toolissue` | `Tool Issue Register` |
| `partygrn` | `Party Material GRN` |
| `jwdc` | `JW Delivery Challan` |
| `items` | `Item Master` |
| `partymaterial` | `Party Material Master` |
| `store` | `Store / Inventory` |
| `stockledger` | `Stock Ledger` |
| `rpt_store` | `Store Reports` |

---

## Summary

Total elements: 10 items + 3 groups
Matching outright: 2 (Item Master, Stock Ledger)
Differing on label: 1 (GRN label trim)
Missing in React: 7 whole pages

### BLOCKERs (daily-use critical)
1. **Item Issue Register** — production team needs this to log JC material issuance
2. **Party Material GRN** — JW workflow — recording client-supplied material receipt
3. **JW Delivery Challan** — JW workflow — sending material to vendor
4. **Party Material Master** — catalogue of customer-supplied materials
5. **Store / Inventory** — consolidated current-stock view (different from per-transaction stockledger)

### DELTAs (workable today)
6. **Tool Issue Register** — useful but lower frequency than item issue
7. **Store Reports** dept variant — reuse `/reports?group=Store` once we add reports tagged with that group

### POLISH
- GRN label: "GRN" → "GRN (Goods Receipt)" to match legacy L428.

---

**Sign-off needed before code:**
- Confirm 5 BLOCKERs above for next Store slice
- Decide which to ship first (recommend: Store / Inventory + Item Issue Register — both consumed multiple times per day)
- Confirm JW DC sidebar entry can be added once JW DC outward/inward tables are migrated (separate slice)
