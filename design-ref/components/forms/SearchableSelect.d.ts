import * as React from 'react';
export interface SearchableOption { id: string; code?: string | null; name: string; }
/**
 * Type-to-search picker for every master/document field (SO, vendor, item, client…). Rows read "CODE — Name".
 * @startingPoint section="Forms" subtitle="Type-to-search master picker" viewport="700x320"
 */
export interface SearchableSelectProps {
  /** Selected option id, or null */
  value?: string | null;
  onChange?: (id: string | null) => void;
  options: SearchableOption[];
  placeholder?: string;
  disabled?: boolean;
  loading?: boolean;
  emptyText?: string;
  style?: React.CSSProperties;
}
export declare function SearchableSelect(props: SearchableSelectProps): React.JSX.Element;
