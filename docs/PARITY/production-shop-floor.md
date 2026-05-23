# PARITY — Shop Floor / Machine Op Entry + Live Ops (`renderShopFloor`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L10286 (`renderShopFloor`).
> **React target:** `apps/web/src/modules/op-entry/routes/machines.tsx` (`/op-entry/machines`) + `routes/running.tsx` (`/op-entry/running`) + `components/{machine-card,running-ops-board}.tsx`.

---

## Verdict: functionally present, **wrong chrome** — refactor needed

Legacy `renderShopFloor` is the machine-grid shop-floor view: machine cards (idle/running), pick a machine → start/log the active op. React splits this into:
- **`/op-entry/machines`** — machine card grid + pending-ops/running form (Machine Op Entry).
- **`/op-entry/running`** — Live Operations board (running sessions).

Both **work** but use **shadcn chrome** (`container max-w-6xl`, shadcn `Table`/`Button`, `rounded-md border bg-card`).

### Differences
| # | Element | Legacy | React | Tag |
|---|---|---|---|---|
| 1 | Page chrome | `.section-hdr`/`.panel`/`.btn`/`.mach-card` | shadcn `<main className="container…">`, shadcn Table/Button | **BLOCKER** chrome |
| 2 | Machine cards | `.mach-card` (id/name/type, avail/hrs nums, load bar, status badge) | `MachineCard` component (shadcn) | **DELTA** — needs `.mach-card` class + load bar (load bar needs machineLoad calc) |
| 3 | Pending-ops table | legacy table | shadcn `<Table>` | **BLOCKER** chrome — convert to `.innovic-table` |
| 4 | Live ops board | running sessions list | `running-ops-board` component | verify chrome |

### Build plan
- Refactor `machines.tsx` + `running.tsx` + `machine-card.tsx` + `running-ops-board.tsx` to legacy chrome (`.section-hdr`, `.panel`, `.innovic-table`, `.btn`, `.mach-card`).
- Machine-card load bar (load %, avail qty, pending hrs) needs the `machineLoad` aggregation — shared with Machine Loading + Machine Master. Add when that view ships; until then show the fields available on the machine row.
