import JSONRequest from '../jsonrequest.js';
import { HTTPClient } from '../../client.js';
import { TransactionResponse } from './models/types.js';

export default class LookupTransactionByID extends JSONRequest<
  TransactionResponse,
  Record<string, any>
> {
  /**
   * Returns information about the given transaction.
   *
   * #### Example
   * ```typescript
   * const txnId = "MEUOC4RQJB23CQZRFRKYEI6WBO73VTTPST5A7B3S5OKBUY6LFUDA";
   * const txnInfo = await indexerClient.lookupTransactionByID(txnId).do();
   * ```
   *
   * [Response data schema details](https://developer.algorand.org/docs/rest-apis/indexer/#get-v2transactionstxid)
   * @param txID - The ID of the transaction to look up.
   * @category GET
   */
  constructor(
    c: HTTPClient,
    private txID: string
  ) {
    super(c);
  }

  /**
   * @returns `/v2/transactions/${txID}`
   */
  path() {
    return `/v2/transactions/${this.txID}`;
  }

  // eslint-disable-next-line class-methods-use-this
  prepare(body: Record<string, any>): TransactionResponse {
    return TransactionResponse.from_obj_for_encoding(body);
  }
}
