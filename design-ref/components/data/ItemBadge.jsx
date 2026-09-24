import React from 'react';
import { Icon } from '../core/Icon.jsx';
const BOX = { row: 40, card: 56, page: 96, tile: 120 };
const SC = { row: { code: 12, name: 11, icon: 16, r: 4 }, card: { code: 14, name: 12, icon: 20, r: 4 }, page: { code: 16, name: 13, icon: 28, r: 6 }, tile: { code: 15, name: 12.5, icon: 40, r: 8 } };
export function ItemImageBox({ src, size = 'row', fill = false, onOpen }) {
  const px = BOX[size]; const sc = SC[size]; const tile = size === 'tile';
  return <div onClick={src ? (e) => { e.stopPropagation(); onOpen && onOpen(); } : undefined} title={src ? 'Product image' : 'No product image'}
    style={{ position: fill ? 'absolute' : 'relative', inset: fill ? 0 : undefined, width: fill ? '100%' : px, height: fill ? '100%' : px, flexShrink: 0, borderRadius: fill ? 0 : sc.r,
      border: fill ? 'none' : '1px solid var(--border)', background: tile ? 'var(--bg3)' : 'var(--bg4)', boxShadow: tile ? '0 1px 3px rgba(20,40,70,0.08)' : undefined,
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text3)', overflow: 'hidden', cursor: src ? 'zoom-in' : 'default' }}>
    <Icon name="package" size={sc.icon} />
    {src ? <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: tile ? 'contain' : 'cover', padding: tile ? 8 : undefined, boxSizing: 'border-box', background: tile ? 'var(--bg3)' : 'var(--bg4)' }} /> : null}
  </div>;
}
export function ItemBadge({ code, revision, name, src, size = 'row', showName = true, showImage = true, codeColor = 'var(--purple)', nameMaxWidth, onOpenImage, children }) {
  const sc = SC[size]; const tile = size === 'tile';
  const codeText = (code || '—') + (revision ? '/' + revision : '');
  const maxW = nameMaxWidth || (size === 'page' || tile ? 'none' : 200);
  return <div style={{ display: size === 'row' ? 'flex' : 'inline-flex', width: size === 'row' ? '100%' : undefined, alignItems: tile ? 'flex-start' : 'center', gap: tile || size === 'page' ? 12 : 8, textAlign: 'left', minWidth: 0, maxWidth: '100%' }}>
    {showImage ? <ItemImageBox src={src} size={size} onOpen={onOpenImage} /> : null}
    <div style={{ minWidth: 0 }}>
      <div className="mono fw-700" style={{ color: codeColor, fontSize: sc.code, fontWeight: tile ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }} title={codeText}>{codeText}</div>
      {showName ? <div className="text2" style={{ fontSize: sc.name, maxWidth: maxW, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: tile ? 'normal' : 'nowrap', lineHeight: 1.25 }} title={name}>{name || '—'}</div> : null}
      {children}
    </div>
  </div>;
}
