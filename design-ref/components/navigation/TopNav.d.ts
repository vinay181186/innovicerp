import * as React from 'react';
export interface TopNavItem { label: string; icon?: string; }
export interface TopNavGroup { label?: string; items: TopNavItem[]; }
export interface TopNavSection { key: string; label: string; groups: TopNavGroup[]; }
/**
 * The 54px header band: logo, Dashboard, module dropdowns (Entry / Master / Report columns), right cluster.
 * @startingPoint section="Navigation" subtitle="Header with module mega-menus" viewport="1280x320"
 */
export interface TopNavProps {
  logoSrc?: string;
  sections: TopNavSection[];
  /** Module the current page lives in (highlighted) */
  activeKey?: string;
  dashboardActive?: boolean;
  /** Module whose menu is open */
  openKey?: string | null;
  onToggle?: (key: string) => void;
  onDashboard?: () => void;
  onPick?: (sectionKey: string, item: TopNavItem) => void;
  /** Label of the current page (highlighted inside the menu) */
  currentPage?: string;
  /** Right cluster before the avatar — search, sync dot, icon buttons */
  right?: React.ReactNode;
  initials?: string;
}
export declare function TopNav(props: TopNavProps): React.JSX.Element;
