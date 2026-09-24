import * as React from 'react';
/** The ONE search box (header global search, list toolbars, filter bars): control height (28px), 13px text, leading search icon; default width --field-lg. */
export interface SearchInputProps {
  value?: string;
  onChange?: (v: string) => void;
  /** "Search this list…" · "Search anything… (Ctrl+K)" · domain-specific */
  placeholder?: string;
  width?: number | string;
  size?: 'md';
  style?: React.CSSProperties;
}
export declare function SearchInput(props: SearchInputProps): React.JSX.Element;
