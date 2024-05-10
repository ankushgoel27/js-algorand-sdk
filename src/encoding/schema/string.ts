import { Schema, MsgpackEncodingData, JSONEncodingData } from '../encoding.js';

/* eslint-disable class-methods-use-this */

export class StringSchema extends Schema {
  public defaultValue(): string {
    return '';
  }

  public isDefaultValue(data: unknown): boolean {
    return data === '';
  }

  public prepareMsgpack(data: unknown): MsgpackEncodingData {
    if (typeof data === 'string') {
      return data;
    }
    throw new Error(`Invalid string: (${typeof data}) ${data}`);
  }

  public fromPreparedMsgpack(encoded: MsgpackEncodingData): string {
    if (typeof encoded === 'string') {
      return encoded;
    }
    throw new Error(`Invalid string: (${typeof encoded}) ${encoded}`);
  }

  public prepareJSON(data: unknown): JSONEncodingData {
    if (typeof data === 'string') {
      return data;
    }
    throw new Error(`Invalid string: (${typeof data}) ${data}`);
  }

  public fromPreparedJSON(encoded: JSONEncodingData): string {
    if (typeof encoded === 'string') {
      return encoded;
    }
    throw new Error(`Invalid string: (${typeof encoded}) ${encoded}`);
  }
}