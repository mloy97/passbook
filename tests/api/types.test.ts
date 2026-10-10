// Fails `npm run build` (tsc) if types/passbook-api.d.ts drifts from the source types.
import { expectTypeOf, it } from 'vitest';
import type { PassBookApiV1 as Published, PassBookSyncResult, PassBookTransaction, PassBookTransactionQuery } from '../../types/passbook-api';
import type { PassBookApiV1, SyncResult, TransactionQuery } from '../../src/api/v1';
import type { Transaction } from '../../src/ledger/schema';

it('published types match the source', () => {
	expectTypeOf<Published>().toEqualTypeOf<PassBookApiV1>();
	expectTypeOf<PassBookTransaction>().toEqualTypeOf<Transaction>();
	expectTypeOf<PassBookSyncResult>().toEqualTypeOf<SyncResult>();
	expectTypeOf<PassBookTransactionQuery>().toEqualTypeOf<TransactionQuery>();
});
