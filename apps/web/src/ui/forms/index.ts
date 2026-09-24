// ui/forms — the form primitives. Every screen composes these; no screen
// hand-assembles .form-grp / .innovic-input markup again.
//
// Other groups append their own exports below; never overwrite this file.

export { FormGrid } from './FormGrid';
export type { FormGridProps } from './FormGrid';

export { FormField } from './FormField';
export type { FormFieldProps, FormFieldSize } from './FormField';

export { Input } from './Input';
export type { InputProps, InputState, FieldWidth } from './Input';

export { Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';

export { Select } from './Select';
export type { SelectProps, SelectOption } from './Select';

export { SearchInput } from './SearchInput';
export type { SearchInputProps } from './SearchInput';

export { CheckField } from './CheckField';
export type { CheckFieldProps } from './CheckField';

// ── Pickers ────────────────────────────────────────────────────────────────
// These four wrap load-bearing logic (audit/02-element-inventory.md §D).
// SearchableSelect and DocNumberInput reach the LIVE implementations under
// components/shared/; LineItemPicker and FileField are the presentational
// halves, with the fetch/upload still owned by the caller until Phase 4.

export { SearchableSelect } from './SearchableSelect';
export type { SearchableSelectProps, SearchableOption } from './SearchableSelect';

// READ BEFORE IMPORTING: these two are NOT interchangeable.
//   DocNumberInput     — the LIVE field. Requires `type`, mounts useDocNumber
//                        and hits the duplicate-check endpoint. Screens want
//                        this one; it cannot render without a query client.
//   DocNumberInputView — the pure one. Hand it `state` / `message`; no hook, no
//                        fetch. Kit pages, stories and tests want this one.
export { DocNumberInput, DocNumberInputView } from './DocNumberInput';
export type {
  DocNumberInputProps,
  DocNumberInputViewProps,
  DocNumberInputState,
  DocNumberInputSize,
} from './DocNumberInput';

export { LineItemPicker } from './LineItemPicker';
export type {
  LineItemPickerProps,
  LineItemPickerValue,
  LineItemPickerSize,
  LineItemOption,
} from './LineItemPicker';

export { FileField } from './FileField';
export type { FileFieldProps, FileFieldVariant, FileFieldSize } from './FileField';
