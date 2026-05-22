# PARITY — Client Master (`renderClients`)

> **Legacy source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html` L12969–12995. Helpers: `clientForm` L12996, `addClient`/`editClient`/`delClient`/`addClientQuick` L13006–13066.
> **React target:** `apps/web/src/modules/clients/routes/list.tsx` (route `/clients`).
> **Status legend:** ✅ match · ❌ differs · ⚠️ partial.

---

## 0. Route + entry points

- ✅ Route `/clients` exists.
- ✅ Sidebar entry "🏢 Client Master" under Sales & CRM → Master.
- ✅ React file header explicitly states it ports `renderClients` (legacy L12969). High-fidelity port already.

---

## 1. Section header + toolbar

| # | Element | Legacy (L12984–12988) | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Header label | `Client Master` | (verify) | ✅ | — |
| 2 | Search input | `🔍 Search client, code…` 200px | ✅ React has search | ✅ | — |
| 3 | + New Client button | `addClient()` modal | ✅ React → `/clients/new` route | ✅ | — |
| 4 | Status filter (active/inactive) | not in legacy | ⚠️ EXTRA IN REACT | **DELTA** (workable; legacy soft-deletes via Trash) |

---

## 2. List table — columns (L12991, L12971–12980)

Legacy: **6 columns** in order:

| # | header | data | React | Match? | Tag |
|---|---|---|---|---|---|
| 1 | Code | `cl.code` cyan code | ✅ | ✅ | — |
| 2 | Client Name | `cl.name` bold | ✅ | ✅ | — |
| 3 | Address | `cl.address` text2 11px | ✅ | ✅ | — |
| 4 | Contact | `cl.contact` text2 11px | ✅ | ✅ | — |
| 5 | Email | `cl.email` text2 11px | ✅ | ✅ | — |
| 6 | (Actions) | Edit + Del buttons | ✅ (verify per-row links) | ✅ | — |

This file is a known good port — minimal gaps.

---

## 3. Form fields (clientForm L12996–13005)

Legacy form has 5 fields:
- Client Code ★ (e.g. CLI-001)
- Client Name ★ (full company name) — full-width
- Address — full-width
- Contact Person — (name / phone)
- Email

React form (`apps/web/src/modules/clients/components/client-form.tsx`) — verify all 5 fields are present with same labels. **Likely already matches** given the file header annotation.

---

## 4. Quick-add (addClientQuick L13042–13066)

Legacy provides a quick-add path from SO form — when the user is on the SO modal and there's no client yet, they can pop a small "Quick Add Client" modal and the dropdown auto-updates with the new client.

- ❌ React: no quick-add path from SO form. **DELTA** (workable — user navigates to /clients, adds, returns).

---

## 5. Summary

Total elements: 6 cols + 5 form fields + 1 quick-add helper
Matching outright (claimed): ~6 cols + 5 fields
Missing: 1 quick-add helper

### BLOCKERs
*(none — this page is largely at parity.)*

### DELTAs
1. **Quick-add Client from SO form** — would speed up first-time SO creation; defer.
2. **Active/Inactive status filter** (React extra) — keep; useful for managing dormant clients.

### POLISH
*(none — this page is largely visually faithful.)*

---

**Sign-off needed:**
- Verify visually that the React form has the same 5 fields with the same labels (Code, Name, Address, Contact Person, Email) and same star-marked requireds.
- Decide if the Quick-add path is worth porting now or later (recommend: defer to SO-1b).
