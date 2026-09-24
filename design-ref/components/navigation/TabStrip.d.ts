import * as React from 'react';
export interface TabStripTab { key: string; label: string; count?: number | null; note?: string; }
/** In-page view tabs (Task Board Inbox/Outbox/My To-Do/All; JC view tabs): 3px blue underline + blue wash when active. */
export interface TabStripProps { tabs: TabStripTab[]; activeKey?: string; onChange?: (key: string) => void; }
export declare function TabStrip(props: TabStripProps): React.JSX.Element;
