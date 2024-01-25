// @ts-nocheck // Temporary type fix, will be unnecessary in following PR
import base32 from 'hi-base32';
import { translateBoxReferences } from './boxStorage.js';
import * as address from './encoding/address.js';
import { base64ToBytes, bytesToBase64 } from './encoding/binarydata.js';
import * as encoding from './encoding/encoding.js';
import * as nacl from './nacl/naclWrappers.js';
import { Address } from './types/address.js';
import {
  EncodedLogicSig,
  EncodedMultisig,
  EncodedSignedTransaction,
  EncodedTransaction,
  EncodedAssetParams,
  EncodedLocalStateSchema,
  EncodedGlobalStateSchema,
} from './types/transactions/index.js';
import {
  SuggestedParams,
  BoxReference,
  OnApplicationComplete,
  TransactionParams,
  TransactionType,
  isTransactionType,
  PaymentTransactionParams,
  AssetConfigurationTransactionParams,
  AssetTransferTransactionParams,
  AssetFreezeTransactionParams,
  KeyRegistrationTransactionParams,
  ApplicationCallTransactionParams,
  StateProofTransactionParams,
} from './types/transactions/base.js';
import * as utils from './utils/utils.js';

const ALGORAND_TRANSACTION_LENGTH = 52;
export const ALGORAND_MIN_TX_FEE = 1000; // version v5
const ALGORAND_TRANSACTION_LEASE_LENGTH = 32;
const NUM_ADDL_BYTES_AFTER_SIGNING = 75; // NUM_ADDL_BYTES_AFTER_SIGNING is the number of bytes added to a txn after signing it
const ASSET_METADATA_HASH_LENGTH = 32;
const KEYREG_VOTE_KEY_LENGTH = 32;
const KEYREG_SELECTION_KEY_LENGTH = 32;
const KEYREG_STATE_PROOF_KEY_LENGTH = 64;
const ALGORAND_TRANSACTION_GROUP_LENGTH = 32;

function uint8ArrayIsEmpty(input: Uint8Array): boolean {
  return input.every((value) => value === 0);
}

function getKeyregKey(
  input: undefined | string | Uint8Array,
  inputName: string,
  length: number
): Uint8Array | undefined {
  if (input == null) {
    return undefined;
  }

  let inputBytes: Uint8Array | undefined;

  if (typeof input === 'string') {
    inputBytes = base64ToBytes(input);
  } else if (input instanceof Uint8Array) {
    inputBytes = input;
  }

  if (inputBytes == null || inputBytes.byteLength !== length) {
    throw Error(
      `${inputName} must be a ${length} byte Uint8Array or base64 string.`
    );
  }

  return inputBytes;
}

function ensureAddress(input: unknown): Address {
  if (input == null) {
    throw new Error('Address must not be null or undefined');
  }
  if (typeof input === 'string') {
    return address.decodeAddress(input);
  }
  if (
    typeof input === 'object' &&
    (input as Record<string, unknown>).publicKey instanceof Uint8Array &&
    (input as Record<string, unknown>).checksum instanceof Uint8Array
  ) {
    return input as Address;
  }
  throw new Error(`Not an address: ${input}`);
}

function optionalAddress(input: unknown): Address | undefined {
  if (input == null) {
    return undefined;
  }
  let addr: Address;
  if (
    typeof input === 'object' &&
    (input as Record<string, unknown>).publicKey instanceof Uint8Array &&
    (input as Record<string, unknown>).checksum instanceof Uint8Array
  ) {
    addr = input as Address;
  } else if (typeof input === 'string') {
    addr = address.decodeAddress(input);
  } else {
    throw new Error(`Not an address: ${input}`);
  }
  if (uint8ArrayIsEmpty(addr.publicKey)) {
    // If it's the zero address, throw an error so that the user won't be surprised that this gets dropped
    throw new Error(
      'Invalid use of the zero address. To omit this value, pass in undefined'
    );
  }
  return addr;
}

function optionalUint8Array(input: unknown): Uint8Array | undefined {
  if (typeof input === 'undefined') {
    return undefined;
  }
  if (input instanceof Uint8Array) {
    return input;
  }
  throw new Error(`Not a Uint8Array: ${input}`);
}

function ensureUint8Array(input: unknown): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  throw new Error(`Not a Uint8Array: ${input}`);
}

function optionalUint64(input: unknown): bigint | undefined {
  if (typeof input === 'undefined') {
    return undefined;
  }
  return utils.ensureUint64(input);
}

function ensureBoolean(input: unknown): boolean {
  if (input === true || input === false) {
    return input;
  }
  throw new Error(`Not a boolean: ${input}`);
}

function ensureArray(input: unknown): unknown[] {
  if (Array.isArray(input)) {
    return input.slice();
  }
  throw new Error(`Not an array: ${input}`);
}

