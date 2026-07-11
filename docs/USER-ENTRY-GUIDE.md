# Innovic ERP — Beginner Data-Entry Guide

This guide teaches a brand-new user how to enter data, screen by screen.
It follows the natural work order of a job shop:

**Masters → Sales → Planning → Production → Purchase → Store → Quality → Finance.**

Read it top to bottom the first time. Each part starts with one plain line
saying what the part is for. Then each entry screen is shown with **cases** —
Case 1 is the simplest thing you can save, and later cases add more detail.

## How to read a case

- **Required** fields must be filled, or the screen will not save.
- **Optional** fields can be left blank.
- A **picker** is a box where you start typing and choose from a ready-made
  list (the master lists). You cannot type something that is not in the list.
- A **code** (Item Code, SO No., Client Code, etc.) **cannot be changed after
  you save it the first time.** Pick it carefully.
- **Dates** are typed as Year-Month-Day, for example `2026-06-19`.
- **₹** means a rupee amount.
- "**Cascade**" notes tell you what happens in another part of the system when
  you fill a field. This is how one screen feeds the next.

---

# 1. Masters

**What it does:** Holds the basic facts everything else points to — your parts,
customers, suppliers, machines, people, cost groups, and the recipes used to
make a part.

> Do the Masters first. Orders, plans, and job cards can only pick things that
> already exist here.

## 1.1 Items — Add Item

**What it does:** Adds a part or product to the master list of things the
company makes or uses.

Real fields: `code`, `name`, `description`, `drawingNo`, `drawingFilePath`
(drawing file), `revision` (default `A`), `material`, `uom`
(`NOS` / `KGS` / `SET` / `MTR`, default `NOS`), `itemType`
(`component` / `assembly`, default `component`), `hsnCode`.

**Case 1 — Add a simple part.**
The least you can enter to create a part.
1. Item Code: `SHAFT-12`  *(cannot be changed later)*
2. Name: `Shaft 12mm`
3. UOM: leave as `NOS`
4. Save.
- Cascade: this Item Code can now be picked on BOMs, Route Cards, Sales Orders,
  Job Cards, Purchase Orders, and more.

**Case 2 — Add a part with drawing and material.**
A machined part that has a drawing and a metal grade.
1. Item Code: `SHAFT-12`
2. Name: `Shaft 12mm`
3. Drawing No.: `DRG-1001`
4. Drawing file: upload the PDF.
5. Revision: `B`
6. Material: `EN8`
7. UOM: `NOS`
8. Save.

**Case 3 — Add an assembly with a tax code.**
A finished machine that is built from other parts.
1. Item Code: `PUMP-A1`
2. Name: `Pump Assembly A1`
3. Item Type: change to `assembly`
4. HSN Code: `8413`
5. UOM: `NOS`
6. Save.
- Note: an `assembly` item is usually the parent on a BOM (see 1.8).

## 1.2 Clients — Add Client

**What it does:** Records a customer the company sells to.

Real fields: `code`, `name`, `addressLine1`, `contactPerson`, `email`,
`phone`, `gstNumber`, `city`, `state`, `pincode`, `isActive`
(`Active` / `Inactive`, default `Active`).

**Case 1 — Add a customer by name.**
1. Client Code: `ACME`  *(cannot be changed later)*
2. Name: `Acme Industries`
3. Save.
- Cascade: this client can now be picked on Sales Orders and Job Work Orders.

**Case 2 — Add a customer with full billing details.**
1. Client Code: `ACME`
2. Name: `Acme Industries`
3. Contact Person: `R. Sharma`
4. Email: `accounts@acme.com`
5. Phone: `9820011111`
6. GST Number: `27ABCDE1234F1Z5`
7. Address / City / State / Pincode: `Plot 5, MIDC` / `Pune` / `Maharashtra` / `411019`
8. Save.

**Case 3 — Stop using an old customer.**
1. Open the client.
2. Status: change to `Inactive`.
3. Save. (They stay on old orders but no longer appear as a fresh choice.)

## 1.3 Vendors — Add Vendor

**What it does:** Records a supplier the company buys material or outside work
from.

Real fields: `code`, `name`, `contactPerson`, `email`, `phone`, `gstNumber`,
`rating`, `isActive` (`Active` / `Inactive`, default `Active`),
`materialsSupplied`, `addressLine1`, `city`, `state`, `pincode`.

**Case 1 — Add a supplier by name.**
1. Vendor Code: `STEELCO`  *(cannot be changed later)*
2. Name: `Steel Co Pvt Ltd`
3. Save.
- Cascade: this vendor can now be picked on Purchase Orders and on Route Card
  outsource (OSP) steps.

**Case 2 — Add a rated supplier with what they supply.**
1. Vendor Code: `STEELCO`
2. Name: `Steel Co Pvt Ltd`
3. Contact Person / Phone: `S. Patil` / `9820022222`
4. GST Number: `27XYZAB6789K1Z3`
5. Rating: `A`
6. Materials Supplied: `EN8, EN24, SS304 bar`
7. Save.

## 1.4 Machines — Add Machine

**What it does:** Records a machine on the shop floor and how much it costs to
run per hour.

Real fields: `code` (Machine ID), `name`, `machineType`, `capacityPerShift`
(hours), `shiftsPerDay` (default `1`), `status`
(`Idle` / `Running` / `Down` / `Maintenance`, default `Idle`), `hourRate`
(Machine Rate, ₹/hr).

**Case 1 — Add a machine.**
1. Machine ID: `CNC-01`  *(cannot be changed later)*
2. Name: `CNC Lathe 1`
3. Save.
- Cascade: this Machine ID can now be picked on Route Card and Job Card steps.

