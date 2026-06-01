# PARITY — Access Control (`renderAccessControl`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`
> - List + role-change + Configure button: `renderAccessControl` L13861–13905
> - Per-user editor modal: `_editAccess` L13917–14005
> - Helper gates (used 173× across the legacy file): `isAdmin` L13776, `isManager` L13777, `canEdit(formKey)` L13778, `canEntry(formKey)` L13785, `canView(formKey)` L13792, `_hasDeptAccess(dept)` L13799, `_getUserAccess(userId)` L13805
> - Form registry: `_allForms` L13811–13847 (35 entries) · Dept registry: `_allDepts` L13849–13859 (9 entries)
> - CSV template + import: `_userTemplate` L14015 · `_userImport` L14027
> - Role-change handler: `_changeUserRole` L13907
> - Home-page role-routing using access: `_detectPrimaryDept(ac)` L2522 + `_homeSpecialistView` L2511

> **React target:** ❌ **WHOLE FEATURE MISSING.** No `/access-control` route; no `user_access` table; `canView/canEdit/canEntry` helpers don't exist; current React only gates on `users.role` directly (admin/manager checks scattered in components).

> **Status:** ❌ greenfield. Last named Phase A master per ADR-028 / TASKS.md resume checklist line 81.

---

## 1. What this feature is

A **per-user, fine-grained permission matrix** layered on top of the role enum. For every user, the admin can configure:

- **Full Access** (boolean override — admin-equivalent for that one user)
- **Department visibility** — 9 departments; controls sidebar section visibility
- **Form-level View/Entry/Edit** — 35 form keys × 3 actions = 105 toggles per user