function optionalFixedLengthByteArray(
  input: unknown,
  length: number,
  name: string
): Uint8Array | undefined {
  const bytes = optionalUint8Array(input);
  if (typeof bytes === 'undefined') {
    return undefined;
  }
  if (bytes.byteLength !== length) {
    throw new Error(
      `${name} must be ${length} bytes long, was ${bytes.byteLength}`
    );
  }
  if (uint8ArrayIsEmpty(bytes)) {
    // if contains all 0s, omit it
    return undefined;
  }
  return bytes;
}

interface TransactionBoxReference {
  readonly appIndex: bigint;
  readonly name: Uint8Array;
}

function ensureBoxReference(input: unknown): TransactionBoxReference {
  if (input != null && typeof input === 'object') {
    const { appIndex, name } = input as BoxReference;
    return {
      appIndex: utils.ensureUint64(appIndex),
      name: ensureUint8Array(name),
    };
  }
  throw new Error(`Not a box reference: ${input}`);
}

const TX_TAG = new TextEncoder().encode('TX');

interface PaymentTransactionFields {
  readonly receiver: Address;
  readonly amount: bigint;
  readonly closeRemainderTo?: Address;
}

interface KeyRegistrationTransactionFields {
  readonly voteKey?: Uint8Array;
  readonly selectionKey?: Uint8Array;
  readonly stateProofKey?: Uint8Array;
  readonly voteFirst?: bigint;
  readonly voteLast?: bigint;
  readonly voteKeyDilution?: bigint;
  readonly nonParticipation: boolean;
}

interface AssetConfigTransactionFields {
  readonly assetId: bigint;
  readonly assetTotal: bigint;
  readonly assetDecimals: number;
  readonly assetDefaultFrozen: boolean;
  readonly assetManager?: Address;
  readonly assetReserve?: Address;
  readonly assetFreeze?: Address;
  readonly assetClawback?: Address;
  readonly assetUnitName?: string;
  readonly assetName?: string;
  readonly assetURL?: string;
  readonly assetMetadataHash?: Uint8Array;
}

interface AssetTransferTransactionFields {
  readonly assetId: bigint;
  readonly amount: bigint;
  readonly sender?: Address;
  readonly receiver: Address;
  readonly closeRemainderTo?: Address;
}

interface AssetFreezeTransactionFields {
  readonly assetId: bigint;
  readonly freezeAccount: Address;
  readonly assetFrozen: boolean;
}

interface ApplicationTransactionFields {
  readonly appId: bigint;
  readonly appOnComplete: OnApplicationComplete;
  readonly appLocalInts: number;
  readonly appLocalByteSlices: number;
  readonly appGlobalInts: number;
  readonly appGlobalByteSlices: number;
  readonly extraPages: number;
  readonly appApprovalProgram: Uint8Array;
  readonly appClearProgram: Uint8Array;
  readonly appArgs: ReadonlyArray<Uint8Array>;
  readonly appAccounts: ReadonlyArray<Address>;
  readonly appForeignApps: ReadonlyArray<bigint>;
  readonly appForeignAssets: ReadonlyArray<bigint>;
  readonly boxes: ReadonlyArray<TransactionBoxReference>;
}

interface StateProofTransactionFields {
  readonly stateProofType: number;
  readonly stateProof: Uint8Array;
  readonly stateProofMessage: Uint8Array;
}

/**
 * Transaction enables construction of Algorand transactions
 * */
export class Transaction {
  /** common */
  public readonly type: TransactionType;
  public readonly sender: Address;
  public readonly note: Uint8Array;
  public readonly lease?: Uint8Array;
  public readonly rekeyTo?: Address;

  /** group */
  public group: Uint8Array;

  /** suggested params */
  public fee: bigint;
  public readonly firstValid: bigint;
  public readonly lastValid: bigint;
  public readonly genesisID?: string;
  public readonly genesisHash: Uint8Array;

  /** type-specific fields */
  public readonly payment?: PaymentTransactionFields;
  public readonly keyreg?: KeyRegistrationTransactionFields;
  public readonly assetConfig?: AssetConfigTransactionFields;
  public readonly assetTransfer?: AssetTransferTransactionFields;
  public readonly assetFreeze?: AssetFreezeTransactionFields;
  public readonly applicationCall?: ApplicationTransactionFields;
  public readonly stateProof?: StateProofTransactionFields;

