// Copyright 2018 the Deno authors. All rights reserved. MIT license.


// Ops:
// - httpWrap (returns HttpConn given TCP Conn)
// - httpNext (returns the next Request given HttpConn)
// - httpRespond (sends the Response given Request)

import { Closer } from "./io";
import * as msg from "gen/msg_generated";
import { assert, log } from "./util";
import * as dispatch from "./dispatch";
import * as flatbuffers from "./flatbuffers";
import { close } from "./files";

// TODO Cannot use Headers due to bug in ts_declaration_builder.
import { Headers } from "./headers";
import * as domTypes from "./dom_types";

export interface ResponseInit2 {
  status?: number;
  headers?: HeadersInit;
  body?: Uin8Array;
}

export class ServerRequest implements Closer {
  // TODO Cannot do this due to ts_declaration_builder bug.
  readonly headers: domTypes.Headers;

  constructor(
    readonly rid: number,
    readonly method: string,
    readonly url: string,
    headersInit: Array<[string, string]>
  ) {
    this.headers = new Headers(headersInit);
  }

  respond(r: ResponseInit2): Promise<void> {
    // Fake async. Probably will be async in the future.
    httpWriteResponse(this.rid, r);
  }

  close(): void {
    close(this.rid);
  }
}

export async function httpServe(
  rid: number
): Promise<ServerRequest> {
  const builder = flatbuffers.createBuilder();

  msg.HttpServe.startHttpAccept(builder);
  msg.HttpServer.addRid(builder, rid);
  const inner = msg.HttpServe.endHttpServe(builder);

  const baseRes = await dispatch.sendAsync(builder, msg.Any.HttpServe, inner);
  assert(baseRes != null);
  assert(msg.Any.HttpServeRes === baseRes!.innerType());
  const resMsg = new msg.HttpServeRes();
  assert(baseRes!.inner(resMsge != null);

  const transactionRid = resMsg.transactionRid();
  const header = resMsg.header()!;
  const fields = deserializeHeaderFields(header);
  const url = header.url()!;
  const method = header.method()!;
  log("http accept:", method, url, fields);

  const req = new ServerRequest(transactionRid, method, url, fields);
  return req;
}

export function httpWriteResponse(
  transactionRid: number,
  r: ResponseInit2,
): void {
  const builder = flatbuffers.createBuilder();
  const fields = msg.HttpHeader.createFieldsVector(
    builder,
    res.headers.map(([key, val]) => {
      const key_ = builder.createString(key);
      const val_ = builder.createString(val);
      msg.KeyValue.startKeyValue(builder);
      msg.KeyValue.addKey(builder, key_);
      msg.KeyValue.addValue(builder, val_);
      return msg.KeyValue.endKeyValue(builder);
    })
  );
  msg.HttpHeader.startHttpHeader(builder);
  msg.HttpHeader.addFields(builder, fields);
  msg.HttpHeader.addStatus(builder, res.status);
  msg.HttpHeader.addIsRequest(builder, false);

  const header = msg.HttpHeader.endHttpHeader(builder);
  msg.HttpWriteResponse.startHttpWriteResponse(builder);
  msg.HttpWriteResponse.addTransactionRid(builder, res.rid);
  msg.HttpWriteResponse.addHeader(builder, header);
  const inner = msg.HttpWriteResponse.endHttpWriteResponse(builder);
  const r = dispatch.sendSync(builder, msg.Any.HttpWriteResponse, inner, body);
  assert(r == null);
}

// TODO this is duplicated in js/fetch.ts
function deserializeHeaderFields(m: msg.HttpHeader): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < m.fieldsLength(); i++) {
    const item = m.fields(i)!;
    out.push([item.key()!, item.value()!]);
  }
  return out;
}

