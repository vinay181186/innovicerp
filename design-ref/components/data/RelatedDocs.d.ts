import * as React from 'react';
export interface RelatedDoc { code: string; label?: string; status?: React.ReactNode; date?: string; }
export interface RelatedSection { key: string; title: string; icon?: string; items: RelatedDoc[]; }
/** Related Documents panel with purple category tabs + code/ref/status/date table; timeline goes in children. */
export interface RelatedDocsProps {
  sections: RelatedSection[];
  activeKey?: string;
  onSelect?: (key: string) => void;
  children?: React.ReactNode;
}
export declare function RelatedDocs(props: RelatedDocsProps): React.JSX.Element;