  constructor(params: TransactionParams) {
    if (!isTransactionType(params.type)) {
      throw new Error(`Invalid transaction type: ${params.type}`);
    }

    // Common fields
    this.type = params.type; // verified above
    this.sender = ensureAddress(params.sender);
    this.note = ensureUint8Array(params.note ?? new Uint8Array());
    this.lease = optionalFixedLengthByteArray(
      params.lease,
      ALGORAND_TRANSACTION_LEASE_LENGTH,
      'lease'
    );
    this.rekeyTo = optionalAddress(params.rekeyTo);

    // Group
    this.group = new Uint8Array();

    // Suggested params fields
    this.firstValid = utils.ensureUint64(params.suggestedParams.firstValid);
    this.lastValid = utils.ensureUint64(params.suggestedParams.lastValid);
    if (params.suggestedParams.genesisID) {
      if (typeof params.suggestedParams.genesisID !== 'string') {
        throw new Error('Genesis ID must be a string if present');
      }
      this.genesisID = params.suggestedParams.genesisID;
    }
    if (!params.suggestedParams.genesisHash) {
      throw new Error('Genesis hash must be specified');
    }
    this.genesisHash = base64ToBytes(params.suggestedParams.genesisHash);
    // Fee is handled at the end

    const fieldsPresent: TransactionType[] = [];
    if (params.paymentParams) fieldsPresent.push(TransactionType.pay);
    if (params.keyregParams) fieldsPresent.push(TransactionType.keyreg);
    if (params.assetConfigParams) fieldsPresent.push(TransactionType.acfg);
    if (params.assetTransferParams) fieldsPresent.push(TransactionType.axfer);
    if (params.assetFreezeParams) fieldsPresent.push(TransactionType.afrz);
    if (params.appCallParams) fieldsPresent.push(TransactionType.appl);
    if (params.stateProofParams) fieldsPresent.push(TransactionType.stpf);

    if (fieldsPresent.length !== 1) {
      throw new Error(
        `Transaction has wrong number of type fields present (${fieldsPresent.length}): ${fieldsPresent}`
      );
    }

    if (this.type !== fieldsPresent[0]) {
      throw new Error(
        `Transaction has type ${this.type} but fields present for ${fieldsPresent[0]}`
      );
    }

    if (params.paymentParams) {
      this.payment = {
        receiver: ensureAddress(params.paymentParams.receiver),
        amount: utils.ensureUint64(params.paymentParams.amount),
        closeRemainderTo: optionalAddress(
          params.paymentParams.closeRemainderTo
        ),
      };
    }

    if (params.keyregParams) {
      this.keyreg = {
        voteKey: getKeyregKey(
          params.keyregParams.voteKey,
          'voteKey',
          KEYREG_VOTE_KEY_LENGTH
        )!,
        selectionKey: getKeyregKey(
          params.keyregParams.selectionKey,
          'selectionKey',
          KEYREG_SELECTION_KEY_LENGTH
        )!,
        stateProofKey: getKeyregKey(
          params.keyregParams.stateProofKey,
          'stateProofKey',
          KEYREG_STATE_PROOF_KEY_LENGTH
        )!,
        voteFirst: optionalUint64(params.keyregParams.voteFirst),
        voteLast: optionalUint64(params.keyregParams.voteLast),
        voteKeyDilution: optionalUint64(params.keyregParams.voteKeyDilution),
        nonParticipation: ensureBoolean(
          params.keyregParams.nonParticipation ?? false
        ),
      };
      // Checking non-participation key registration
      if (
        this.keyreg.nonParticipation &&
        (this.keyreg.voteKey ||
          this.keyreg.selectionKey ||
          this.keyreg.stateProofKey ||
          typeof this.keyreg.voteFirst !== 'undefined' ||
          typeof this.keyreg.voteLast !== 'undefined' ||
          typeof this.keyreg.voteKeyDilution !== 'undefined')
      ) {
        throw new Error(
          'nonParticipation is true but participation params are present.'
        );
      }
      // Checking online key registration
      if (
        // If we are participating
        !this.keyreg.nonParticipation &&
        // And *ANY* participating fields are present
        (this.keyreg.voteKey ||
          this.keyreg.selectionKey ||
          this.keyreg.stateProofKey ||
          typeof this.keyreg.voteFirst !== 'undefined' ||
          typeof this.keyreg.voteLast !== 'undefined' ||
          typeof this.keyreg.voteKeyDilution !== 'undefined') &&
        // Then *ALL* participating fields must be present (with an exception for stateProofKey,
        // which was introduced later so for backwards compatibility we don't require it)
        !(
          this.keyreg.voteKey &&
          this.keyreg.selectionKey &&
          typeof this.keyreg.voteFirst !== 'undefined' &&
          typeof this.keyreg.voteLast !== 'undefined' &&
          typeof this.keyreg.voteKeyDilution !== 'undefined'
        )
      ) {
        throw new Error(
          `Online key registration missing at least one of the following fields: voteKey, selectionKey, voteFirst, voteLast, voteKeyDilution`
        );
      }
      // The last option is an offline key registration where all the fields
      // nonParticipation, voteKey, selectionKey, stateProofKey, voteFirst, voteLast, voteKeyDilution
      // are all undefined
    }

    if (params.assetConfigParams) {
      this.assetConfig = {
        assetId: utils.ensureUint64(params.assetConfigParams.assetIndex ?? 0),
        assetTotal: utils.ensureUint64(params.assetConfigParams.total ?? 0),
        assetDecimals: utils.ensureSafeUnsignedInteger(
          params.assetConfigParams.decimals ?? 0
        ),
        assetDefaultFrozen: ensureBoolean(
          params.assetConfigParams.defaultFrozen ?? false
        ),
        assetManager: optionalAddress(params.assetConfigParams.manager),
        assetReserve: optionalAddress(params.assetConfigParams.reserve),
        assetFreeze: optionalAddress(params.assetConfigParams.freeze),
        assetClawback: optionalAddress(params.assetConfigParams.clawback),
        assetUnitName: params.assetConfigParams.unitName ?? '',
        assetName: params.assetConfigParams.assetName ?? '',
        assetURL: params.assetConfigParams.assetURL ?? '',
        assetMetadataHash: optionalFixedLengthByteArray(
          params.assetConfigParams.assetMetadataHash,
          ASSET_METADATA_HASH_LENGTH,
          'assetMetadataHash'
        ),
      };
    }

    if (params.assetTransferParams) {
      this.assetTransfer = {
        assetId: utils.ensureUint64(params.assetTransferParams.assetIndex),
        amount: utils.ensureUint64(params.assetTransferParams.amount),
        sender: optionalAddress(params.assetTransferParams.assetSender),
        receiver: ensureAddress(params.assetTransferParams.receiver),
        closeRemainderTo: optionalAddress(
          params.assetTransferParams.closeRemainderTo
        ),
      };
    }

    if (params.assetFreezeParams) {
      this.assetFreeze = {
        assetId: utils.ensureUint64(params.assetFreezeParams.assetIndex),
        freezeAccount: ensureAddress(params.assetFreezeParams.freezeTarget),
        assetFrozen: ensureBoolean(params.assetFreezeParams.assetFrozen),
      };
    }

    if (params.appCallParams) {
      this.applicationCall = {
        appId: utils.ensureUint64(params.appCallParams.appId),
        appOnComplete: params.appCallParams.onComplete, // TODO: verify
        appLocalInts: utils.ensureSafeUnsignedInteger(
          params.appCallParams.numLocalInts ?? 0
        ),
        appLocalByteSlices: utils.ensureSafeUnsignedInteger(
          params.appCallParams.numLocalByteSlices ?? 0
        ),
        appGlobalInts: utils.ensureSafeUnsignedInteger(
          params.appCallParams.numGlobalInts ?? 0
        ),
        appGlobalByteSlices: utils.ensureSafeUnsignedInteger(
          params.appCallParams.numGlobalByteSlices ?? 0
        ),
        extraPages: utils.ensureSafeUnsignedInteger(
          params.appCallParams.extraPages ?? 0
        ),
        appApprovalProgram: ensureUint8Array(
          params.appCallParams.approvalProgram ?? new Uint8Array()
        ),
        appClearProgram: ensureUint8Array(
          params.appCallParams.clearProgram ?? new Uint8Array()
        ),
        appArgs: ensureArray(params.appCallParams.appArgs ?? []).map(
          ensureUint8Array
        ),
        appAccounts: ensureArray(params.appCallParams.accounts ?? []).map(
          ensureAddress
        ),
        appForeignApps: ensureArray(params.appCallParams.foreignApps ?? []).map(
          utils.ensureUint64
        ),
        appForeignAssets: ensureArray(
          params.appCallParams.foreignAssets ?? []
        ).map(utils.ensureUint64),
        boxes: ensureArray(params.appCallParams.boxes ?? []).map(
          ensureBoxReference
        ),
      };
    }

    if (params.stateProofParams) {
      this.stateProof = {
        stateProofType: utils.ensureSafeUnsignedInteger(
          params.stateProofParams.stateProofType ?? 0
        ),
        stateProof: ensureUint8Array(
          params.stateProofParams.stateProof ?? new Uint8Array()
        ),
        stateProofMessage: ensureUint8Array(
          params.stateProofParams.stateProofMessage ?? new Uint8Array()
        ),
      };
    }

    // Determine fee
    this.fee = utils.ensureUint64(params.suggestedParams.fee);

    const feeDependsOnSize = !ensureBoolean(
      params.suggestedParams.flatFee ?? false
    );
    if (feeDependsOnSize) {
      const minFee = utils.ensureUint64(params.suggestedParams.minFee);
      this.fee *= BigInt(this.estimateSize());
      // If suggested fee too small and will be rejected, set to min tx fee
      if (this.fee < minFee) {
        this.fee = minFee;
      }
    }
  }

