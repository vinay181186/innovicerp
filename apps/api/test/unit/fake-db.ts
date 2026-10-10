// The one fake database for the database-free unit tests (`*.unit.test.ts`).
//
// Stands in for `src/db/client`. It answers the auth plugin's users-row read
// and the access read inside withUserContext's transaction, and counts both,
// so a test can say HOW MANY reads happened. Nothing connects.
//
//   vi.mock('<path>/db/client', async () =>
//     (await import('<path>/test/unit/fake-db')).fakeDbClientModule());

type AccessRow = Record<string, unknown>;

export const fakeDb = {
  /** Access reads made (one per `limit` inside a transaction). */
  reads: 0,
  /** Times the caller's claims were set (withUserContext's set_config). */
  claimsSet: 0,
  /** What the next access reads answer, in order: a row, nothing, or a failure. */
  next: [] as Array<AccessRow | 'none' | Error>,
  /** The users row the auth plugin finds; null = no profile. */
  user: {
    id: 'u1',
    email: 'u1@innovic.test',
    fullName: 'U One',
    companyId: '00000000-0000-0000-0000-0000000000c1',
    role: 'viewer',
    isActive: true,
  } as Record<string, unknown> | null,
};

export function resetFakeDb(): void {
  fakeDb.reads = 0;
  fakeDb.claimsSet = 0;
  fakeDb.next = [];
}

export function fakeDbClientModule() {
  const usersChain = {
    from: () => usersChain,
    where: () => usersChain,
    // A FRESH row per read, like the real driver: each request gets its own
    // user object, which is what keeps one request's scope from the next.
    limit: async () => (fakeDb.user ? [{ ...fakeDb.user }] : []),
  };
  const tx = {
    execute: async () => {
      fakeDb.claimsSet += 1;
    },
    select: () => tx,
    from: () => tx,
    where: () => tx,
    limit: async () => {
      fakeDb.reads += 1;
      const n = fakeDb.next.shift() ?? 'none';
      if (n instanceof Error) throw n;
      return n === 'none' ? [] : [n];
    },
  };
  return {
    db: {
      select: () => usersChain,
      transaction: async (fn: (t: typeof tx) => unknown) => fn(tx),
    },
    TEST_HARNESS_APP_NAME: 'x',
  };
}
