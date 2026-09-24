import * as React from 'react';
/** Loading / error / empty / no-access — one component, four placements, the product's exact wording. */
export interface PageStateProps {
  state?: 'loading' | 'error' | 'empty' | 'noaccess';
  message?: string;
  /** panel (list body) · row (inside tbody) · inline (expanded card band) · page (whole page, 40px) */
  as?: 'panel' | 'row' | 'inline' | 'page';
  colSpan?: number;
}
export declare function PageState(props: PageStateProps): React.JSX.Element;
