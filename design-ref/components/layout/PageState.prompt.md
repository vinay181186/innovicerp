Use for every non-data state; never write your own "Loading…" div.
```jsx
<PageState state="loading" />
<PageState state="empty" message="No orders — click + New SO/WO" />
<PageState state="error" as="row" colSpan={11} message="Failed to load vendors" />
<PageState state="noaccess" as="page" />
```