**Case 2 — Add a machine with a running rate.**
1. Machine ID: `CNC-01`
2. Name: `CNC Lathe 1`
3. Machine Type: `CNC Lathe`
4. Machine Rate: `500` (₹ per hour)
5. Save.
- Cascade: the Machine Rate is used by SO Costing to value machine time.

**Case 3 — Add a machine with capacity and shifts.**
1. Machine ID / Name / Type: as above.
2. Capacity per Shift: `8` (hours)
3. Shifts per Day: `2`
4. Status: `Idle`
5. Machine Rate: `500`
6. Save.

## 1.5 Operators — Add Operator

**What it does:** Records a shop-floor worker, and can link them to a login.

Real fields: `code` (Operator ID), `name`, `department`, `isActive`
(`Active` / `Inactive`, default `Active`), `skills`, `userId` (Linked User).

**Case 1 — Add a worker.**
1. Operator ID: `OP-01`  *(cannot be changed later)*
2. Name: `Sunil More`
3. Save.
- Cascade: this Operator can now be named when logging work on Job Cards.

**Case 2 — Add a worker with department and skills.**
1. Operator ID: `OP-01`
2. Name: `Sunil More`
3. Department: `CNC Turning`
4. Skills: `CNC-01, CNC-02`
5. Save.

**Case 3 — Link the worker to a login.**
1. Fill the fields as above.
2. Linked User: paste the user account ID (a long code) so this worker can log in.
3. Save. (Leave blank for shop-floor-only workers.)

## 1.6 Cost Centers — Add Cost Center

**What it does:** Records a department or area used to group and track costs.

Real fields: `code`, `name`, `isActive` (`Active` / `Inactive`),
`department` (`Production` / `QC` / `Maintenance` / `Store` / `Admin` /
`Design` / `Purchase` / `Sales` / `Other`, default `Production`), `type`
(`Manufacturing` / `Overhead` / `Service`, default `Manufacturing`),
`description`.

**Case 1 — Add a cost center.**
1. Code: `CC-PROD`  *(cannot be changed later)*
2. Name: `Production Floor`
3. Save.

**Case 2 — Add a classified cost center.**
1. Code: `CC-QC`
2. Name: `Quality Lab`
3. Department: `QC`
4. Type: `Overhead`
5. Description: `Inspection and testing area`
6. Save.

## 1.7 Route Cards — Create Route Card

**What it does:** Defines the step-by-step sequence of operations needed to make
one item.

Header fields: `code` (RC No., auto-made if blank), `itemId` (Item Code picker,
required), `notes`.
Each operation row: `opType` (`process` / `qc` / `outsource`, default
`process`), `machineId` (Machine picker, for process steps), `ospVendorId`
(Vendor picker, for outsource steps), `operation`, `cycleTimeMin` (shown as
hours), `program`, `ospLeadDays`, `toolNo`, `toolDetails`.

**Case 1 — One-step route.**
The simplest recipe: a single machining step.
1. Item Code: pick `SHAFT-12`.  *(comes from the Item master)*
2. Click **Add Op**. On the row:
   - Type: `process`
   - Machine: pick `CNC-01`  *(comes from the Machine master)*
   - Operation: `Turning`
3. Save (RC No. fills in by itself).

**Case 2 — Machining then inspection.**
Add a quality check after the machining step.
1. Item Code: `SHAFT-12`.
2. **Add Op** → Type `process`, Machine `CNC-01`, Operation `Turning`, Cycle `0.5` hrs.
3. **QC Step** → Operation `Final Dimensional Check` (no machine needed).
4. Save.

**Case 3 — Add an outside-process step.**
A step that is sent to an outside vendor (for example, plating).
1. Item Code: `SHAFT-12`.
2. **Add Op** (process) → `CNC-01`, `Turning`.
3. **OSP Step** → Vendor: pick `PLATERS`  *(comes from the Vendor master)*,
   Operation `Hard Chrome Plating`, Lead `5` days.
4. **QC Step** → `Final Check`.
5. Save.

## 1.8 BOM Master — Create BOM

**What it does:** Lists all the child parts and quantities that go into making
one assembly.

Header fields: `bomNo` (auto-made if blank), `bomName` (required), `status`
(`draft` / `active` / `obsolete`, default `draft`).
Each part row: `childItemId` (Item Code picker, required), `qtyPerSet`
(default `1`), `bomType` (`manufacture` / `purchase` / `outsource`, default
`manufacture`).

**Case 1 — A two-part BOM (draft).**
1. BOM Name: `Pump Assembly A1 BOM`
2. Add a part row → Item Code `SHAFT-12`, Qty/Set `1`, Type `manufacture`.
3. Add a part row → Item Code `SEAL-9`, Qty/Set `2`, Type `purchase`.
4. Leave Status as `draft`. Save.

**Case 2 — Make the BOM usable.**
A BOM must be `active` before an Equipment Sales Order can use it.
1. Open the BOM.
2. Status: change to `active`.
3. Save.
- Cascade: only `active` BOMs can be linked from an Equipment Sales Order (2.1, Case 3).

**Case 3 — BOM with a make, a buy, and an outside part.**
1. BOM Name: `Pump Assembly A1 BOM`
2. Row 1 → `SHAFT-12`, Qty/Set `1`, Type `manufacture`.
3. Row 2 → `SEAL-9`, Qty/Set `2`, Type `purchase`.
4. Row 3 → `HOUSING-7`, Qty/Set `1`, Type `outsource`.
5. Status `active`. Save.
- Cascade: at order time, `manufacture` parts become child Job Cards,
  `purchase` parts become buy requests, and `outsource` parts become
  outside-work requests.