  // eslint-disable-next-line camelcase
  get_obj_for_encoding(): EncodedTransaction {
    const forEncoding: EncodedTransaction = {
      type: this.type,
      gh: this.genesisHash,
      lv: this.lastValid,
    };
    if (!uint8ArrayIsEmpty(this.sender.publicKey)) {
      forEncoding.snd = this.sender.publicKey;
    }
    if (this.genesisID) {
      forEncoding.gen = this.genesisID;
    }
    if (this.fee) {
      forEncoding.fee = this.fee;
    }
    if (this.firstValid) {
      forEncoding.fv = this.firstValid;
    }
    if (this.note.length) {
      forEncoding.note = this.note;
    }
    if (this.lease) {
      forEncoding.lx = this.lease;
    }
    if (this.rekeyTo) {
      forEncoding.rekey = this.rekeyTo.publicKey;
    }
    if (this.group.length) {
      forEncoding.grp = this.group;
    }

    if (this.payment) {
      if (this.payment.amount) {
        forEncoding.amt = this.payment.amount;
      }
      if (!uint8ArrayIsEmpty(this.payment.receiver.publicKey)) {
        forEncoding.rcv = this.payment.receiver.publicKey;
      }
      if (this.payment.closeRemainderTo) {
        forEncoding.close = this.payment.closeRemainderTo.publicKey;
      }
      return forEncoding;
    }

    if (this.keyreg) {
      if (this.keyreg.voteKey) {
        forEncoding.votekey = this.keyreg.voteKey;
      }
      if (this.keyreg.selectionKey) {
        forEncoding.selkey = this.keyreg.selectionKey;
      }
      if (this.keyreg.stateProofKey) {
        forEncoding.sprfkey = this.keyreg.stateProofKey;
      }
      if (this.keyreg.voteFirst) {
        forEncoding.votefst = this.keyreg.voteFirst;
      }
      if (this.keyreg.voteLast) {
        forEncoding.votelst = this.keyreg.voteLast;
      }
      if (this.keyreg.voteKeyDilution) {
        forEncoding.votekd = this.keyreg.voteKeyDilution;
      }
      if (this.keyreg.nonParticipation) {
        forEncoding.nonpart = this.keyreg.nonParticipation;
      }
      return forEncoding;
    }

    if (this.assetConfig) {
      if (this.assetConfig.assetId) {
        forEncoding.caid = this.assetConfig.assetId;
      }
      const assetParams: EncodedAssetParams = {};
      if (this.assetConfig.assetTotal) {
        assetParams.t = this.assetConfig.assetTotal;
      }
      if (this.assetConfig.assetDecimals) {
        assetParams.dc = this.assetConfig.assetDecimals;
      }
      if (this.assetConfig.assetDefaultFrozen) {
        assetParams.df = this.assetConfig.assetDefaultFrozen;
      }
      if (this.assetConfig.assetManager) {
        assetParams.m = this.assetConfig.assetManager.publicKey;
      }
      if (this.assetConfig.assetReserve) {
        assetParams.r = this.assetConfig.assetReserve.publicKey;
      }
      if (this.assetConfig.assetFreeze) {
        assetParams.f = this.assetConfig.assetFreeze.publicKey;
      }
      if (this.assetConfig.assetClawback) {
        assetParams.c = this.assetConfig.assetClawback.publicKey;
      }
      if (this.assetConfig.assetUnitName) {
        assetParams.un = this.assetConfig.assetUnitName;
      }
      if (this.assetConfig.assetName) {
        assetParams.an = this.assetConfig.assetName;
      }
      if (this.assetConfig.assetURL) {
        assetParams.au = this.assetConfig.assetURL;
      }
      if (this.assetConfig.assetMetadataHash) {
        assetParams.am = this.assetConfig.assetMetadataHash;
      }
      if (Object.keys(assetParams).length) {
        forEncoding.apar = assetParams;
      }
      return forEncoding;
    }

    if (this.assetTransfer) {
      if (this.assetTransfer.assetId) {
        forEncoding.xaid = this.assetTransfer.assetId;
      }
      if (this.assetTransfer.amount) {
        forEncoding.aamt = this.assetTransfer.amount;
      }
      if (!uint8ArrayIsEmpty(this.assetTransfer.receiver.publicKey)) {
        forEncoding.arcv = this.assetTransfer.receiver.publicKey;
      }
      if (this.assetTransfer.closeRemainderTo) {
        forEncoding.aclose = this.assetTransfer.closeRemainderTo.publicKey;
      }
      if (this.assetTransfer.sender) {
        forEncoding.asnd = this.assetTransfer.sender.publicKey;
      }
      return forEncoding;
    }

    if (this.assetFreeze) {
      if (this.assetFreeze.assetId) {
        forEncoding.faid = this.assetFreeze.assetId;
      }
      if (this.assetFreeze.assetFrozen) {
        forEncoding.afrz = this.assetFreeze.assetFrozen;
      }
      if (!uint8ArrayIsEmpty(this.assetFreeze.freezeAccount.publicKey)) {
        forEncoding.fadd = this.assetFreeze.freezeAccount.publicKey;
      }
      return forEncoding;
    }

    if (this.applicationCall) {
      if (this.applicationCall.appId) {
        forEncoding.apid = this.applicationCall.appId;
      }
      if (this.applicationCall.appOnComplete) {
        forEncoding.apan = this.applicationCall.appOnComplete;
      }
      if (this.applicationCall.appArgs.length) {
        forEncoding.apaa = this.applicationCall.appArgs.slice();
      }
      if (this.applicationCall.appAccounts.length) {
        forEncoding.apat = this.applicationCall.appAccounts.map(
          (decodedAddress) => decodedAddress.publicKey
        );
      }
      if (this.applicationCall.appForeignAssets.length) {
        forEncoding.apas = this.applicationCall.appForeignAssets.slice();
      }
      if (this.applicationCall.appForeignApps.length) {
        forEncoding.apfa = this.applicationCall.appForeignApps.slice();
      }
      if (this.applicationCall.boxes.length) {
        forEncoding.apbx = translateBoxReferences(
          this.applicationCall.boxes,
          this.applicationCall.appForeignApps,
          this.applicationCall.appId
        );
      }
      if (this.applicationCall.appApprovalProgram.length) {
        forEncoding.apap = this.applicationCall.appApprovalProgram;
      }
      if (this.applicationCall.appClearProgram.length) {
        forEncoding.apsu = this.applicationCall.appClearProgram;
      }
      if (
        this.applicationCall.appLocalInts ||
        this.applicationCall.appLocalByteSlices
      ) {
        const localSchema: EncodedLocalStateSchema = {};
        if (this.applicationCall.appLocalInts) {
          localSchema.nui = this.applicationCall.appLocalInts;
        }
        if (this.applicationCall.appLocalByteSlices) {
          localSchema.nbs = this.applicationCall.appLocalByteSlices;
        }
        forEncoding.apls = localSchema;
      }
      if (
        this.applicationCall.appGlobalInts ||
        this.applicationCall.appGlobalByteSlices
      ) {
        const globalSchema: EncodedGlobalStateSchema = {};
        if (this.applicationCall.appGlobalInts) {
          globalSchema.nui = this.applicationCall.appGlobalInts;
        }
        if (this.applicationCall.appGlobalByteSlices) {
          globalSchema.nbs = this.applicationCall.appGlobalByteSlices;
        }
        forEncoding.apgs = globalSchema;
      }
      if (this.applicationCall.extraPages) {
        forEncoding.apep = this.applicationCall.extraPages;
      }
      return forEncoding;
    }

    if (this.stateProof) {
      if (this.stateProof.stateProofType) {
        forEncoding.sptype = this.stateProof.stateProofType;
      }
      forEncoding.spmsg = this.stateProof.stateProofMessage;
      forEncoding.sp = this.stateProof.stateProof;
      return forEncoding;
    }

    throw new Error(`Unexpected transaction type: ${this.type}`);
  }

