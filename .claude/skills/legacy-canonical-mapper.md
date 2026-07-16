---
name: legacy-canonical-mapper
description: Strict 1:1 mapping skill that mirrors any UI element from the legacy HTML file verbatim. Use when user says "map <element> to legacy", "verify <X> matches HTML", "what does HTML say about <X>", or any request where the legacy HTML is the authoritative spec. NEVER invents content. NEVER infers. ALWAYS surfaces a comparison report. Any deviation from legacy HTML is unacceptable and must be flagged.
---

# Legacy Canonical Mapper

## Purpose

This skill enforces strict 1:1 parity between the legacy HTML file and the
current React implementation. The legacy HTML is the SINGLE SOURCE OF TRUTH.

**Core principles:**
1. **No invention** — every field, label, button, color, icon must come from legacy HTML
2. **Atomic mapping** — each element is mapped individually with line citation
3. **Canonical** — one and only one interpretation per element
4. **Verifiable** — every claim shows the exact HTML line number
5. **Comparison-first** — output always shows side-by-side comparison
6. **No ambiguity** — if multiple interpretations exist, STOP and ask user

## When this skill activates

User says any of:
- "map <element> to legacy"
- "verify <X> matches HTML"
- "what does HTML say about <X>"
- "compare <module> to legacy"
- "check left menu / sidebar / sales orders / etc."
- "build <element> from HTML"
- "match <X> with HTML"

Also activates implicitly when:
- User uploads HTML and asks for any UI work
- User says "as per HTML"
- User mentions "legacy" + "match" / "mirror" / "1:1"

## Reference file

**Authoritative source:** `legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`

If this file is missing, STOP immediately. Tell user:
> "Cannot proceed. Legacy HTML file not found at expected path. Please confirm
> location of `InnovicERP_v82_12_3_DataLossFix_29-04-2026.html`."

## Method (FOLLOW EXACTLY)

### Step 1: Identify the legacy source for the requested element

| Element type | Where to find in legacy HTML |
|---|---|
| Left menu / sidebar | `#sidebar` element + sidebar JS structure |
| Top bar | `#topbar` element |
| Page (any module) | `render<Name>()` JavaScript function |
| Form | `function showModal*` or `function edit*` |
| Table columns | Inside the `render*` function's table |
| Status badge | CSS class definitions + usage in renders |
| Color scheme | CSS `:root` variables block |
| Icons | Inline emoji or icon usage in renders |
| Print template | `function print*` |
| Modal | `showModalLg(` or `showModal(` calls |
| Dashboard tiles | `function renderDashboard(` or `renderHome(` |
| Department grouping | sidebar nav array structure |
| Field validation | save handler functions (`_save<X>` or `save<X>`) |

### Step 2: Read the legacy HTML

Use the `view` tool to read the specific section. Record:
- Exact line numbers
- Exact text content (verbatim, no paraphrasing)
- Exact CSS classes used
- Exact field names / labels
- Exact button labels
- Exact column headers
- Exact emoji / icons
- Exact order of items
- Exact validation rules

### Step 3: Read the current React implementation

Find the corresponding file in `apps/web/src/`. Record exactly what's there now.

### Step 4: Build the comparison matrix

Create a table with these columns:
- # (sequential)
- Element (what is being compared)
- Legacy HTML value (verbatim from HTML, with line ref)
- Current React value (verbatim from current code)
- Match? (✅ MATCH / ❌ DIFFERS / ⚠️ MISSING IN REACT / ⚠️ EXTRA IN REACT)
- Required action (if differs)

### Step 5: Surface the comparison FIRST

Before making ANY changes, output the comparison to user.

**Always lead with the comparison report. Never silently change things.**

### Step 6: Get user confirmation OR proceed per skill scope

If activated for "verify" / "compare" / "check" / "what does HTML say" verbs:
- Output comparison only
- Do NOT modify code
- Wait for user instruction

