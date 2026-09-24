Last column of every table (Action). Icons only in sheets; labelled in nested line tables.
```jsx
<td><RowActions onView={open} onEdit={edit} onDelete={() => setConfirm(row)} /></td>
```
Delete in sheets = red icon on white (never white-on-red icon, which disappears on the sheet's paper buttons).