---

# 2. Sales

**What it does:** Sales Orders record what a customer ordered — the parts or the
equipment, how many, and the price.

## 2.1 Sales Order — Create SO

**What it does:** Raises a new customer order.

Header fields: `code` (SO/WO No., auto-suggested like `IN-SO-00001`),
`soDate` (default today), `type` (`component_manufacturing` / `equipment`,
default `component_manufacturing`), `status`
(`open` / `closed` / `dispatched` / `cancelled`, default `open`), `gstPercent`
(`0` / `5` / `12` / `18` / `28`, default `18`), `costCenter`, `clientId`
(Client picker, **required**), `clientPoNo`, `remarks`.

Component line fields: `itemCodeText` (Item Code picker), `partName`
(required), `material`, `drawingNo`, `uom` (default `NOS`), `orderQty`
(required, min 1), `rate`, `dueDate`, `clientPoLineNo`.

**Case 1 — Order for one part.**
The simplest sales order.
1. SO No.: keep the suggested `IN-SO-00001`.
2. Date: today.
3. Type: `component_manufacturing`.
4. Client: pick `Acme Industries`.  *(comes from the Client master; required)*
5. In the line table, add one line:
   - Item Code: `SHAFT-12`  *(comes from the Item master)*
   - Part Name: `Shaft 12mm`
   - Qty: `100`
6. Save.
- Cascade: each line's Qty is the source amount that Planning and Production
  work against.

**Case 2 — Order for several parts, with PO and delivery dates.**
1. Fill header as Case 1, plus Client PO No.: `PO-9001`, GST %: `18`.
2. Line 1 → Item `SHAFT-12`, Part `Shaft 12mm`, Qty `100`, Rate `250`, Due `2026-07-10`.
3. Line 2 → Item `SLEEVE-4`, Part `Sleeve 4`, Qty `50`, Rate `120`, Due `2026-07-15`.
4. (Optional) Add a Delivery Schedule row: Lot `1`, Qty `40`, Due `2026-07-05`.
5. Save.

**Case 3 — Equipment order linked to a BOM.**
Used when you sell a whole machine, not loose parts.
1. SO No., Date, Client: as before.
2. Type: change to `equipment`. The form now shows **Equipment Details**.
3. Equipment / Part No.: `PUMP-A1`  *(comes from the Item master)*
4. Description: `Pump Assembly A1`
5. Order Qty: `2`
6. SO Value ₹ / unit: `85000`
7. BOM: pick `Pump Assembly A1 BOM`.  *(comes from the BOM master; only active BOMs show)*
8. Save.
- Cascade: linking a BOM lets Planning explode the equipment into its child
  parts (see 3.3).

## 2.2 Sales Order — Edit SO

**What it does:** Changes an existing order after it was first raised.

**Case 1 — Change a quantity.**
1. Open the SO and click Edit.
2. The SO No. is shown but cannot be changed.
3. Change a line's Qty from `100` to `120`.
4. Save.

**Case 2 — Add a line to an existing order.**
1. Edit the SO.
2. Add a new line → Item `WASHER-2`, Part `Washer`, Qty `200`.
3. Save. (New lines are added, changed lines are updated, removed lines are
   dropped.)

## 2.3 SO Documents — Upload Document

**What it does:** Attaches files (drawings, certificates, reports) to a sales
order.

Fields: `lineKey` (whole SO, or one SO line), `category`
(`drawing` / `qc-docs` / `inspection` / `tpi` / `incoming-qc` / `po-docs` /
`client_po` / `design` / `dispatch` / `other`, default `other`), `docType`,
`files` (required).

**Case 1 — Attach a drawing to the whole order.**
1. Pick the Sales Order from the dropdown.
2. Click **Upload Document**.
3. SO Line: leave as `SO Level (no specific line)`.
4. Category: `drawing`.
5. Files: choose the PDF. Upload.

**Case 2 — Attach an inspection report to one line.**
1. Pick the SO and click **Upload Document**.
2. SO Line: choose `Line 1: SHAFT-12 — Shaft 12mm`.
3. Category: `inspection`.
4. Document Type: `Inspection Report`.
5. Files: choose the file. Upload.

---

# 3. Planning

**What it does:** Decides how each ordered part will be made, bought, or sent
out — and breaks an equipment order into its parts.

## 3.1 Plans — New Plan

**What it does:** Creates a production plan that says how much of a part to make,
buy, or outsource, and lists the work steps.

Header fields: `code` (auto `PLN-…` if blank), `planDate` (default today),
`planType` (`manufacture` / `direct_purchase` / `full_outsource` / `assembly`,
default `manufacture`, **locked after saving**), `itemCodeText` (Item picker,
required), `orderQty`, `planQty` (required), `soLineId` (Sales Order line link),
`plannedStartDate`, `plannedEndDate`, `remarks`.
Operation rows (for `manufacture` / `assembly`): `opSeq`, `operation`,
`opType` (`process` / `outsource` / `qc`), `machineCodeText`, `cycleTimeMin`,
`qcRequired`, `outsourceVendorText`, `outsourceCost`, `outsourceLeadDays`.

**Case 1 — Plan to make a part, one step.**
1. Plan Type: `manufacture`.  *(cannot be changed after saving)*
2. Item Code: `SHAFT-12`.  *(comes from the Item master)*
3. Order Qty: `100`. Plan Qty: `100`.
4. Add one operation → Seq `1`, Operation `Turning`, Type `process`, Machine `CNC-01`.
5. Save.
- Cascade: running a `manufacture` or `assembly` plan creates a Job Card in
  Production.

