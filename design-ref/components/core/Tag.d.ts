import * as React from 'react';
/** The ONE square mono chip: linked document refs (link), UOM (neutral), revisions (rev). Replaces .task-linked-ref. */
export interface TagProps {
  tone?: 'link' | 'neutral' | 'rev';
  /** Override text colour token */
  color?: string;
  /** Override background token */
  bg?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}
export declare function Tag(props: TagProps): React.JSX.Element;
