import * as React from 'react';
/** Lucide control icons (the product's icon library), inlined so the DS needs no icon runtime. 12–15px, 2px stroke. Emoji stay for module/page identity only. */
export interface IconProps {
  name: 'search' | 'eye' | 'pencil' | 'trash-2' | 'download' | 'upload' | 'printer' | 'plus' | 'check' | 'x' | 'chevron-right' | 'chevron-down' | 'arrow-left' | 'key-round' | 'log-out' | 'bell' | 'package' | 'settings' | 'refresh-cw' | 'square' | 'user-round' | 'paperclip' | 'loader-2';
  size?: number;
  color?: string;
  strokeWidth?: number;
  title?: string;
}
export declare function Icon(props: IconProps): React.JSX.Element;
export declare const ICON_NAMES: string[];
