import * as React from 'react';
/** Native checkbox / radio with Innovic-blue accent, 15px, 13px label. */
export interface CheckFieldProps {
  type?: 'checkbox' | 'radio';
  label: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  onChange?: (checked: boolean) => void;
  name?: string;
  disabled?: boolean;
}
export declare function CheckField(props: CheckFieldProps): React.JSX.Element;