The role is **also editable inline** on this screen (the role dropdown lives both in the list row and the Configure modal — they're the same field).

The gate functions `canView/canEdit/canEntry(formKey)` are called 173× across the legacy file: every "+ New X" button, every Edit pencil, every Delete, every list-view-vs-empty check. Default-on for unknown users (`if(!u) return true;` — fail-open).

---

## 2. Data model (legacy)

Single Firebase collection `userAccess`. One record per user:

```js
{
  userId: 'u-123',
  fullAccess: false,           // true ⇒ everything below is ignored
  departments: { sales: true, qc: true, ... },     // 9 dept keys → bool
  forms: {
    so_create: { view: true, entry: true, edit: false },
    qc_submit: { view: true, entry: false, edit: false },
    ...
  },
  canEditAny: true,            // computed cache: any form has edit:true
  canEntryAny: true,           // computed cache: any form has entry:true OR edit:true
}
```

**View/Entry/Edit hierarchy** (legacy `_editAccess` L13981, L13988):
- Checking **Edit** auto-checks Entry and View
- Checking **Entry** auto-checks View
- View can be alone

On save the form rows are reconstituted from the View/Entry/Edit checkboxes and the cascade re-applied.

---

## 3. Roles (legacy)

7 roles in the dropdown (L13879–13885):
- `admin`, `manager`, `sr_engineer`, `engineer`, `jn_engineer`, `operator`, `viewer`

⚠️ **DELTA — role enum mismatch.** Our React app has **8 different roles** (`packages/shared/src/enums/user-role.ts`):
- `admin`, `manager`, `operator`, `qc`, `procurement`, `dispatch`, `design`, `viewer`

The React enum is domain-specialised (qc/procurement/dispatch/design) where legacy is seniority-tiered (sr/jn engineers). All existing RLS policies key off our 8-role enum. **Recommendation: keep our 8 roles unchanged.** Map legacy's tier roles to `operator` or `viewer` at migration if/when users are imported.

---

## 4. Departments (legacy, L13849)

| key | label | colour |
|---|---|---|
| `planning` | Planning | #8B5CF6 |
| `sales` | Sales | #22C55E |
| `store` | Store | #F59E0B |
| `design` | Design | #8B5CF6 |
| `production` | Production | #06B6D4 |
| `qc` | QC | #EF4444 |
| `purchase` | Purchase | #2563EB |
| `finance` | Finance | #0D9488 |
| `system` | System | #64748B |

Used for sidebar-section visibility (`_hasDeptAccess('sales')` → show Sales section). Port verbatim.

---

## 5. Forms (legacy, L13811–13847) — 35 entries

| # | key | dept | label | React module status |
|---|---|---|---|---|
| 1 | `so_create` | sales | SO Master | ✅ shipped |
| 2 | `jw_create` | sales | JW Master | ✅ shipped |
| 3 | `client_create` | sales | Client Master | ✅ shipped |
| 4 | `dispatch_create` | sales | Dispatch Register | 🟡 partial (DC list, no Dispatch Register screen) |
| 5 | `plan_create` | planning | SO/JW Planning | ✅ shipped |
| 6 | `jc_create` | production | Job Cards | ✅ shipped (read-only) |
| 7 | `op_entry` | production | Op Entry | ✅ shipped |
| 8 | `machine_create` | production | Machine Master | ✅ shipped |
| 9 | `operator_create` | production | Operator Master | ✅ shipped |
| 10 | `routecard_create` | design | Route Cards | ✅ shipped |
| 11 | `bom_create` | design | BOM Master | ✅ shipped |
| 12 | `item_create` | store | Item Master | ✅ shipped |
| 13 | `grn_create` | store | GRN | ✅ shipped |
| 14 | `issue_create` | store | Item Issue Register | ✅ shipped |
| 15 | `design_create` | design | Design Tracker | ✅ shipped |
| 16 | `dsnproj_create` | design | Design Projects | ✅ shipped |
| 17 | `dsnissue_create` | design | Design Issues | ✅ shipped |
| 18 | `dsnworklog_create` | design | Daily Work Log | ✅ shipped |
| 19 | `dsndcr_create` | design | Design DCR/DCN | ✅ shipped |
| 20 | `toolissue_create` | store | Tool Issue Register | ✅ shipped |
| 21 | `party_create` | store | Party Material | ✅ shipped |
| 22 | `qc_submit` | qc | QC Call Register | ✅ shipped |
| 23 | `qc_incoming` | qc | Incoming QC | ✅ shipped |
| 24 | `qcprocess_create` | qc | QC Process Master | ✅ shipped |
| 25 | `nc_dispose` | qc | NC Register | ✅ shipped |
| 26 | `capa_create` | qc | CAPA | ✅ shipped |
| 27 | `pr_create` | purchase | Purchase Requests | ✅ shipped |
| 28 | `po_create` | purchase | Purchase Orders | ✅ shipped |
| 29 | `vendor_create` | purchase | Vendor Master | ✅ shipped |
| 30 | `oj_create` | purchase | Outsource Jobs | ❌ missing module |
| 31 | `ospdc_create` | purchase | OSP DC & Outward | ✅ shipped (via delivery-challans) |
| 32 | `servicepo_create` | purchase | Service PO | ❌ missing module |
| 33 | `machop_entry` | production | Machine Op Entry | ✅ shipped |
| 34 | `cc_create` | finance | Cost Center Master | ✅ shipped |
| 35 | `user_manage` | system | User Management | ✅ shipped |

Port all 35 verbatim. Keys for missing modules (#30, #32) stay in the registry so when those modules ship later their gating is pre-defined.

**Forms our React build added that legacy didn't have separate keys for** (candidates for new keys):
- TPI · QC Documents · QC History · QC Call Register (covered by `qc_submit`) · NC Register (covered by `nc_dispose`)
- Delivery Challans (covered by `ospdc_create` + `dispatch_create`)
- Reports · Activity Log · Alerts · Alert Config · Print Templates · Settings · Access Control itself

Open question for sign-off (Q3 below): do we add keys for these now or only as modules ask for them?

---

## 6. List view (legacy `renderAccessControl` L13861)

- **Empty state:** "No users. Create users in User Management first." if `db.users` is empty.
- **Header:** `🔒 Access Control` + 2 ghost buttons (📥 Template — CSV download, 📤 Import Users — CSV/XLSX).
- **Table cols:** User · Role (inline dropdown — saves on change) · Departments (`N/9` or `✅ Full Access`) · Forms (`N/35` or `✅ All`) · Actions (`🔒 Configure` → opens modal).
- **Hint footer:** "💡 Click Configure to set department access and form-level view/edit permissions per user."
- **Admin-gate:** any non-admin opening this page sees a locked view (legacy uses `isAdmin()` checks at the *write* path — the page itself renders for anyone but writes silently no-op + toast "Only Admin can change user roles"). Our React version should hide the route entirely from non-admins (cleaner).

## 7. Configure modal (legacy `_editAccess` L13917)

`showModalLg` modal titled `🔒 Access Control — <user name>`:

1. **Header strip:** user name + role chip + role dropdown (`fAcRole`, 7 options — same as list). Saved on modal-OK.
2. **Full Access banner:** green panel with `☐ ✅ Full Access (Admin) — overrides all settings below`. Toggling auto-checks + disables every dept/form input below.
3. **DEPARTMENT VIEW ACCESS:** flex-wrap of dept chips, each `<label><input class="acDept" data-dept=…></label>`. Colour-coded.
4. **FORM / FEATURE ACCESS:** 35-row table with View/Entry/Edit per row. Footer hint "💡 View = see data | Entry = create new records | Edit = modify/delete existing records".
5. **Save callback:** parses View/Entry/Edit checkboxes back into nested `forms[key]={view,entry,edit}` shape, applies View/Entry/Edit cascade (Entry checked → View also true; Edit checked → View+Entry also true), computes `canEditAny` / `canEntryAny` caches. Writes role change if changed.
6. **Activity log on save:** `ACCESS | Access Control | Updated access for <name>`.

---

## 8. Helpers (the 173× gate callsites)

```ts
// All fail-open when no user (script-loaded outside an authenticated session)
function isAdmin()  { ac?.fullAccess || user.role === 'admin' }
function isManager(){ user.role === 'admin' || user.role === 'manager' }
function canEdit(formKey?)  { ac?.fullAccess || (formKey ? ac.forms[formKey]?.edit : ac.canEditAny !== false) }
function canEntry(formKey?) { ac?.fullAccess || (formKey ? (ac.forms[formKey]?.entry || ac.forms[formKey]?.edit) : ac.canEntryAny !== false) }
function canView(formKey?)  { ac?.fullAccess || (formKey ? (ac.forms[formKey]?.view || ac.forms[formKey]?.entry || ac.forms[formKey]?.edit) : true) }
function _hasDeptAccess(dept){ ac?.fullAccess || ac.departments[dept] }
```

Three implications worth flagging:

1. **`canView` defaults to `true`** when called without a `formKey`. Only `canEdit` and `canEntry` use the `canEditAny` / `canEntryAny` precomputed caches.
2. **Hierarchy is read-time, not write-time** — i.e. `canView('po_create')` returns true if *any* of view/entry/edit is set on that form. The write side already cascades them (Entry sets View true), so in practice you'll see all three together; but reads still fall back across them defensively.
3. **No user object ⇒ allow everything.** This is the legacy single-tenant-file model. **We MUST NOT replicate this on the server** — we require a session for every gated action. Frontend helpers can still do "no session ⇒ assume nothing" (deny by default).

---

## 9. DELTAs for our React + Supabase architecture

1. **Move storage to Postgres** — new `user_access` table, one row per user. JSONB for `departments` + `forms` (small ~35-key map, varies per user; relational explode is overkill).
2. **Admin-only writes** — both at RLS (`current_user_role()='admin'`) and at service layer.
3. **No fail-open on the server** — every protected endpoint must require an explicit grant. Helpers on the **frontend** still fail-closed (treat missing data as denial), to avoid flashing buttons that the server will reject.
4. **Role enum stays 8 not 7** — we don't introduce sr/jn engineer tiers; admin tooling can map legacy tiers to `operator`/`viewer` at import.
5. **Activity log** — every save emits `ACCESS / Access Control / Updated access for <name>` (matches legacy semantics through the existing `emitActivityLog` helper).
6. **Bootstrap default** — legacy gives every NEW user `fullAccess:true` (L1254). That's a bug; **we default to `fullAccess:false` with empty `departments` and `forms`** for new users. Admins must explicitly grant access. Existing users get a one-time backfill row at migration time, defaulting to `fullAccess:true` for `admin` role and `false` otherwise.
7. **`dispatch` role overlap** — our `dispatch` role doesn't appear in legacy's role enum; it should map to its own form-level grants once a Dispatch Register page exists. For now, `dispatch_create` form key is unowned by any module.
8. **`canEditAny` / `canEntryAny` caches** — compute server-side on each save (legacy stored them; we recompute on read so the cache can't drift).
9. **Import flow** — deferred. Single-tenant CSV import doesn't fit our multi-tenant Supabase Auth model (which owns invitations). Users module already handles invites; access import would be a JSON paste / matrix-clone feature later if needed.

---

## 10. Server-side enforcement — three scope choices for sign-off

This is the **biggest scope decision**, surfaced in §11 below as **Q1**.

| | (A) Storage + UI only | (B) UI + service-layer gate | (C) UI + service + RLS session vars |
|---|---|---|---|
| **DB** | `user_access` table | same | same + `current_user_form_perms()` SECURITY DEFINER fn |
| **API** | `GET /access-control/users` + `GET /:userId` + `PUT /:userId` + `GET /me/access` | same + per-write `requireFormPermission(key, action)` middleware on every protected route | same + RLS policies key off `current_user_form_perms()` |
| **Web** | Matrix list + Configure modal · `useMyAccess()` hook · `canEdit/canEntry/canView` client helpers · sidebar dept-gate · button-hide gating | same | same |
| **Touch points** | new module only | every write route (~80–120 lines) | new RLS migration on every table |
| **Effort** | ~1 day | ~3–4 days | ~5–7 days |
| **Risk** | low (additive) | medium (regression on writes if a route misses the gate) | high (RLS rewrite blast radius) |
| **What it BREAKS if absent** | nothing — existing role-based RLS still protects writes; the matrix is purely advisory until enforced | clients with no `xxx_create.edit` permission can still PUT via direct API call — they're just hidden in UI | not applicable |

**Build-first-audit-later recommendation: ship (A) now.** Hide buttons by per-user grants; back-end keeps role-based RLS as the actual security boundary. (B) becomes part of the focused logic-correction audit pass.

---

## 11. Open questions — sign-off before any code

1. **Enforcement scope: (A) UI-only, (B) +service-layer gate, or (C) full RLS rewrite?** Recommend **(A)** now, mark (B) as a deferred audit task, skip (C) entirely (role-RLS is sufficient for our threat model — non-admins can't bypass it via direct DB).
2. **Form registry: port legacy's 35 keys verbatim, or extend?** Recommend **port + add 4 keys for new React modules** (`tpi_submit`, `qcdocs_upload`, `accesscontrol_manage`, `printtpl_edit`) so the matrix isn't out-of-date the day it ships. Modules that don't exist yet (`oj_create`, `servicepo_create`) keep their keys so they're pre-wired.
3. **Bootstrap default for existing users:** backfill row with `fullAccess:true` for admins, `fullAccess:false + empty grants` for everyone else? (Recommended — fails closed for non-admins so they don't get silent access from a stale legacy row.)
4. **Inline role-change still allowed from this screen?** (Legacy lets admins flip role from the matrix list — same field as Users module's edit page.) Recommend **yes** — admins are already on the screen choosing perms, the role is part of the picture.
5. **CSV template + Import users buttons** — skip both for now? Users module already handles add; the CSV is a single-tenant legacy artefact. Recommend **skip**, leave footer as just the hint.
6. **Department-gating in sidebar** — actually wire it (hide Sales section if `_hasDeptAccess('sales')===false`), or just store the bits for later? Recommend **wire it now** — it's the most visible payoff and a small change to one file (`_authenticated.tsx` sidebar).

---

## 12. Phased build plan (single commit, sliceable if needed)

If sign-off lands on plan **(A) + recommended answers** above:

**Slice 1 — Foundation (DB + shared + API)**
- Migration `004X_phase8_user_access.sql`: `user_access` table (`id`, `user_id` UNIQUE, `company_id`, `full_access`, `departments` jsonb, `forms` jsonb, meta cols, soft-delete, RLS: admin write + self-read).
- Backfill: insert `{full_access:true,departments:{},forms:{}}` for every existing `users.role='admin'`; `{full_access:false,...}` for everyone else.
- `packages/shared/src/enums/access-control.ts`: `ACCESS_DEPTS` (9), `ACCESS_FORMS` (35+4), `Action = 'view'|'entry'|'edit'`.
- `packages/shared/src/schemas/access-control.ts`: zod for `UserAccess`, `SaveUserAccessInput`, `EffectiveAccess` (resolved view for `/me`).
- API module `access-control`: `getMyAccess()`, `listUsersWithAccess()` (admin), `getUserAccess(userId)` (admin), `saveUserAccess(userId, input)` (admin, recomputes caches, emits activity).
- Service tests: list + get + save + cascade rules + admin-only enforcement + activity emission.

**Slice 2 — Web matrix UI**
- `apps/web/src/modules/access-control/{api,components,routes}/...`
- `/access-control` list (table from §6) + Configure modal (from §7) + role-change inline.
- `useMyAccess()` hook + `canView/canEdit/canEntry/hasDeptAccess` helpers in `apps/web/src/lib/access-control.ts`. Fail-closed.
- Sidebar dept-gating in `_authenticated.tsx`.
- Web typecheck + lint clean.

**Total estimated effort:** ~1 day end-to-end given the existing module-creation rails. No new test infra needed.

---

## 13. Out of scope (record as DELTAs at close-out)

- Service-layer write gating on the 30+ existing modules — deferred to the focused logic-correction audit per `feedback-build-first-audit-later`.
- Form keys for modules not yet built (`oj_create`, `servicepo_create`) stay defined; their UI gating activates when those modules ship.
- CSV user-import (legacy `_userImport` L14027) — skipped (creates users; incompatible with Supabase Auth owning invites). **Replaced 2026-06-01 (AUDIT-4) with a JSON matrix clone** in the Configure modal: "Copy matrix as JSON" (clipboard) + "Paste matrix JSON" (validated via `saveUserAccessInputSchema`, loaded into the editor, saved on Save Access). Lets an admin clone one user's permissions to another — the model-appropriate version of the deferred import.
- Legacy `sr_engineer/engineer/jn_engineer` role tiers — not added; legacy user imports map to `operator`/`viewer`.
- `_homeSpecialistView` role-routing on the home dashboard (L2511) — depends on this matrix existing; can wire as a follow-up once the matrix is live and populated.
