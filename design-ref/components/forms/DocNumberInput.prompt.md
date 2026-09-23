The header field for every document code — prefilled with the next number, validated as you type.
```jsx
<DocNumberInput label="SO No." required value="IN-SO-26-0143" state="ok" />
<DocNumberInput label="PO No." value="IN-MPO-26-0311" state="bad" message="IN-MPO-26-0311 already exists" />
<DocNumberInput label="SO No." value="IN-SO-26-0142" readOnly />
```