**Case 2 — Plan to make a part using its route card.**
1. Plan Type `manufacture`, Item `SHAFT-12`, Plan Qty `100`.
2. Click **Load route card** to fill in the saved steps for that item.
3. Adjust steps if needed. Save.

**Case 3 — Plan to buy a part instead of making it.**
1. Plan Type: `direct_purchase`. The form shows the purchase block.
2. Item Code: `SEAL-9`. Plan Qty: `200`.
3. Vendor Code: `STEELCO`.  *(comes from the Vendor master)*
4. Unit Cost: `40`.
5. Save.
- Cascade: a `direct_purchase` or `full_outsource` plan creates a Purchase
  Request (see Purchase).

## 3.2 SO Planning — Create Plan from a SO line

**What it does:** From a sales-order line, quickly start a plan for some of the
remaining quantity.

**Case 1 — Plan the whole remaining quantity.**
1. Open the Sales Order line.
2. Plan Qty: it is pre-filled with the remaining amount (for example `100`).
   You can lower it but not raise it above the remaining.
3. Save. It opens the full plan screen so you can add steps.
- Note: item, order qty, and the SO link are filled in for you; type is fixed
  to `manufacture`.

## 3.3 SO Planning — BOM Planning (for equipment orders)

**What it does:** Breaks an equipment order's BOM into its child parts and lets
you plan each one.

Each child row: `Plan?` (tick to plan it), `qty` (how many to plan),
`Final Assembly Job Card` (tick to also plan the final build).

**Case 1 — Plan the short parts.**
1. Open BOM Planning for the equipment SO line.
2. The screen lists every child part with its need, stock, and shortfall.
3. For each part you want, tick **Plan?** and check the suggested Qty.
4. (Optional) Tick **Final Assembly Job Card** to also plan the final build.
5. Save.
- Cascade: each ticked part becomes its own plan — `purchase` parts become buy
  requests, the rest become make plans. The numbers come from the BOM master.

## 3.4 Production Schedule — Reschedule an operation

**What it does:** Drag a job's operation bar to a different machine and day.

**Case 1 — Move a job to another machine.**
1. Find the operation bar on the chart.
2. Drag it onto a different machine row and drop it on the day you want.
3. It saves the new machine and start date by itself.
- Note: there is nothing to type here. Only managers and admins can drag; others
  see a read-only chart. Machine Loading is a view-only screen with no entry.

---

# 4. Production

**What it does:** Runs the work on the shop floor — job orders, job cards, the
operations on them, and logging how many pieces get done.

## 4.1 Job Work Order — New JWSO

**What it does:** Records an order where a client sends material for the shop to
process into finished parts.

Header fields: `code` (JWSO No., auto `IN-JW-…`), `jwDate` (default today),
`status` (`open` / `closed` / `dispatched` / `cancelled`, default `open`),
`clientId` (Client picker, required), `clientPoNo`, `remarks`,
`clientMaterial` (raw-material item picker), `clientMaterialQty`,
`materialReceivedDate`, `materialReceivedQty`.
Line fields: `itemCodeText` (Item picker), `partName` (required), `material`,
`drawingNo`, `uom` (default `NOS`), `orderQty` (required), `rate` (processing
charge per unit), `dueDate`.

**Case 1 — Basic job-work order.**
1. JWSO No.: keep the suggested number.
2. Client: pick `Acme Industries`.  *(comes from the Client master; required)*
3. Add a line → Item `SHAFT-12`, Part `Shaft 12mm`, Qty `100`, Rate `60`.
4. Save.
- Cascade: each line's Qty is the balance that Job Cards are raised against.

**Case 2 — Record the client's supplied material.**
1. Fill header and line as Case 1.
2. Client Material: pick the raw-material item the client sent.
3. Material Qty (Client Supplied): `500`.
4. Material Received Date: today. Received Qty: `500`.
5. Save.

## 4.2 Job Card — New Job Card

**What it does:** Creates a shop-floor batch for one item and quantity, with its
sequence of steps.

Header fields: `jcDate` (default today), `priority` (`normal` / `high`, default
`normal`), source line (JWSO No. picker, required), `itemCode` (Item picker,
required), `orderQty` (required), `dueDate`, drawing upload.
Operation rows: `machineCode` (Machine picker, for process), `operation`,
`cycleTimeMin`, `program`, `toolDetails`, `qcRequired`, `opType`
(`process` / `qc` / `outsource`), `outsourceVendorCode` (Vendor picker, for
outsource), `outsourceCost`.

**Case 1 — Job card with two machining steps.**
1. Date: today. Priority: `normal`.
2. JWSO No.: pick the open job-work line.  *(comes from the Job Work Order; fills item, qty, due)*
3. Item Code: `SHAFT-12` (filled in for you).
4. Order Qty: `100`.
5. Add operations:
   - Machine `CNC-01`, Operation `Turning`.
   - Machine `VMC-01`, Operation `Milling`.
6. Save. (The JC number is made automatically and cannot be changed.)

**Case 2 — Add a quality step and a drawing.**
1. Fill as Case 1.
2. Click **+ Add QC Op** → Operation `Final Dimensional Check`.
3. Drawing: upload the part drawing.
4. Save.

**Case 3 — Add an outside-process step.**
1. Fill the machining steps.
2. On a step, tick **OUTSOURCE** → Vendor: pick `PLATERS`  *(comes from the Vendor master)*,
   ₹ Cost/pc `15`.
