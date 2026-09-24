import * as React from 'react';
export interface LineItem { code: string; name: string; material?: string; }
/** Item Code (datalist over Item Master) + Item Name pair; a matching code auto-fills and locks the name. */
export interface LineItemPickerProps {
  code?: string;
  name?: string;
  /** Item Master rows offered in the datalist */
  items?: LineItem[];
  onChange?: (next: { code: string; name: string; matched: boolean }) => void;
  readOnly?: boolean;
  nameError?: string;
}
export declare function LineItemPicker(props: LineItemPickerProps): React.JSX.Element;
