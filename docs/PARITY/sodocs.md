# PARITY — SO Documents (`renderSODocs`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L19478–19620+ (`function renderSODocs`). Supporting: `_fsGetSOFiles`, `_fsFindSOLine`, `_sdUploadFiles`, `_sdDownloadZip`, `_sdArchiveSO`, `_sdRestoreSO`.
> **React target:** ❌ **WHOLE PAGE MISSING.** No `/so-docs` route. No `fileRegistry` table in current schema.
> **Status:** ❌ entire feature absent; gated by missing file-registry abstraction.

---

## 0. What this page is

A file-management view scoped to an SO. Two modes:

1. **Overview mode** (no SO selected): table of all SOs with file counts, status, total size, archived count.
2. **Detail mode** (SO selected): 4-tile stat strip + action buttons + files grouped by SO line, then by category.

---

## 1. Page chrome (L19489–19495)

| # | Element | Legacy | Tag |
|---|---|---|---|
| 1 | Section header | `📁 SO Documents` | needs port |
| 2 | SO picker | `<select>` with `<soNo> — <customer> (<N> files)` (280px min) | **BLOCKER** |

---

## 2. Overview mode (no SO selected, L19498–19519)

Table with 7 columns: `SO No · Customer · Status · Files (green count) · Size (MB) · Archived (📦 N if any) · (action — 📂 View)`. Click row navigates to detail mode.

---

## 3. Detail mode (SO selected, L19522–end)

### 3.1 4-tile stat strip (L19531–19536)

| # | tile | value | colour |
|---|---|---|---|
| 1 | TOTAL FILES | `allFiles.length` | green big 24px |
| 2 | TOTAL SIZE | `(totalSize/1048576).toFixed(1) + ' MB'` | cyan 18px |
| 3 | ARCHIVED | `archivedFiles.length` | amber 24px |
| 4 | STATUS | `badge(so.status)` | per-status |

### 3.2 Action buttons (L19539–19544)

- 📤 **Upload Document** — `<input type="file">` with `image/*,.pdf,.doc,.docx,.xls,.xlsx` multi-select.
- 📥 **Download All (ZIP)** — `_sdDownloadZip(soNo)` (only when files exist).
- 📦 **Archive & Purge** — `_sdArchiveSO(soNo)` (only when status ∈ {Completed, Dispatched, Closed} AND files exist).
- 📤 **Restore from ZIP** — `_sdRestoreSO()` (only when archived files exist).

### 3.3 Per-line grouped panels (L19546+)

Files are grouped by SO line (via `f.soLineNo` or auto-detected from JC/GRN), then by **category**:

```
Category order: drawing → qc-docs → inspection → tpi → incoming-qc → po-docs → design → dispatch → other
```

Each line gets a `.panel` with green-tinted header: `📦 Line N: <itemCode> — <itemName> (Qty: N)` + `<files> files · <KB>`.

Inside each line panel, category sub-headers (uppercase 10px muted) followed by file rows (filename, size, uploaded-by, view/download/delete buttons — verify deeper in the file).

---

## 4. File registry schema (missing in current React schema)

The whole module is gated by a **`file_registry` table** with at minimum:

```
file_registry (
  id uuid PK,
  company_id uuid,
  so_no text,           -- denorm for fast lookup
  so_line_no integer,
  jc_no text,
  grn_no text,
  category text,        -- one of: drawing, qc-docs, inspection, tpi, incoming-qc, po-docs, design, dispatch, other
  file_name text,
  file_size integer,
  storage_path text,    -- Supabase Storage object key
  download_url text,    -- public/signed URL
  status text DEFAULT 'active',  -- active | archived
  uploaded_by text,
  uploaded_at timestamptz DEFAULT now(),
  ...
)
```

Plus a Supabase Storage bucket for the actual file blobs.

---

## 5. Summary

### BLOCKERs
1. **`file_registry` table** + Drizzle schema + RLS.
2. **Supabase Storage bucket** + signed-URL policy.
3. **Upload + Download + List API endpoints.**
4. **Overview mode + Detail mode UI**.
5. **Per-line auto-detection** (`_fsFindSOLine`) — needs SO line aware classification.

### DELTAs
6. **Archive & Purge** flow — moves files from active storage to a `archived/` prefix; freed-space tracking.
7. **Download All (ZIP)** — server-side ZIP assembly endpoint.

### POLISH
- Category icon set matches legacy.

---

**Sign-off needed:**
- Confirm this is desired now or post-cutover. Estimate: large — ~1500 LOC across schema/service/route/web + Supabase Storage bucket setup.
- Decide: per-line auto-detection or pure manual classification?