3. Save.
- Cascade: outsource steps feed the Outsource (OSP) flow when work starts.

## 4.3 Op Entry — Log completion

**What it does:** Records how many pieces an operator finished on one step.

Fields: `logDate` (default today), `shift` (`day` / `night` / `general`,
default `day`), `qty` (required), `rejectQty` (default `0`), `operatorName`
(Operator), `remarks`.

**Case 1 — Log finished pieces.**
1. Open the operation on the job card.
2. Date: today. Shift: `day`.
3. Qty done: `50`.
4. Save.
- Cascade: the finished quantity becomes the amount available for the next step,
  and updates the job card's progress.

**Case 2 — Log with rejects and operator.**
1. Date / Shift as above.
2. Qty done: `48`. Reject qty: `2`.
3. Operator: `Sunil More`.  *(comes from the Operator master)*
4. Remarks: `2 pcs undersize`.
5. Save.

## 4.4 Op Entry — QC Inspection

**What it does:** Records how many finished pieces passed or failed inspection on
a step that needs QC.

Fields: `logDate`, `shift` (`day` / `night` / `general`), `qty` (accepted),
`rejectQty`, `operatorName` (inspector), `remarks`, QC report attachment.

**Case 1 — Accept all pieces.**
1. Date: today. Accepted qty: `50`. Reject qty: `0`.
2. Save.
- Cascade: accepting clears the QC pending count and moves the job toward
  complete.

**Case 2 — Accept some, reject some, attach the report.**
1. Accepted qty: `47`. Reject qty: `3`.
2. Inspector: `Sunil More`.
3. QC report: upload the inspection PDF.
4. Save. (Accepted + Reject cannot be more than the pending quantity.)

## 4.5 JW Delivery Challan — New Outward DC

**What it does:** Records material sent out to a job-work vendor against a
job-work purchase order.

Fields: `dcDate` (default today), `purchaseOrderId` (job-work PO picker,
required), `vehicleNo`, `remarks`. Line: tick the line, `sentQty`.

**Case 1 — Send material out.**
1. Date: today.
2. JWPO: pick the job-work purchase order.  *(comes from the Purchase Order master; loads its lines and vendor)*
3. In the line list, keep the line ticked and set Qty to Send: `100`.
4. Save. (The DC number is made automatically.)
- Cascade: the sent quantity becomes the amount tracked as "pending return".

## 4.6 JW Delivery Challan — New Inward Entry

**What it does:** Records processed material coming back from the vendor against
an outward challan.

Fields: `inwardDate` (default today), `jwDcOutwardId` (outward DC picker,
required), `vendorChallanNo`, `vehicleNo`, `remarks`. Lines: `receivedQty`,
`okQty`, `rejectedQty`.

**Case 1 — Receive returned material.**
1. Date: today.
2. JW DC: pick the outward challan that has pending returns.
3. On the line: Received `100`, OK `98`, Rejected `2`.
   (OK + Rejected must equal Received.)
4. Save.

## 4.7 Outsource Jobs — Create a Job-Work PO from requests

**What it does:** Groups one or more auto-made outsource requests into a single
job-work purchase order to one vendor.

Fields: tick the requests, `poCode`, `poDate` (default today), `vendorId`
(Vendor picker, required). Line: `rate`.

**Case 1 — Turn outsource requests into one PO.**
1. Tick the outsource requests you want to combine.  *(these come from outsource job-card steps)*
2. PO No.: `IN-JWPO-00001`.
3. Vendor: pick `PLATERS` (often suggested from the first request).
4. Set Rate ₹/pc on each line, for example `15`.
5. Save.

---

# 5. Purchase

**What it does:** Asks for and orders materials and services from suppliers.

## 5.1 Purchase Request — New PR

**What it does:** Records a request to buy an item so it can later become a
purchase order.

Fields: `code` (required), `prDate` (default today), `status`
(`open` / `approved` / `po_created` / `cancelled`, default `open`), `vendorId`
(Vendor picker) **or** `vendorCodeText` (typed), `requiredDate`, `itemCodeText`
(Item picker), `itemName`, `operation`, `qty` (required, min 1), `estCost`,
`remarks`.

**Case 1 — Request one item.**
1. PR No.: `PR-0001`.
2. Date: today.
3. Item Code: `SEAL-9`.  *(comes from the Item master)*
4. Qty: `200`.
5. Save.

**Case 2 — Request with a chosen vendor and cost.**
1. Fill as Case 1.
2. Vendor: pick `STEELCO`.  *(comes from the Vendor master)*
3. Required Date: `2026-07-01`. Est. Cost: `40`.
4. Save.
- Cascade: when this PR becomes a PO, the Est. Cost is used as the line rate.

## 5.2 Purchase Order — New PO

**What it does:** Records an order placed with a supplier for one or more items.

Header fields: `code` (required), `poDate` (default today), `poType`
(`standard` / `job_work` / `outsource` / `service`, default `standard`),
`status` (`draft` / `open` / `partial` / `qc_pending` / `closed` / `cancelled`,
default `draft`), `dueDate`, `prCodeText`, `vendorId` (Vendor picker) **or**
`vendorCodeText`, `taxType` (`sgst_cgst` / `igst` / `none`), `sgstPct`,
`cgstPct`, `igstPct`, `remarks`.
Line fields: `itemCodeText` (Item picker), `itemName` (required), `qty`
(required, min 1), `rate`, `dueDate`, `lineRemarks`.

