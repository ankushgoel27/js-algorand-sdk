import { ensureUint64, MAX_UINT_64 } from './utils/utils';

const MICROALGOS_TO_ALGOS_RATIO = BigInt(1_000_000);

export type AlgoAmountParams =
  | {
      algos: number | bigint;
      microAlgos: number | bigint;
    }
  | {
      algos: number | bigint;
      microAlgos?: number | bigint;
    }
  | {
      algos?: number | bigint;
      microAlgos: number | bigint;
    };

export class AlgoAmount {
  private readonly microAlgos: bigint;

  constructor({ algos, microAlgos }: AlgoAmountParams) {
    const algosBigInt = ensureUint64(algos ?? 0);
    const microAlgosBigInt = ensureUint64(microAlgos ?? 0);

    this.microAlgos =
      algosBigInt * MICROALGOS_TO_ALGOS_RATIO + microAlgosBigInt;
    if (this.microAlgos > MAX_UINT_64) {
      throw new Error(`MicroAlgos amount is too large: ${this.microAlgos}`);
    }
  }

  public toMicroAlgos(): bigint {
    return this.microAlgos;
  }

  public wholeAlgosOnly(): bigint {
    return this.microAlgos / MICROALGOS_TO_ALGOS_RATIO;
  }

  public microAlgosOnly(): bigint {
    return this.microAlgos % MICROALGOS_TO_ALGOS_RATIO;
  }

  public toString(): string {
    return `${this.wholeAlgosOnly()}.${this.microAlgosOnly().toString().padStart(6, '0')}`;
  }
}
