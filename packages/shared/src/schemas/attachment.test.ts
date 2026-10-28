import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_MAX_BYTES,
  QC_REPORT_ACCEPT,
  attachmentSizeError,
  attachmentTypeAllowed,
} from './attachment';

describe('attachmentSizeError', () => {
  it('passes a file exactly at the limit', () => {
    expect(attachmentSizeError({ name: 'a.pdf', size: ATTACHMENT_MAX_BYTES })).toBeNull();
  });
  it('refuses one byte over, and never reads as 50.0 MB', () => {
    const msg = attachmentSizeError({ name: 'a.pdf', size: ATTACHMENT_MAX_BYTES + 1 });
    expect(msg).toContain('a.pdf is 50.1 MB. The limit is 50 MB');
  });
  it('passes an empty file', () => {
    expect(attachmentSizeError({ name: 'a.pdf', size: 0 })).toBeNull();
  });
});

describe('attachmentTypeAllowed', () => {
  it('accepts listed types in any case', () => {
    for (const n of ['r.PDF', 'p.jpeg', 'p.HEIC', 'p.webp', 'r.docx', 'r.xlsx']) {
      expect(attachmentTypeAllowed(n, QC_REPORT_ACCEPT)).toBe(true);
    }
  });
  it('refuses unlisted, double and missing extensions', () => {
    for (const n of ['x.exe', 'r.pdf.exe', 'noext', 'r.zip']) {
      expect(attachmentTypeAllowed(n, QC_REPORT_ACCEPT)).toBe(false);
    }
  });
});