  // eslint-disable-next-line camelcase
  static from_obj_for_encoding(txnForEnc: EncodedTransaction): Transaction {
    const suggestedParams: SuggestedParams = {
      minFee: BigInt(0),
      flatFee: true,
      fee: txnForEnc.fee ?? 0,
      firstValid: txnForEnc.fv ?? 0,
      lastValid: txnForEnc.lv,
      genesisHash: bytesToBase64(txnForEnc.gh), // TODO: would like to avoid encoding/decoding here
      genesisID: txnForEnc.gen,
    };

    if (!isTransactionType(txnForEnc.type)) {
      throw new Error(`Unrecognized transaction type: ${txnForEnc.type}`);
    }

    const params: TransactionParams = {
      type: txnForEnc.type,
      sender: txnForEnc.snd
        ? address.encodeAddress(txnForEnc.snd)
        : address.ALGORAND_ZERO_ADDRESS_STRING,
      note: txnForEnc.note,
      lease: txnForEnc.lx,
      suggestedParams,
    };

    if (txnForEnc.rekey) {
      params.rekeyTo = address.encodeAddress(txnForEnc.rekey);
    }

    if (params.type === TransactionType.pay) {
      const paymentParams: PaymentTransactionParams = {
        amount: txnForEnc.amt ?? 0,
        receiver: txnForEnc.rcv
          ? address.encodeAddress(txnForEnc.rcv)
          : address.ALGORAND_ZERO_ADDRESS_STRING,
      };
      if (txnForEnc.close) {
        paymentParams.closeRemainderTo = address.encodeAddress(txnForEnc.close);
      }
      params.paymentParams = paymentParams;
    } else if (params.type === TransactionType.keyreg) {
      const keyregParams: KeyRegistrationTransactionParams = {
        voteKey: txnForEnc.votekey,
        selectionKey: txnForEnc.selkey,
        stateProofKey: txnForEnc.sprfkey,
        voteFirst: txnForEnc.votefst,
        voteLast: txnForEnc.votelst,
        voteKeyDilution: txnForEnc.votekd,
        nonParticipation: txnForEnc.nonpart,
      };
      params.keyregParams = keyregParams;
    } else if (params.type === TransactionType.acfg) {
      const assetConfigParams: AssetConfigurationTransactionParams = {
        assetIndex: txnForEnc.caid,
      };
      if (txnForEnc.apar) {
        assetConfigParams.total = txnForEnc.apar.t;
        assetConfigParams.decimals = txnForEnc.apar.dc;
        assetConfigParams.defaultFrozen = txnForEnc.apar.df;
        assetConfigParams.unitName = txnForEnc.apar.un;
        assetConfigParams.assetName = txnForEnc.apar.an;
        assetConfigParams.assetURL = txnForEnc.apar.au;
        assetConfigParams.assetMetadataHash = txnForEnc.apar.am;
        if (txnForEnc.apar.m) {
          assetConfigParams.manager = address.encodeAddress(txnForEnc.apar.m);
        }
        if (txnForEnc.apar.r) {
          assetConfigParams.reserve = address.encodeAddress(txnForEnc.apar.r);
        }
        if (txnForEnc.apar.f) {
          assetConfigParams.freeze = address.encodeAddress(txnForEnc.apar.f);
        }
        if (txnForEnc.apar.c) {
          assetConfigParams.clawback = address.encodeAddress(txnForEnc.apar.c);
        }
      }
      params.assetConfigParams = assetConfigParams;
    } else if (params.type === TransactionType.axfer) {
      const assetTransferParams: AssetTransferTransactionParams = {
        assetIndex: txnForEnc.xaid ?? 0,
        amount: txnForEnc.aamt ?? 0,
        receiver: txnForEnc.arcv
          ? address.encodeAddress(txnForEnc.arcv)
          : address.ALGORAND_ZERO_ADDRESS_STRING,
      };
      if (txnForEnc.aclose) {
        assetTransferParams.closeRemainderTo = address.encodeAddress(
          txnForEnc.aclose
        );
      }
      if (txnForEnc.asnd) {
        assetTransferParams.assetSender = address.encodeAddress(txnForEnc.asnd);
      }
      params.assetTransferParams = assetTransferParams;
    } else if (params.type === TransactionType.afrz) {
      const assetFreezeParams: AssetFreezeTransactionParams = {
        assetIndex: txnForEnc.faid ?? 0,
        freezeTarget: txnForEnc.fadd
          ? address.encodeAddress(txnForEnc.fadd)
          : address.ALGORAND_ZERO_ADDRESS_STRING,
        assetFrozen: txnForEnc.afrz ?? false,
      };
      params.assetFreezeParams = assetFreezeParams;
    } else if (params.type === TransactionType.appl) {
      const appCallParams: ApplicationCallTransactionParams = {
        appId: txnForEnc.apid ?? 0,
        onComplete: utils.ensureSafeUnsignedInteger(txnForEnc.apan ?? 0),
        appArgs: txnForEnc.apaa,
        accounts: (txnForEnc.apat ?? []).map(address.encodeAddress),
        foreignAssets: txnForEnc.apas,
        foreignApps: txnForEnc.apfa,
        approvalProgram: txnForEnc.apap,
        clearProgram: txnForEnc.apsu,
        numLocalInts: txnForEnc.apls?.nui,
        numLocalByteSlices: txnForEnc.apls?.nbs,
        numGlobalInts: txnForEnc.apgs?.nui,
        numGlobalByteSlices: txnForEnc.apgs?.nbs,
        extraPages: txnForEnc.apep,
      };
      if (txnForEnc.apbx) {
        appCallParams.boxes = txnForEnc.apbx.map((box) => {
          const index = utils.ensureSafeUnsignedInteger(box.i ?? 0);
          const name = box.n ?? new Uint8Array();
          if (index === 0) {
            // We return 0 for the app ID so that it's guaranteed translateBoxReferences will
            // translate the app index back to 0. If we instead returned the called app ID,
            // translateBoxReferences would translate the app index to a nonzero value if the called
            // app is also in the foreign app array.
            return {
              appIndex: 0,
              name,
            };
          }
          if (
            !appCallParams.foreignApps ||
            index > appCallParams.foreignApps.length
          ) {
            throw new Error(
              `Cannot find foreign app index ${index} in ${appCallParams.foreignApps}`
            );
          }
          return {
            appIndex: appCallParams.foreignApps[index - 1],
            name,
          };
        });
      }
      params.appCallParams = appCallParams;
    } else if (params.type === TransactionType.stpf) {
      const stateProofParams: StateProofTransactionParams = {
        stateProofType: txnForEnc.sptype,
        stateProof: txnForEnc.sp,
        stateProofMessage: txnForEnc.spmsg,
      };
      params.stateProofParams = stateProofParams;
    } else {
      const exhaustiveCheck: never = params.type;
      throw new Error(`Unexpected transaction type: ${exhaustiveCheck}`);
    }

    const txn = new Transaction(params);

    if (txnForEnc.grp) {
      const group = ensureUint8Array(txnForEnc.grp);
      if (group.byteLength !== ALGORAND_TRANSACTION_GROUP_LENGTH) {
        throw new Error(`Invalid group length: ${group.byteLength}`);
      }
      txn.group = group;
    }

    return txn;
  }

