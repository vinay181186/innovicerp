import * as React from 'react';
export interface FilterDef { key: string; value?: string; onChange?: (v: string) => void; options: Array<string | { value: string; label: string }>; }
/** Filter panel: 2fr search + auto-fit 140px selects ("All Status", "All Priority", "Due Date: All"…). */
export interface FilterBarProps { search?: string; onSearch?: (v: string) => void; placeholder?: string; filters: FilterDef[]; }
export declare function FilterBar(props: FilterBarProps): React.JSX.Element;
