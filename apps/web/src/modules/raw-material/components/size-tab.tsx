// Raw Material Master → SIZE tab. Same shape as grade-tab.tsx; the size is ONE
// free-text box by decision (never split into shape / dia / length) and it is
// NOT scoped to a grade — the two masters are independent.

import type { ListMaterialSizesQuery } from '@innovic/shared';
import { useMemo } from 'react';
import {
  useBulkCreateMaterialSizes,
  useCreateMaterialSize,
  useMaterialSizesList,
  useSoftDeleteMaterialSize,
  useUpdateMaterialSize,
} from '../api';
import { downloadMaterialSizeTemplate, parseMaterialSizeImportFile } from '../lib/import-export';
import { fmtImportList } from '../lib/import-message';
import { MaterialMasterPanel } from './material-master-panel';

// Masters scroll, they do not paginate — see the note in grade-tab.tsx.
const LIST_LIMIT = 1000;

export function SizeTab({
  term,
  searchInput,
  onSearchInput,
}: {
  /** The debounced search term from the URL (the route owns the debounce). */
  term: string | undefined;
  searchInput: string;
  onSearchInput: (v: string) => void;
}): React.JSX.Element {
  const query: ListMaterialSizesQuery = useMemo(
    () => ({ ...(term ? { search: term } : {}), limit: LIST_LIMIT, offset: 0 }),
    [term],
  );
  const list = useMaterialSizesList(query);
  const create = useCreateMaterialSize();
  const update = useUpdateMaterialSize();
  const bulkCreate = useBulkCreateMaterialSizes();
  const softDelete = useSoftDeleteMaterialSize();

  return (
    <MaterialMasterPanel
      noun="Size"
      rows={list.data?.sizes ?? []}
      total={list.data?.total ?? 0}
      isLoading={list.isLoading}
      isFetching={list.isFetching}
      isError={list.isError}
      error={list.error}
      searchInput={searchInput}
      onSearchInput={onSearchInput}
      searchPlaceholder="🔍 Search size, code, description…"
      namePlaceholder="e.g. Ø30 × 1000"
      saving={create.isPending || update.isPending}
      onSave={async (input, id) => {
        if (id) {
          // '' (not undefined) so clearing the box actually clears the column.
          await update.mutateAsync({
            id,
            input: {
              name: input.name,
              description: input.description ?? '',
              isActive: input.isActive,
            },
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
      onDownloadTemplate={downloadMaterialSizeTemplate}
      // Whole sheet in ONE request, list reloads once at the end.
      onImportFile={async (file) => {
        const { payloads, errors } = await parseMaterialSizeImportFile(file);
        if (payloads.length === 0) {
          return errors.length
            ? `Nothing to import. ${errors.length} row issue(s): ${fmtImportList(errors)}`
            : 'Nothing to import — the sheet has no size rows.';
        }
        const res = await bulkCreate.mutateAsync({ sizes: payloads });
        const skips = res.skipped.map((s) => `Row ${s.index} "${s.name}": ${s.reason}`);
        return (
          `Imported ${res.created}/${payloads.length} size(s).` +
          (skips.length ? ` ${skips.length} skipped: ${fmtImportList(skips)}` : '') +
          (errors.length ? ` ${errors.length} row warning(s): ${fmtImportList(errors)}` : '')
        );
      }}
    />
  );
}