  private estimateSize() {
    return this.toByte().length + NUM_ADDL_BYTES_AFTER_SIGNING;
  }

  bytesToSign() {
    const encodedMsg = this.toByte();
    return utils.concatArrays(TX_TAG, encodedMsg);
  }

  toByte() {
    return encoding.encode(this.get_obj_for_encoding());
  }

  // returns the raw signature
  rawSignTxn(sk: Uint8Array): Uint8Array {
    const toBeSigned = this.bytesToSign();
    const sig = nacl.sign(toBeSigned, sk);
    return sig;
  }

  signTxn(sk: Uint8Array): Uint8Array {
    // construct signed message
    const sTxn: EncodedSignedTransaction = {
      sig: this.rawSignTxn(sk),
      txn: this.get_obj_for_encoding(),
    };
    // add AuthAddr if signing with a different key than sender indicates
    const keypair = nacl.keyPairFromSecretKey(sk);
    const pubKeyFromSk = keypair.publicKey;
    if (
      address.encodeAddress(pubKeyFromSk) !==
      address.encodeAddress(this.sender.publicKey)
    ) {
      sTxn.sgnr = pubKeyFromSk;
    }
    return new Uint8Array(encoding.encode(sTxn));
  }

  attachSignature(signerAddr: string, signature: Uint8Array): Uint8Array {
    if (!nacl.isValidSignatureLength(signature.length)) {
      throw new Error('Invalid signature length');
    }
    const sTxn: EncodedSignedTransaction = {
      sig: signature,
      txn: this.get_obj_for_encoding(),
    };
    // add AuthAddr if signing with a different key than From indicates
    if (signerAddr !== address.encodeAddress(this.sender.publicKey)) {
      const signerPublicKey = address.decodeAddress(signerAddr).publicKey;
      sTxn.sgnr = signerPublicKey;
    }
    return new Uint8Array(encoding.encode(sTxn));
  }

