import * as React from 'react';
/**
 * Labelled form group: 11px mono uppercase label over a control.
 * Width comes from `size` on the 12-column FormGrid — chosen by CONTENT TYPE:
 * xs (2/12) %, rev, ln, days, UOM · sm (3/12) qty, rate, amount, date, doc no. ·
 * md (4/12) select, ref no., phone · lg (6/12) client/vendor, item name, email · full remarks/textarea.
 * @startingPoint section="Forms" subtitle="Document header form grid" viewport="700x300"
 */
export interface FormFieldProps {
  label: string;
  required?: boolean;
  help?: string;
  error?: string;
  /** Field width on the 12-col grid. Default 'md'. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'full';
  /** @deprecated use `size` — 2 maps to 'lg', 'full' to 'full' */
  span?: 'full' | 2;
  children?: React.ReactNode;
}
export declare function FormField(props: FormFieldProps): React.JSX.Element;
export interface FormGridProps {
  /** @deprecated equal-column layout; omit for the canonical 12-column grid */
  cols?: 2 | 3 | 4;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}
export declare function FormGrid(props: FormGridProps): React.JSX.Element;
