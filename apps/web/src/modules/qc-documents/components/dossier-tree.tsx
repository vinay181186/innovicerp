// ADR-252 Dossier — left pane: Order → POL rows (with their state chip) →
// report folders (file count, or a red "missing"). Selection lives in the URL
// (lineId / folder) so the dashboard can deep-link straight to a POL.

import type { QcDossierLine, QcDossierResponse } from '@innovic/shared';
import { useState } from 'react';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { Badge } from '@/ui/core';
import { folderChip, folderFiles, lineChip } from './dossier-model';

/** lineId for the "files on no line" node. */
export const UNLINKED_ID = 'unlinked';

export interface DossierSelection {
  lineId: string | undefined;
  folder: string | undefined;
}

export function polLabel(line: Pick<QcDossierLine, 'clientPoLineNo' | 'lineNo'>): string {
  return line.clientPoLineNo ?? String(line.lineNo);
}

export function DossierTree({
  dossier,
  lines,
  sel,
  onSelect,
}: {
  dossier: QcDossierResponse;
  /** The lines left after the search box. */
  lines: QcDossierLine[];
  sel: DossierSelection;
  onSelect: (s: DossierSelection) => void;
}): React.JSX.Element {
  // Lines the user folded shut / opened by hand; the selected line is open.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const isOpen = (id: string): boolean => (sel.lineId === id) !== toggled.has(id);
  const flip = (id: string): void =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const { order } = dossier;

  return (
    <ul className="qd-tree" aria-label="Folders">
      <li>
        <button
          type="button"
          className="qd-node"
          aria-current={!sel.lineId ? 'true' : undefined}
          onClick={() => onSelect({ lineId: undefined, folder: undefined })}
        >
          <span className="qd-tw">▾</span>
          <span className="qd-lbl">
            <span className="qd-code">{soNoWithInternal(order.code, order.internalSoNo)}</span>
            {order.customerName ? <span className="text3"> · {order.customerName}</span> : null}
          </span>
        </button>
        <ul>
          {lines.map((line) => {
            const chip = lineChip(line);
            const open = isOpen(line.lineId);
            const current = sel.lineId === line.lineId && !sel.folder;
            return (
              <li key={line.lineId} className="qd-d1">
                <button
                  type="button"
                  className="qd-node"
                  aria-expanded={open}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => {
                    // A second click on the selected POL folds it.
                    if (current) flip(line.lineId);
                    else onSelect({ lineId: line.lineId, folder: undefined });
                  }}
                >
                  <span className="qd-tw">{open ? '▾' : '▸'}</span>
                  <span className="qd-lbl">
                    POL {polLabel(line)} ·{' '}
                    <span className="qd-code">
                      {itemCodeWithRev(line.itemCode, line.itemRevision)}
                    </span>
                  </span>
                  <Badge tone={chip.tone} title={chip.title} className="qd-chip">
                    {chip.text}
                  </Badge>
                </button>
                {open ? <FolderList line={line} sel={sel} onSelect={onSelect} /> : null}
              </li>
            );
          })}
          {dossier.unlinked.length > 0 ? (
            <li className="qd-d1">
              <button
                type="button"
                className="qd-node"
                aria-current={sel.lineId === UNLINKED_ID ? 'true' : undefined}
                onClick={() => onSelect({ lineId: UNLINKED_ID, folder: undefined })}
              >
                <span className="qd-tw">📁</span>
                <span className="qd-lbl">Unlinked</span>
                <span className="qd-ct">{dossier.unlinked.length}</span>
              </button>
            </li>
          ) : null}
        </ul>
      </li>
    </ul>
  );
}

function FolderList({
  line,
  sel,
  onSelect,
}: {
  line: QcDossierLine;
  sel: DossierSelection;
  onSelect: (s: DossierSelection) => void;
}): React.JSX.Element {
  if (line.folders.length === 0) {
    return (
      <ul>
        <li className="qd-d2">
          <span className="qd-node qd-static">
            <span className="qd-tw" />
            <span className="qd-lbl">
              {line.jobCards.length > 0 ? 'No report needed' : 'JC not created yet'}
            </span>
          </span>
        </li>
      </ul>
    );
  }
  return (
    <ul>
      {line.folders.map((f) => {
        const n = folderFiles(f).length;
        const chip = folderChip(f, n);
        return (
          <li key={f.reportName} className="qd-d2">
            <button
              type="button"
              className="qd-node"
              aria-current={
                sel.lineId === line.lineId && sel.folder === f.reportName ? 'true' : undefined
              }
              onClick={() => onSelect({ lineId: line.lineId, folder: f.reportName })}
            >
              <span className="qd-tw">{n > 0 ? '📁' : '📂'}</span>
              <span className="qd-lbl" title={f.reportName}>
                {f.reportName}
                {!f.mandatory ? <span className="text3"> (optional)</span> : null}
              </span>
              {f.state === 'report_missing' || f.state === 'qc_not_done' ? (
                <Badge tone={chip.tone} title={chip.title} className="qd-chip">
                  {chip.text}
                </Badge>
              ) : (
                <span className="qd-ct" title={chip.title}>
                  {n}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
