import * as React from 'react';
export interface Crumb { label: string; link?: boolean; }
/** 11px trail: Home › Section › Screen (› New/Edit/Detail). */
export interface BreadcrumbsProps {
  crumbs: Crumb[];
  onNavigate?: (crumb: Crumb) => void;
}
export declare function Breadcrumbs(props: BreadcrumbsProps): React.JSX.Element;