  rawTxID(): Uint8Array {
    const enMsg = this.toByte();
    const gh = utils.concatArrays(TX_TAG, enMsg);
    return Uint8Array.from(nacl.genericHash(gh));
  }

  txID(): string {
    const hash = this.rawTxID();
    return base32.encode(hash).slice(0, ALGORAND_TRANSACTION_LENGTH);
  }
}

/**
 * encodeUnsignedSimulateTransaction takes a txnBuilder.Transaction object,
 * converts it into a SignedTransaction-like object, and converts it to a Buffer.
 *
 * Note: this function should only be used to simulate unsigned transactions.
 *
 * @param transactionObject - Transaction object to simulate.
 */
export function encodeUnsignedSimulateTransaction(
  transactionObject: Transaction
) {
  const objToEncode: EncodedSignedTransaction = {
    txn: transactionObject.get_obj_for_encoding(),
  };
  return encoding.encode(objToEncode);
}

/**
 * encodeUnsignedTransaction takes a completed txnBuilder.Transaction object, such as from the makeFoo
 * family of transactions, and converts it to a Buffer
 * @param transactionObject - the completed Transaction object
 */
export function encodeUnsignedTransaction(transactionObject: Transaction) {
  const objToEncode = transactionObject.get_obj_for_encoding();
  return encoding.encode(objToEncode);
}

