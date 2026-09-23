import * as React from 'react';
/** In-app file viewer (PDF iframe / image / unsupported). Download is ABSENT (not disabled) for users without the drawing-download tick. */
export interface FilePreviewProps {
  fileName: string;
  kind?: 'pdf' | 'image' | 'none';
  src?: string;
  canDownload?: boolean;
  onDownload?: () => void;
  onClose?: () => void;
  inline?: boolean;
}
export declare function FilePreview(props: FilePreviewProps): React.JSX.Element;
