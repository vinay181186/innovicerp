import * as React from 'react';
/** Native select styled like Input. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options?: Array<string | { value: string; label: string }>;
  children?: React.ReactNode;
}
export declare function Select(props: SelectProps): React.JSX.Element;
