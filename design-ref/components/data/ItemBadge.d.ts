import * as React from 'react';
/** The ONE way an item is shown: square product-image box + CODE/REV (mono, purple) + quiet name. */
export interface ItemBadgeProps {
  code: string;
  /** Customer drawing revision — rendered CODE/REV */
  revision?: string;
  name?: string;
  /** Image URL; omit to show the grey package icon */
  src?: string;
  /** row 40px · card 56px · page 96px · tile 120px (contain + 8px pad) */
  size?: 'row' | 'card' | 'page' | 'tile';
  showName?: boolean;
  showImage?: boolean;
  codeColor?: string;
  nameMaxWidth?: number | 'none';
  onOpenImage?: () => void;
  children?: React.ReactNode;
}
export declare function ItemBadge(props: ItemBadgeProps): React.JSX.Element;
export interface ItemImageBoxProps { src?: string; size?: 'row' | 'card' | 'page' | 'tile'; fill?: boolean; onOpen?: () => void; }
export declare function ItemImageBox(props: ItemImageBoxProps): React.JSX.Element;
