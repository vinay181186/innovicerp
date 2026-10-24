// A storage path is a guessable string the browser sends after uploading
// straight to Storage. Before any row stores one, it must sit in the caller's
// company folder (`<companyId>/...`) — the stored path is later trusted as
// proof the company owns the file (drawing-files pathBelongsToCompany, the
// ADR-252 QC Dossier download). ONE check, used by every writer of such a path.

import { ValidationError } from './errors';

/** Throws unless `path` is blank/absent or starts with `${companyId}/`.
 *  A `..` / `.` / empty segment or a backslash is refused too, so the
 *  prefix cannot be climbed out of (`<us>/../<them>/x.pdf`). */
export function assertCompanyStoragePath(path: string | null | undefined, companyId: string): void {
  if (path === null || path === undefined || path.trim() === '') return;
  const segments = path.split('/');
  const unsafe =
    path.includes('\\') || segments.some((seg) => seg === '' || seg === '.' || seg === '..');
  if (unsafe || !path.startsWith(`${companyId}/`)) {
    throw new ValidationError('The file was not uploaded to this company. Upload it again.');
  }
}
