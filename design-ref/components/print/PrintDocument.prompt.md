Printed outward documents. Arial 12px, greyscale — deliberately NOT the app theme.
```jsx
<PrintDocument title="PURCHASE ORDER" company={{ name: 'Innovic Engineering', gstin: '27AAAAA0000A1Z5' }} recipient={{ name: 'Precision Heat Treat' }} meta={[{ label: 'PO No.', value: 'IN-MPO-26-0311' }]} lines={[…]} totals={{ subtotal: '22,200.00', grand: '26,196.00' }} />
```
Dates dd-MM-yyyy, Indian number format (1,00,000.00), amount in words "Indian Rupees … Only".