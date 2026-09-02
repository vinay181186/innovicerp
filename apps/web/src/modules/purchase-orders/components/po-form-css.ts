// The PO form's scoped stylesheet.
//
// Lifted out of `routes/from-pr.tsx` (where it was a file-local const) because
// the SAME form now serves both doors — create (`/purchase-orders/from-pr`) and
// edit (`/purchase-orders/$id/edit`) — and two copies of a palette drift apart.
//
// It stays scoped under `.pof-` on purpose: this screen's palette
// (#eef1f6 / #e4e7ee / #f7f9fc) and 10px-label type scale differ from the
// global theme tokens, and confining them here keeps every other screen
// untouched. Everything below the "line table" divider is new for the
// multi-PR redesign and follows the same palette — no third colour system.

export const PO_FORM_CSS = `
/* Bleed the page tint to the edges of #content. The negative margin MUST match
   #content's padding exactly (20px, 12px under 768px in innovic-theme.css) —
   a mismatch pushes the box wider than its parent and adds a horizontal
   scrollbar to the whole app, which this screen must never do.
   Sides and bottom only — a negative TOP margin would ride up over the
   breadcrumb trail that #content renders above the outlet. */
.pof-page{ background:#eef1f6; margin:0 -20px -20px; padding:14px 26px 26px;
  min-height:100%; box-sizing:border-box; }
@media (max-width:768px){ .pof-page{ margin:0 -12px -12px; padding:12px; } }
.pof-root{ font-family:'Public Sans',var(--bfont),sans-serif; color:#1c2333; }
.pof-root .mono,.pof-root .pof-num{ font-family:'JetBrains Mono',var(--mono),monospace; }
.pof-card{ background:#fff; border:1px solid #e4e7ee; border-radius:12px;
  max-width:1180px; margin:0 auto; padding:18px; }

/* Header — title left, "fields marked ★" note right. */
.pof-hdr{ display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  flex-wrap:wrap; margin-bottom:14px; }
.pof-title{ font-size:16px; font-weight:700; letter-spacing:-.01em; }
.pof-hdr-note{ font-size:11.5px; color:#8b93a2; }
.pof-chip{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:11.5px; font-weight:600;
  background:#eef3fb; color:#2054a8; border:1px solid #d6e3f7; border-radius:6px; padding:3px 8px; }

/* Fields */
.pof-lbl{ display:block; font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.07em; color:#8b93a2; margin-bottom:4px; }
.pof-req{ color:#c0392b; margin-left:2px; }
.pof-in{ width:100%; height:36px; border:1px solid #d9dee8; border-radius:7px;
  padding:0 9px; font-size:13px; color:#1c2333; background:#fff; font-family:inherit; }
.pof-in:focus{ outline:2px solid #cfe0f8; border-color:#2563c9; }
.pof-in.pof-num{ font-family:'JetBrains Mono',var(--mono),monospace; }
.pof-in:read-only{ background:#f2f4f8; color:#5a6376; }
.pof-ok{ border-color:#1f7a44; }
.pof-bad{ border-color:#c0392b; }
.pof-note{ font-size:11.5px; color:#5a6376; margin-top:3px; line-height:1.4; }
.pof-note-ok{ color:#1f7a44; font-weight:600; }
.pof-note-bad{ color:#c0392b; font-weight:600; }

/* The shared <VendorPicker> / <PrPicker> bring the global .form-label and the
   40px shadcn <Input> in with them. Inside this card they have to read like the
   fields beside them: same label, same control height. Scoped under .pof-root,
   so no other screen moves. */
.pof-root .form-label{ display:block; font-size:10px; font-weight:700; text-transform:uppercase;
  letter-spacing:.07em; color:#8b93a2; margin-bottom:4px; }
.pof-root .form-label .req{ color:#c0392b; }
.pof-row input{ height:36px; }
.pof-tbl input{ height:34px; font-size:12.5px; }

/* Header row — sized to content instead of stretched across the full card; a
   date picker does not need 280px. Wraps rather than overflows on a narrow
   window. */
.pof-row{ display:flex; flex-wrap:wrap; gap:12px 14px; margin-bottom:12px; align-items:flex-start; }
.pof-f-po{ flex:0 1 176px; min-width:0; }
.pof-f-date{ flex:0 1 148px; min-width:0; }
.pof-f-type{ flex:0 1 158px; min-width:0; }
.pof-f-vendor{ flex:1 1 280px; min-width:0; }
.pof-f-full{ flex:1 1 100%; min-width:0; }

/* ── PO line items ────────────────────────────────────────────────────── */
.pof-band{ display:flex; align-items:baseline; justify-content:space-between; gap:10px;
  flex-wrap:wrap; background:#f7f9fc; border:1px solid #e4e7ee; border-radius:8px 8px 0 0;
  padding:7px 12px; margin-top:14px; }
.pof-band-t{ font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#2054a8; }
.pof-band-sub{ font-size:11.5px; font-weight:500; text-transform:none; letter-spacing:0;
  color:#8b93a2; margin-left:8px; }
.pof-band-r{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:11.5px; color:#5a6376; }

.pof-tblwrap{ border:1px solid #e4e7ee; border-top:0; border-radius:0 0 8px 8px;
  overflow-x:auto; }
/* 980, up from 940: the PR No. column widened by 40px so a full document
   number fits, and without matching it here the extra width was taken out of
   the neighbouring columns instead. */
.pof-tbl{ width:100%; border-collapse:collapse; min-width:980px; }
.pof-tbl th{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; text-align:left; padding:9px 6px 3px; white-space:nowrap; }
.pof-tbl td{ padding:3px 6px; vertical-align:middle; white-space:nowrap; }
.pof-th-r{ text-align:right; }
.pof-r-top td{ padding-top:8px; }
.pof-r-end td{ padding-bottom:10px; border-bottom:1px solid #eef1f6; }
.pof-tbl tr:last-child td{ border-bottom:0; }
.pof-sr{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:12.5px; font-weight:700;
  color:#1c2333; padding-left:10px; }
.pof-sub-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; padding-left:10px; }
.pof-in-sm{ height:34px; font-size:12.5px; }
/* Read-only per-line amount — grey so it reads as derived, not typed. */
.pof-amt{ height:34px; display:flex; align-items:center; justify-content:flex-end; padding:0 9px;
  border:1px solid #e4e7ee; border-radius:7px; background:#f2f4f8; color:#5a6376;
  font-family:'JetBrains Mono',var(--mono),monospace; font-size:12.5px; }
.pof-prcode{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:11.5px; font-weight:600;
  color:#2054a8; background:#eef3fb; border:1px solid #d6e3f7; border-radius:6px;
  padding:5px 8px; display:inline-block; white-space:nowrap; }
/* Per-line guidance note ("pick a vendor first" / "no open PRs for X"). Full
   table width, because a sentence in the 168px PR cell wraps to six lines and
   stops being read. Amber = the pof-msg-warn palette; blue = the pof-chip one.
   No new colours. white-space:normal overrides the table's nowrap default. */
.pof-r-note td{ padding-top:0; padding-bottom:2px; white-space:normal; }
.pof-tip{ display:flex; align-items:flex-start; gap:8px; border-radius:7px;
  padding:7px 10px; font-size:12.5px; line-height:1.45; }
.pof-tip-t{ flex:1 1 auto; font-weight:600; }
.pof-tip-warn{ background:#fdf3da; border:1px solid #f2d9a0; color:#8a5a00; }
.pof-tip-info{ background:#eef3fb; border:1px solid #d6e3f7; color:#2054a8; }
.pof-tip-x{ flex:0 0 auto; height:20px; width:20px; border:0; border-radius:5px;
  background:transparent; color:inherit; font-family:inherit; font-size:12px; line-height:1;
  cursor:pointer; opacity:.7; }
.pof-tip-x:hover{ opacity:1; background:rgba(0,0,0,.07); }

.pof-x{ height:34px; width:34px; border:1px solid #f0cdc7; background:#fff; color:#c0392b;
  border-radius:7px; cursor:pointer; font-size:15px; line-height:1; font-family:inherit;
  display:inline-flex; align-items:center; justify-content:center; }
.pof-x:hover:not(:disabled){ background:#fdecea; }
.pof-x:disabled{ opacity:.35; cursor:not-allowed; }
.pof-add{ height:32px; padding:0 12px; border-radius:7px; border:1px solid #d6e3f7;
  background:#eef3fb; color:#2054a8; font-size:12px; font-weight:700; cursor:pointer;
  white-space:nowrap; font-family:inherit; }
.pof-add:hover{ background:#e2ebf9; }
.pof-empty{ padding:16px; text-align:center; font-size:12.5px; color:#8b93a2; }

/* Tax + live totals share one strip. */
.pof-tax{ background:#f7f9fc; border:1px solid #e4e7ee; border-radius:8px; padding:12px 14px;
  display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin-top:14px; }
.pof-tax-f{ width:96px; flex:0 0 auto; }
.pof-tax-f.pof-tax-type{ width:150px; }
.pof-dim{ opacity:.45; }
.pof-tot{ margin-left:auto; display:grid; grid-template-columns:auto auto; gap:2px 18px;
  align-items:baseline; text-align:right; }
.pof-tot-l{ font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.07em;
  color:#8b93a2; text-align:left; }
.pof-tot-v{ font-family:'JetBrains Mono',var(--mono),monospace; font-size:13px; font-weight:600;
  color:#3a4256; }
.pof-tot-l.pof-tot-big{ color:#3a4256; font-size:10px; }
.pof-tot-v.pof-tot-big{ font-size:19px; font-weight:700; color:#8a5a00; }

/* Footer */
.pof-foot{ display:flex; align-items:center; justify-content:space-between; gap:12px;
  border-top:1px solid #e4e7ee; margin-top:16px; padding-top:13px; }
.pof-foot-msg{ font-size:12px; font-weight:700; color:#8a5a00; }
.pof-foot-hint{ font-size:11.5px; color:#5a6376; }
.pof-acts{ display:flex; gap:8px; }
.pof-btn{ height:36px; padding:0 15px; border-radius:7px; font-size:13px; font-weight:600;
  font-family:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.pof-btn-cancel{ background:#fff; color:#3a4256; border:1px solid #d9dee8; }
.pof-btn-cancel:hover{ background:#f4f6fa; }
.pof-btn-go{ background:#1f7a44; color:#fff; border:1px solid #1f7a44; }
.pof-btn-go:hover:not(:disabled){ background:#1a6839; }
.pof-btn-go:disabled{ background:#eef1f6; color:#8b93a2; border-color:#e4e7ee; cursor:not-allowed; }

.pof-msg{ border-radius:7px; padding:8px 12px; font-size:12.5px; margin-bottom:12px; }
.pof-msg-warn{ background:#fdf3da; border:1px solid #f2d9a0; color:#8a5a00; }
.pof-msg-err{ background:#fdecea; border:1px solid #f5c2bc; color:#a4291c; }
`;