**Case 1 — Simple order to a supplier.**
1. PO No.: `IN-PO-00001`. Date: today.
2. Vendor: pick `STEELCO`.  *(comes from the Vendor master)*
3. Add a line → Item `SEAL-9`, Item Name `Seal 9mm`, Qty `200`, Rate `40`.
4. Save.
- Cascade: this PO is what the Store receives against later (GRN).

**Case 2 — Order with GST split and two lines.**
1. Header as Case 1, plus Tax Type `sgst_cgst`, SGST `9`, CGST `9`.
2. Line 1 → `SEAL-9`, Qty `200`, Rate `40`.
3. Line 2 → `WASHER-2`, Qty `500`, Rate `5`.
4. Save.

**Case 3 — Job-work purchase order.**
1. PO No., Date, Vendor as before.
2. PO Type: `job_work`.
3. Add the line(s) for the outside work. Save.
- Cascade: a job-work PO is what an outward Delivery Challan ships against.

## 5.3 Purchase Order — Create PO from a PR

**What it does:** Turns an existing approved purchase request into a supplier
order in one step.

Fields: `code` (required), `poDate` (default today), `poType` (default
`job_work`), `dueDate`, tax fields, `remarks`. (The item, vendor, qty, and cost
come from the request — you do not retype them.)

