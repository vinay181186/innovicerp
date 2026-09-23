import * as React from 'react';
/**
 * The ONE list-page header band: sticky on --bg, section-hdr title (+ module emoji), "N records · x only" count line, toolbar (220px search, filters, Updating…, primary action last). Children = StatStrip or StatusPills row.
 * @startingPoint section="Layout" subtitle="List page header band" viewport="1100x200"
 */
export interface ListHeaderProps {
  title: string;
  /** Module emoji from the nav, e.g. 🏭 */
  icon?: string;
  count?: number;
  /** Singular noun for the count line: "order", "vendor", "GRN" */
  noun?: string;
  /** Active filter shown as "· open only" */
  filterNote?: string;
  search?: string;
  onSearch?: (v: string) => void;
  searchPlaceholder?: string;
  updating?: boolean;
  /** Extra toolbar controls (Select filters, Export) — placed after search */
  tools?: React.ReactNode;
  /** Primary action button — always last, always btn-primary */
  primary?: React.ReactNode;
  sticky?: boolean;
  children?: React.ReactNode;
}
export declare function ListHeader(props: ListHeaderProps): React.JSX.Element;