/**
 * decodeUnsignedTransaction takes a Uint8Array (as if from encodeUnsignedTransaction) and converts it to a txnBuilder.Transaction object
 * @param transactionBuffer - the Uint8Array containing a transaction
 */
export function decodeUnsignedTransaction(
  transactionBuffer: ArrayLike<number>
) {
  const partlyDecodedObject = encoding.decode(
    transactionBuffer
  ) as EncodedTransaction;
  return Transaction.from_obj_for_encoding(partlyDecodedObject);
}

/**
 * Object representing a transaction with a signature
 */
export interface SignedTransaction {
  /**
   * Transaction signature
   */
  sig?: Uint8Array;

  /**
   * The transaction that was signed
   */
  txn: Transaction;

  /**
   * Multisig structure
   */
  msig?: EncodedMultisig;

  /**
   * Logic signature
   */
  lsig?: EncodedLogicSig;

  /**
   * The signer, if signing with a different key than the Transaction type `sender` property indicates
   */
  sgnr?: Uint8Array;
}

/**
 * decodeSignedTransaction takes a Uint8Array (from transaction.signTxn) and converts it to an object
 * containing the Transaction (txn), the signature (sig), and the auth-addr field if applicable (sgnr)
 * @param transactionBuffer - the Uint8Array containing a transaction
 * @returns containing a Transaction, the signature, and possibly an auth-addr field
 */
export function decodeSignedTransaction(
  transactionBuffer: Uint8Array
): SignedTransaction {
  const stxnDecoded = encoding.decode(
    transactionBuffer
  ) as EncodedSignedTransaction;
  const stxn: SignedTransaction = {
    ...stxnDecoded,
    txn: Transaction.from_obj_for_encoding(stxnDecoded.txn),
  };
  return stxn;
}
