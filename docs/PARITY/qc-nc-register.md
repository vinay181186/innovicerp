# PARITY — NC Register (`renderNCRegister`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L22494–22563 (`renderNCRegister`, `_addManualNC` L22565, `_disposeNC`).
> **React target:** `apps/web/src/modules/nc-register/routes/list.tsx` (route `/nc-register`). Already legacy-chrome (0 shadcn imports).

---

## Verdict: at parity on chrome; minor column/label DELTAs

### Summary cards (legacy 5, L2514–2519)
Total · Pending · Total Qty · Rework · Scrap. React has summary cards present. ✅ (verify the 5 match).

### Table columns
Legacy **10** (L2559): Rej No. · Date · JC No. · **Operation** · Item · Qty · Reason · Disposition · Status · Actions.
React: NC No. · Date · JC · Item · Rej qty · Reason · Disposition · Status · (Actions).

| Legacy | React | Tag |
|---|---|---|
| Rej No. | "NC No." | POLISH (label) |
| Operation (Op{seq}: name) | **missing** | **DELTA** — add Operation column (data: nc row opSeq/operation) |
| Qty | "Rej qty" | POLISH (label) |
| Actions: 👁 View · ✏ Dispose(Pending) · ✅ Close(rework) · 🛡 CAPA · 👤+ Assign | View/Dispose present | DELTA — CAPA link + Assign (CAPA page + Tasks gate) |

### Filters
Legacy: search + Status select + Reason select. ✅ (verify React has both selects).

### Header
Legacy "❌ NC Register" + "❌ Report NC" button (`_addManualNC` modal). ✅ React has new/report entry.

### Remaining (DELTA)
- Add **Operation** column to the list.
- "🛡 CAPA" create/link action (depends on CAPA page — Wave 3).
- Label polish: "Rej No." / "Qty".