If activated for "map" / "build" / "match" / "fix" verbs:
- Output comparison
- Make changes that bring React to match legacy exactly
- Re-run comparison after changes
- Confirm all rows now show ✅ MATCH

### Step 7: Final verification

After any code changes:
- Re-read both legacy + React
- Re-build comparison
- Every row MUST show ✅ MATCH
- If any ❌ remains, explain why (e.g., "blocked by missing backend
  endpoint — file added to LEGACY_AUDIT.md")

## Output format (MANDATORY)

Every invocation outputs in this structure:

```
═══════════════════════════════════════════════════════════════
LEGACY CANONICAL MAPPING REPORT
═══════════════════════════════════════════════════════════════

ELEMENT REQUESTED: <what user asked about>
LEGACY SOURCE: <file path>:<line range>
REACT TARGET: <file path>

───────────────────────────────────────────────────────────────
COMPARISON MATRIX
───────────────────────────────────────────────────────────────

# | Element | Legacy HTML | Current React | Match?
1 | <name> | "<exact>" (L<n>) | "<exact>" | ✅ / ❌ / ⚠️
2 | ...
...

───────────────────────────────────────────────────────────────
SUMMARY
───────────────────────────────────────────────────────────────

Total elements: <N>
Matching: <M>
Differing: <D>
Missing in React: <X>
Extra in React: <Y>

───────────────────────────────────────────────────────────────
ACTIONS TAKEN (if any)
───────────────────────────────────────────────────────────────

<list of changes made, or "None — verification only">

───────────────────────────────────────────────────────────────
REMAINING DIFFERENCES
───────────────────────────────────────────────────────────────

<any rows that still show ❌ or ⚠️, with explanation>

═══════════════════════════════════════════════════════════════
```

## Strict rules — what NEVER to do

### NEVER invent

- If a label in HTML says "JC No." do NOT write "JC Number" or "Job Card Number"
- If HTML uses emoji 🏭 do NOT substitute lucide icons
- If HTML has 9 menu sections do NOT add a 10th
- If HTML doesn't have a feature, do NOT add it
- If HTML has a typo, REPRODUCE the typo (flag it but don't fix)

### NEVER paraphrase

- "Open" stays "Open" — not "Active" or "Pending"
- "Save Item" stays "Save Item" — not "Save" or "Create Item"
- "+ New SO" stays "+ New SO" — not "+ New Sales Order"

### NEVER infer

If HTML says nothing about behavior X, do NOT guess. Output:
> "⚠️ AMBIGUOUS: Legacy HTML does not specify <behavior>. STOPPING.
> Please clarify: <option A> OR <option B>?"

### NEVER batch

If user asks about "all pages", "everything", "all menus" → respond with first
element only, then ask which next.

### NEVER silently fix

If you find a mismatch, REPORT IT FIRST. Only fix after user sees comparison
OR if the original verb was "map" / "match" / "fix" (action verbs).

### NEVER assume completeness

If HTML has more than what's visible at a glance, DIG DEEPER. Examples:
- Sidebar: check both the visible nav AND the JS that builds it
- Modals: check both the form AND its save handler for validation
- Status badge: check both display AND the CSS class that styles it

## Example invocations

### Example 1: "verify sidebar matches HTML"

Response structure:
1. Read `#sidebar` in legacy HTML (find sections + items array)
2. Read `apps/web/src/components/shared/sidebar.tsx`
3. Build comparison: each section, each item, label, icon, order, route
4. Output comparison report
5. Do NOT change anything (verb is "verify")
6. List actions needed for each ❌

### Example 2: "map left menu to legacy"

Response structure:
1. Same as above (read both)
2. Output comparison FIRST
3. Then change sidebar.tsx to match HTML exactly
4. Re-read + re-compare
5. Confirm all rows ✅ MATCH
6. Show final comparison report

### Example 3: "what does HTML say about /items page"

Response structure:
1. Find `renderItems()` in legacy HTML
2. Document atomically:
   - Page title
   - Action buttons (label, color, position)
   - Filter inputs (labels, options)
   - Table columns (headers, in order, data field, alignment)
   - Row actions
   - Empty state text
   - Pagination style
3. Output as atomic list with HTML line references
4. Do NOT touch React code (verb is "what does")

### Example 4: "build items form from HTML"

Response structure:
1. Find item-related form in legacy HTML (`showModal` with item fields)
2. Document every field: name, label, type, required, validation, default
3. Output comparison vs current `ItemForm.tsx`
4. Change form to match exactly
5. Re-verify
6. Report final state

## Field comparison checklist (use for every form)

For each field, capture from legacy:
- [ ] Field name (key)
- [ ] Display label (exact text)
- [ ] Input type (text / select / number / date / textarea / checkbox)
- [ ] Required (yes/no)
- [ ] Placeholder text (if any)
- [ ] Help text (if any)
- [ ] Default value (if any)
- [ ] Options (for selects — exact list in exact order)
- [ ] Validation rules (min/max/regex)
- [ ] Width / size (full / half / 1/3)
- [ ] Order on form (1st, 2nd, etc.)
- [ ] Section grouping (if form has sections)

If any of these is unclear from HTML, STOP and ask user.

## Table column comparison checklist

For each column, capture from legacy:
- [ ] Column header text (exact)
- [ ] Column position (1st, 2nd, etc.)
- [ ] Data field rendered
- [ ] Format (date format, number format, etc.)
- [ ] Alignment (left/center/right)
- [ ] Click action (if any — view/edit/select)
- [ ] Conditional formatting (color coding)
- [ ] Width (if specified)
- [ ] Sortable (yes/no)

## Sidebar / menu comparison checklist

For sidebar verification:
- [ ] Total section count
- [ ] Each section: key, label, icon, color/dept-class
- [ ] Section order
- [ ] Each section's items count
- [ ] Each item: label, icon, route, group (if grouped)
- [ ] Item order within section
- [ ] Active item indicator style
- [ ] User card at bottom (if any)
- [ ] Sidebar width

## Conflict resolution

If legacy HTML has multiple versions of the same element (e.g., function
defined twice, or commented-out variant):

1. STOP
2. Show user all versions found with line numbers
3. Ask: "Which version is authoritative?"
4. Wait for user decision
5. Proceed only after confirmation

If legacy HTML's behavior depends on runtime state (e.g., user role, data
loaded), document all branches:

> "Legacy renders X when condition A, Y when condition B. Current React
> only handles A. Add B handling? [Y/N]"

## What this skill explicitly REJECTS

- "Make it look modern" → REJECTED. Legacy is the spec, not aesthetics.
- "Use better naming" → REJECTED. Legacy names are canonical.
- "Add a search bar" → REJECTED unless HTML has one.
- "Simplify this" → REJECTED. Legacy is canonical.
- "Group these fields" → REJECTED unless HTML groups them.

Response to rejection requests:
> "This skill enforces 1:1 parity with legacy HTML. The request <X> deviates
> from legacy. Would you like to:
> A) Mirror legacy exactly (current scope)
> B) Override legacy per your request (requires confirmation + ADR)
> C) Cancel"

## Definition of done

For verify/compare/check verbs:
- Comparison report output
- Every difference flagged
- No code changes

For map/build/match/fix verbs:
- Comparison report output BEFORE changes
- Changes made
- Comparison report output AFTER changes
- Every row in final report = ✅ MATCH
- If any ❌ remains, explicitly explain why (with ADR if needed)

## Honesty discipline

If the skill cannot perform a check (file missing, ambiguous HTML, etc.),
say so directly. Never fabricate. Never bluff. Never "best guess" without
flagging it as a guess.

Format for uncertainty:
> "⚠️ UNCERTAIN: <what I cannot determine>
> Reason: <why>
> Need from user: <specific question>"
