// Raw Material Master → GRADE tab. Owns the hooks; the table, the New/Edit
// modal and the Excel template/import UI all live in the shared
// <MaterialMasterPanel> (the Size tab is the same panel with the other hooks).

import type { ListMaterialGradesQuery } from '@innovic/shared';
import { useMemo } from 'react';
import {
  useBulkCreateMaterialGrades,
  useCreateMaterialGrade,
  useMaterialGradesList,
  useSoftDeleteMaterialGrade,
  useUpdateMaterialGrade,
} from '../api';
import {
  downloadMaterialGradeTemplate,
  parseMaterialGradeImportFile,
} from '../lib/import-export';
import { fmtImportList } from '../lib/import-message';
import { MaterialMasterPanel } from './material-master-panel';

// Masters scroll, they do not paginate: one fetch, everything in a single
// scrolling list. 1000 is the cap listMaterialGradesQuerySchema allows.
const LIST_LIMIT = 1000;

export function GradeTab({
  term,
  searchInput,
  onSearchInput,
}: {
  /** The debounced search term from the URL (the route owns the debounce). */
  term: string | undefined;
  searchInput: string;
  onSearchInput: (v: string) => void;
}): React.JSX.Element {
  // No isActive filter here — the whole master comes down once and the
  // Active/Inactive split is done in the panel, so the count strip can show all
  // three numbers at the same time.
  const query: ListMaterialGradesQuery = useMemo(
    () => ({ ...(term ? { search: term } : {}), limit: LIST_LIMIT, offset: 0 }),
    [term],
  );
  const list = useMaterialGradesList(query);
  const create = useCreateMaterialGrade();
  const update = useUpdateMaterialGrade();
  const bulkCreate = useBulkCreateMaterialGrades();
  const softDelete = useSoftDeleteMaterialGrade();

  return (
    <MaterialMasterPanel
      noun="Grade"
      rows={list.data?.grades ?? []}
      total={list.data?.total ?? 0}
      isLoading={list.isLoading}
      isFetching={list.isFetching}
      isError={list.isError}
      error={list.error}
      searchInput={searchInput}
      onSearchInput={onSearchInput}
      searchPlaceholder="🔍 Search grade, code, description…"
      namePlaceholder="e.g. EN24"
      saving={create.isPending || update.isPending}
      onSave={async (input, id) => {
        if (id) {
          // '' (not undefined) so clearing the box actually clears the column.
          await update.mutateAsync({
            id,
            input: { name: input.name, description: input.description ?? '', isActive: input.isActive },
          });
        } else {
          await create.mutateAsync({
            name: input.name,
            isActive: input.isActive,
            ...(input.description ? { description: input.description } : {}),
          });
        }
      }}
      deleting={softDelete.isPending}
      onDelete={(row) => softDelete.mutate(row.id)}
      onDownloadTemplate={downloadMaterialGradeTemplate}
      // Whole sheet in ONE request, list reloads once at the end.
      onImportFile={async (file) => {
        const { payloads, errors } = await parseMaterialGradeImportFile(file);
        if (payloads.length === 0) {
          return errors.length
            ? `Nothing to import. ${errors.length} row issue(s): ${fmtImportList(errors)}`
            : 'Nothing to import — the sheet has no grade rows.';
        }
        const res = await bulkCreate.mutateAsync({ grades: payloads });
        const skips = res.skipped.map((s) => `Row ${s.index} "${s.name}": ${s.reason}`);
        return (
          `Imported ${res.created}/${payloads.length} grade(s).` +
          (skips.length ? ` ${skips.length} skipped: ${fmtImportList(skips)}` : '') +
          (errors.length ? ` ${errors.length} row warning(s): ${fmtImportList(errors)}` : '')
        );
      }}
    />
  );
}
