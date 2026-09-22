# Standing E2E fixture chain — TEST stack only

## Why this file exists

A single verification run in this project once spent **214,000 tokens and 28 minutes**, and
most of it went on building a vendor, a purchase request and a 45-line purchase order through
the UI before a single assertion ran. The testing was the cheap part.

Building the chain through the app's own screens is the right thing to do **once** — that is
what proves the chain works. Doing it again on every run is waste.

So: **build once, reuse, and record it here.**

## Where this applies

**The TEST stack only** — `https://innovic-erp.pages.dev`, config `e2e/testsite.config.ts`,
credentials from `TESTSITE_EMAIL` / `TESTSITE_PASSWORD` in the shell.

That stack has **its own database**, separate from production. That separation is what makes a
persistent fixture safe, and it is why this did not exist before — until the test stack landed
there was one database and it was the live one.

**Never treat production fixtures as persistent.** Against `playwright.pages.config.ts` (the
production site) the old rule stands: smallest chain that proves it, and report the undo.

## The standing chain

Created 2026-09-09 on the test stack. Everything carries the `E2E_` marker in a free-text
field, because document numbers are locked to `IN-XX-#####` and cannot.

| What | Code | Findable by |
|---|---|---|
| Vendor | `VND-959` | name "E2E_ Shreeji Precision Heat Treaters Pvt Ltd" |
| Purchase Request | `IN-PR-00001` | operation "E2E_ HEAT TREATMENT" |
| Purchase Order | `IN-PO-00003` | 45 lines `E2E-PRT-001`…`-045`, header remark "E2E_ print-format check" |
| OSP Delivery Challan | `IN-DC-00002` | transporter "E2E_ Shree Ganesh Roadlines" |

The PO is **type `service`**, deliberately. A *job-work* PO line that is not tied to a job-card
operation is refused by the challan screen — correctly — and satisfying that would mean building
45 job cards with 45 operations. `service` is the other type the system accepts for sending
material out and it prints the identical OSP Delivery Challan.

Line remarks sit on lines **3, 11, 19, 27, 35 and 44**; the other 39 have none. That mix is
deliberate: it exercises both the with-description and without-description row shapes on paper.

## How to use it

1. **Look for it before you build.** Search the vendor by its `E2E_` name; if `VND-959` is
   there, the chain is there.
2. **Reuse read-only wherever you can.** Printing, list filters, search, layout, permissions —
   none of these need fresh data.
3. **Build fresh only when the test mutates state** the chain depends on: receiving against the
   challan, completing operations, cancelling. Then build your own and say so.
4. **Never advance somebody else's chain**, including this one, unless the test is specifically
   about advancing it. A half-received challan makes every later run start from a different
   place, which is worse than no fixture at all.

## When it is gone

The test database can be reset. If the chain is missing, rebuild it through the app's own
screens — the same way the first one was built, not with direct SQL — and **update the table
above with the new codes.** A fixture nobody can find is not a fixture.

## What this does not cover

Sales orders, job cards, operations, QC, GRN. Those still get built per-run. If a second
standing chain earns its place, add it here rather than inventing a private one in a spec.
