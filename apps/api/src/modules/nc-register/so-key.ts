// The Sales Order an NC belongs to — ONE definition, used by the return-to-
// vendor DC save (create-nc-dc.ts, "all NCs on one DC share one SO") and by the
// NC reads that hand `soId` to the +New DC → Against NC picker (service.ts list
// + detail), so the picker can never group NCs the save then refuses (§21.4).
//
//   nc.so_id                       — stored on the NC (picked / auto-linked)
//   else the job card's source SO line's sales_order_id
//
// An NC raised without a picked SO on a card cut from an SO line has a null
// so_id but still plainly belongs to that SO. A JWSO-sourced or standalone card
// has neither, so the key is null and such an NC can only go on a DC by itself.

import { sql, type SQL } from 'drizzle-orm';

/** Scalar SQL: the NC's SO id (uuid or NULL), for the nc_register row aliased
 *  `ncAlias` ('nc' in the raw list SQL, 'nc_register' in a drizzle select). */
export function ncSoKeySql(ncAlias = 'nc'): SQL<string | null> {
  const nc = sql.identifier(ncAlias);
  return sql<string | null>`COALESCE(${nc}.so_id, (
    SELECT ksol.sales_order_id
      FROM public.job_cards kjc
      JOIN public.sales_order_lines ksol ON ksol.id = kjc.source_so_line_id
     WHERE kjc.id = ${nc}.job_card_id
       AND kjc.company_id = ${nc}.company_id
     LIMIT 1
  ))`;
}
