// E5 / ADR-234 — an Entry-only planner may finish the plan they just created.
// Pure (no database) so own-draft.unit.test.ts can run without one.

/** null = allowed; otherwise the refusal text. Allowed only for a plan the
 *  caller created that is still In Planning (its first status). */
export function ownDraftPlanRefusal(
  row: { code: string; createdBy: string | null; planStatus: string },
  userId: string,
): string | null {
  if (row.createdBy === userId && row.planStatus === 'in_planning') return null;
  return (
    `Plan ${row.code}: with the Entry tick you can only finish a plan you created that is ` +
    'still In Planning. Changing it needs the Edit tick on SO/JWSO Planning. Ask an admin.'
  );
}
