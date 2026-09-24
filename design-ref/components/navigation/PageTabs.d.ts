import * as React from 'react';
export interface PageTab { key: string; label: string; icon?: string; }
/** Browser-style open-page tabs under the header; active tab has a 2px blue top edge. */
export interface PageTabsProps {
  tabs: PageTab[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  onClose?: (key: string) => void;
}
export declare function PageTabs(props: PageTabsProps): React.JSX.Element;
