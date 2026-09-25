Document-status badge with the product's exact enum → tone mapping — never pick a Badge tone by hand for a status.
```jsx
<StatusBadge kind="so" status="open" />
<StatusBadge kind="pr" status="po_created" />
<StatusBadge kind="nc" status="under_rework" />
<StatusBadge kind="ncdisp" status="scrap" />   // "Reject / Scrap", red
```
Maps: SO, JC, JC-op (in_progress/running/at_vendor render as a bare unfilled badge — matches legacy), PR, PO, Production Order, GRN QC, DC, NC, NC disposition, store txn, generic related-doc.