**Case 1 — One-click PO from a request.**
1. Open the approved PR and choose **Create PO**.
2. PO No.: `IN-PO-00002`. Date: today.
3. (The PR's vendor, item, qty, and cost are shown read-only at the top.)
4. Save. The request is marked as `po_created`.

## 5.4 Service PO — New Service PO

**What it does:** Records a purchase of a service (labour, transport,
calibration), with no stock item involved.

Header fields: `spoNo` (required), `spoDate` (default today), `vendorId`
(Vendor picker, required), `expenseHead` (`Transport` / `Calibration` /
`Testing` / `Labour` / `AMC` / `Inspection` / `Machining` / `Consultancy` /
`Other`), `costCenter` (`so` = Against SO / `general` = General Expense),
`soRefId` (Sales Order picker, only when Against SO), `taxType`
(`sgst_cgst` / `igst`), `gstPct` (default `18`), `paymentTerms` (`Immediate` /
`15 days` / `30 days` / `45 days` / `60 days`), `remarks`.
Line fields: `description` (required), `qty` (default `1`), `rate`.

**Case 1 — Pay for a general service.**
1. Service PO No.: `SPO-00001`. Date: today.
2. Vendor: pick `CALIBLAB`.  *(comes from the Vendor master; required)*
3. Expense Head: `Calibration`. Cost Center: `General Expense`.
4. Add a line → Description `Gauge calibration`, Qty `1`, Rate `2500`.
5. Click **Save & Submit for Approval** (or **Save Draft**).

**Case 2 — A service charged against a sales order.**
1. Fill as Case 1, but Cost Center: `Against SO`.
2. SO Reference: pick the Sales Order.  *(comes from the Sales Order master)*
3. Save.
- Note: only managers and admins can open this screen. Totals are worked out for
  you. Service POs do not affect stock.

---

# 6. Store

**What it does:** Records material coming in, going out, and what is in stock.

## 6.1 Goods Receipt Note (GRN) — New GRN

**What it does:** Records the goods a vendor delivered against a purchase order,
with a quality check on each item.

Header fields: `code` (GRN No., required), `grnDate` (default today),
`purchaseOrderId` (PO picker), `poCodeText`, `vendorId` (Vendor picker) **or**
`vendorCodeText`, `dcNo`, `invoiceNo`, `remarks`.
Line fields: `itemCodeText`, `itemName` (required), `receivedQty` (required),
`dcRefNo`, `qcStatus` (`pending` / `in_progress` / `completed`, default
`pending`), `qcAcceptedQty`, `qcRejectedQty`, `qcDate`, `qcRemarks`, QC report.

**Case 1 — Receive against a PO, check later.**
1. GRN No.: `GRN-00001`. Date: today.
2. Purchase Order: pick the PO.  *(comes from the Purchase Order master; fills the vendor and the lines)*
3. On the line, set Received: `200`.
4. Leave QC Status as `pending`.
5. Save.
- Cascade: Received quantity updates the PO's received total and its status.

**Case 2 — Receive and pass quality the same time.**
1. Fill header and Received as Case 1.
2. QC Status: `completed`. QC Accepted: `200`. QC Rejected: `0`. QC Date: today.
3. Save.
- Cascade: when QC is `completed` with accepted pieces, that quantity is added
  to store stock (a stock-in entry). Once a line's QC is completed, it locks.

**Case 3 — Partial accept with rejects and a report.**
1. Received: `200`.
2. QC Status: `completed`. QC Accepted: `190`. QC Rejected: `10`.
3. QC Report: upload the inspection file. QC Remarks: `10 pcs rust`.
4. Save. (Accepted + Rejected cannot be more than Received.)

## 6.2 Store Issue — New Item Issue

**What it does:** Records consumable material taken out of the store, and who got
it.

Fields: `issueDate` (default today), `qty` (required), `itemId` (Item picker,
required), `issuedTo` (required), `refType` (`Job Card` / `SO` / `Production` /
`Maintenance` / `Other`, default `Job Card`), `refNo`, `purpose`, `remarks`.

**Case 1 — Issue material to a job.**
1. Date: today.
2. Item: pick `BAR-EN8`.  *(comes from the Item master)*
3. Qty to Issue: `20`.
4. Issued To: `Sunil More`.
5. Reference Type: `Job Card`. Reference No.: `JC-00001`.
6. Save.
- Cascade: the issued quantity is taken out of stock straight away. You cannot
  issue more than the stock on hand.

## 6.3 Tool Issue — Issue Tool

**What it does:** Records a returnable tool given out, with an expected return
date.

Fields: `issueDate` (default today), `expectedReturnDate` (required), `itemId`
(Item picker, required), `qty` (required), `issuedTo` (required), `refType`
(same list as above), `refNo`, `purpose`, `remarks`.

**Case 1 — Give out a tool.**
1. Date: today. Expected Return: `2026-06-26`.
2. Tool / Item: pick `GAUGE-12`.  *(comes from the Item master)*
3. Qty: `1`. Issued To: `Sunil More`.
4. Save.
- Cascade: the tool quantity is taken out of stock until it is returned.

## 6.4 Tool Issue — Record Return

**What it does:** Records how much of an issued tool came back good, damaged, or
used up.

Fields: `returnDate` (default today), `returnedBy`, `goodQty`, `damagedQty`,
`consumedQty`, `remarks`.

**Case 1 — Tool returned in good shape.**
1. Click **Return** on the issued row.
2. Return Date: today.
3. Returned Good: `1`.
4. Save.
- Cascade: only the good quantity goes back into stock.

## 6.5 Party Material Master — Add Party Material

**What it does:** Sets up a catalogue entry for a raw material that a client
supplies for job work.

Fields: `code` (auto `PM-…`), `uom` (`NOS` / `KG` / `MTR` / `SET` / `LOT`,
default `NOS`), `itemId` (Item picker, optional), `name` (required),
`description`, `material`, `clientId` (Client picker, required).

**Case 1 — Add a client-supplied material.**
1. Material Code: keep the auto code `PM-0001`.
2. Name: `Forged Blank 50mm`.
3. Client: pick `Acme Industries`.  *(comes from the Client master; required)*
4. UOM: `NOS`.
5. Save.
- Note: these belong to the client, separate from the company Item master.

## 6.6 Party Material GRN — New Party GRN

**What it does:** Records client-supplied raw material received against a
job-work order.

Header fields: `code` (auto `PGRN-…`), `grnDate` (default today),
`jobWorkOrderId` (JWSO picker, required), `dcNo`, `remarks`.
Line fields: `jwLineNoText`, `partyMaterialId` (Party Material picker,
required), `receivedQty` (required).

**Case 1 — Receive client material.**
1. Date: today.
2. JWSO No.: pick the open job-work order.  *(comes from the Job Work Order master; shows the client read-only)*
3. Add a line → Material: pick `Forged Blank 50mm`, Qty `500`.
4. Save.
- Cascade: this adds to the party material's stock (not company item stock). The
  material must already exist in the Party Material master.

## 6.7 Delivery Challan — New Delivery Challan

**What it does:** Creates a dispatch document sending material out to a vendor
against a job-work purchase order.

Fields: `code` (required), `dcDate` (default today), `transport`. Line:
`shipQty`, `materialText`, `dcRemarks`.

**Case 1 — Send material on a challan.**
1. Open it from a job-work PO (use the **New DC** button on the PO).
2. DC code: `DC-00001`. Date: today.
3. On a line, set Ship qty: `100` (cannot exceed the PO line quantity).
4. Save.
- Cascade: the shipped quantity is taken out of stock and flips any linked
  outside-work step to "sent".

## 6.8 Delivery Challan — Receive

**What it does:** Records material coming back from the vendor against a
challan, split into received-good and rejected.

Fields: `receiptDate` (default today), `vendorInvoiceText`, `remarks`. Lines:
`receivedQty`, `rejectedQty`, `rejectReason`.

**Case 1 — Receive back good and rejected pieces.**
1. Open the challan and click **Receive**.
2. Receipt Date: today.
3. On the line: Receive now `98`, Reject now `2`, Reject reason `surface marks`.
4. Save.
- Cascade: the received-good quantity goes back into stock; the rejected
  quantity automatically creates a non-conformance (NC) in Quality.

---

# 7. Quality

**What it does:** Checks parts, records defects, and tracks the fixes.

## 7.1 QC Process Master — Add QC Process

**What it does:** Defines a named quality check (like a dimensional check) that
can later be picked on route cards and job cards.

Fields: `code` (QC Process Name, required), `description`,
`defaultCycleTimeMin`, `isActive` (`Active` / `Inactive`, default `Active`).

**Case 1 — Add a check.**
1. QC Process Name: `Final Dimensional Check`.  *(cannot be changed later)*
2. Save.
- Cascade: this name appears in the QC-step dropdowns on Route Cards and Job
  Cards.

## 7.2 NC Register — Report NC

**What it does:** Logs a quality defect found against a job card so it can be
tracked and fixed.

Fields: `code` (NC No., auto-suggested), `ncDate` (default today),
`reportedByText`, `jobCardId` (Job Card picker, required), `itemId` (Item
picker, required), `soCodeText`, operation, `operatorText`, `machineCodeText`,
`rejectedQty` (required), `reasonCategory` (`dimensional` / `surface` /
`material` / `process` / `operator_error` / `machine_fault` / `other`, default
`other`), `reason` (required).

**Case 1 — Report a defect.**
1. NC No.: keep the suggested `NC-0001`. Date: today.
2. Job Card: pick `JC-00001`.  *(comes from the Job Card list; fills the item and its operations)*
3. Item: `SHAFT-12` (filled in for you).
4. Rejected Qty: `3`.
5. Problem description: `Outer diameter undersize by 0.05mm`.
6. Save.

**Case 2 — Report with a reason category and details.**
1. Fill as Case 1.
2. Reason Category: `dimensional`.
3. Operation: pick the step. Operator: `Sunil More`. Machine: `CNC-01`.
4. Save.
- Cascade: this NC number can be picked later when opening a CAPA.

## 7.3 CAPA — New CAPA

**What it does:** Opens a corrective/preventive action to fix the root cause of a
problem, often linked to an NC.

Fields: `type` (`Corrective` / `Preventive`, default `Corrective`), `capaDate`
(default today), `ncRef` (NC picker), `jcNo`, `department` (`Production` / `QC`
/ `Store` / `Purchase` / `Design`, default `QC`), `problem` (required).

**Case 1 — Open a CAPA from an NC.**
1. Type: `Corrective`. Date: today.
2. NC Reference: pick `NC-0001`.  *(comes from the NC Register; fills the JC, SO, item, and operation)*
3. Problem Description: check the filled-in text or add to it.
4. Save.

## 7.4 CAPA — Edit (5 steps)

**What it does:** Works the CAPA through its five stages — problem, root cause,
corrective action, verification, and prevention/closure.

Key fields: `rootCauseMethod` (`5-Why` / `Fishbone` / `Other`), `rootCause`,
`correctiveAction`, `responsible`, `targetDate`, `verification`, `verifiedBy`,
`verifiedDate`, `preventiveAction`, `effectiveness` (`Effective` /
`Not Effective` / `Monitoring`), `reviewDate`, `status` (`Open` /
`In Progress` / `Verified` / `Closed`).

**Case 1 — Fill the root cause and action.**
1. Step 2 Method: `5-Why`. Root cause: `Tool wear not checked`.
2. Step 3 Corrective Action: `Add tool-wear check every 50 pcs`.
   Responsible: pick the person. Target Date: `2026-07-01`.
3. Save.

**Case 2 — Verify and close.**
1. Step 4 Verification: `Checked next 3 lots — within tolerance`. Verified By:
   `QC Head`. Verified Date: today.
2. Step 5 Effectiveness: `Effective`. Status: `Closed`.
3. Save.

## 7.5 QC Call Register — Submit QC

**What it does:** Accepts or rejects produced quantity for a job-card step that
was called for inspection.

Fields: `logDate` (default today), `shift`, `accept`, `reject` (default `0`),
`inspector`, `remarks`, QC report attachment.

**Case 1 — Pass the pieces.**
1. Open the pending call.
2. Date: today. Accept Qty: `50`. Reject Qty: `0`.
3. Save.

**Case 2 — Partly reject with a report.**
1. Accept Qty: `47`. Reject Qty: `3`.
2. Inspector: `Sunil More`. QC report: upload the file.
3. Save. (Accept + Reject must be more than zero and not exceed the pending
   quantity.)

## 7.6 QC Documents — Upload Document

**What it does:** Attaches and records a QC file, optionally tagged to a job card
and sales order.

Fields: `file` (required), `docType` (`MIR` / `MCR` /
`Inspection Report Protocol` / `Inspection Report` / `TPI Report` / `Drawing` /
`Certificate` / `Other`), `category` (`qc-docs` / `drawing` / `inspection` /
`tpi` / `incoming-qc` / `po-docs` / `design` / `dispatch` / `other`),
`jcCodeText`, `soCodeText`.

**Case 1 — Upload an inspection report.**
1. File: choose the PDF.
2. Document Type: `Inspection Report`.
3. (Optional) JC No.: `JC-00001`. SO No.: `IN-SO-00001`.
4. Save.

---

# 8. Finance

**What it does:** Records dispatches sent to customers and the invoices billed to
them.

## 8.1 Customer Dispatch — New Dispatch

**What it does:** Records finished goods shipped to a customer against one of
their sales orders.

Fields: `salesOrderId` (Sales Order picker, required), `dispatchDate` (default
today), `transport`, `vehicleNo`, `remarks`. Line: `qty` (Dispatch Qty).

**Case 1 — Ship finished goods.**
1. Sales Order: pick `IN-SO-00001`.  *(comes from the Sales Order master; loads the ready-to-ship lines)*
2. Dispatch Date: today.
3. On each line, the Dispatch Qty is pre-filled with what is ready (for example
   `100`). Lower it if you are shipping part.
4. Save.
- Cascade: dispatched quantity is what an invoice can later bill.

**Case 2 — Ship with transport details.**
1. Fill as Case 1, plus Transport: `Acme Roadways`, Vehicle No.: `MH12AB1234`.
2. Save.

## 8.2 Invoice — Create Invoice

**What it does:** Raises a tax invoice for goods already dispatched on a sales
order.

Fields: `salesOrderId` (Sales Order picker, required), `invoiceDate` (default
today), `paymentTermsDays` (default `45`), `gstPercent` (`0` / `5` / `12` /
`18` / `28`, default `18`), `remarks`. Lines: `qty` (Invoice Qty), `rate`.

**Case 1 — Invoice dispatched goods.**
1. Sales Order: pick `IN-SO-00001`.  *(comes from the Sales Order master; loads the lines you can still bill)*
2. Invoice Date: today.
3. On each line, Invoice Qty is pre-filled with the available amount (for
   example `100`); Rate is pre-filled from the order.
4. Save.
- Cascade: invoicing increases the order line's "already invoiced" count, so you
  cannot bill the same pieces twice. You can only invoice what has been
  dispatched.

**Case 2 — Set payment terms and GST.**
1. Fill as Case 1.
2. Payment Terms (days): `30`. GST %: `18`.
3. Save.

---

*End of guide. Every field name and every option shown above is taken directly
from the current system, so what you see on screen will match this document.*
