import * as React from 'react';
export interface WorkItem { severity?: 'critical' | 'warn' | 'info'; icon?: string; title: string; detail?: string; age?: number; action: string; onAction?: () => void; }
/** Dashboard "My Work" panel: severity left bar (3px), age chip, action button coloured by severity. */
export interface WorkListProps { title?: string; items: WorkItem[]; emptyText?: string; more?: { label: string; onClick?: () => void }; }
export declare function WorkList(props: WorkListProps): React.JSX.Element;
export interface AttentionItem { icon?: string; label: string; severity?: 'critical' | 'warn' | 'info'; onClick?: () => void; }
/** "Needs Attention" rows (severity-coloured label + View →); put inside a Panel. */
export interface AttentionListProps { items: AttentionItem[]; emptyText?: string; }
export declare function AttentionList(props: AttentionListProps): React.JSX.Element;
/** "Today" stat row: emoji · label · 18px mono number on bg3, hover = bg4 + blue border. */
export interface StatRowProps { icon?: string; label: string; value: React.ReactNode; onClick?: () => void; }
export declare function StatRow(props: StatRowProps): React.JSX.Element;
export interface QuickLink { icon?: string; label: string; color: string; onClick?: () => void; }
/** 🚀 Quick Access chips tinted in the module's department colour (7% fill / 25% border). */
export interface QuickLinksProps { links: QuickLink[]; title?: string; }
export declare function QuickLinks(props: QuickLinksProps): React.JSX.Element;
