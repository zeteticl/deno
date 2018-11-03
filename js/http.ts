// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import { Closer } from "./io";
import * as msg from "gen/msg_generated";
import { assert } from "./util";
import * as dispatch from "./dispatch";
import * as flatbuffers from "./flatbuffers";
import { close } from "./files";
//import * as domTypes from "./dom_types";

type HttpHandler = (req: {}, res: {}) => void;

export class HttpServer implements Closer {
  private closing = false;
  handler: null | HttpHandler = null;

  constructor(readonly rid: number) {
    assert(rid >= 2);
  }

  async serve(): Promise<void> {
    while (this.closing === false) {
      let t = await httpAccept(this.rid);
      console.log("accepted http connection", t.rid);
      console.log("closing", this.closing);
    }
  }

  close(): void {
    this.closing = true;
    close(this.rid);
  }
}

export function httpServe(address: string, handler: HttpHandler): HttpServer {
  const s = httpListen(address);
  s.handler = handler;
  s.serve();
  return s;
}

function deserializeFields(m: msg.HttpHeader): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < m.fieldsLength(); i++) {
    const item = m.fields(i)!;
    out.push([item.key()!, item.value()!]);
  }
  return out;
}

class Transaction {
  rid: number;
  constructor(httpAcceptRes: msg.HttpAcceptRes) {
    this.rid = httpAcceptRes.transactionRid();
    //assert(this.rid > 2);

    let header = httpAcceptRes.header()!;
    console.log("headers", header);

    let f = deserializeFields(header);
    console.log("header fields", f);
  }
}

async function httpAccept(rid: number): Promise<Transaction> {
  const builder = flatbuffers.createBuilder();
  msg.HttpAccept.startHttpAccept(builder);
  msg.HttpAccept.addListenerRid(builder, rid);
  const inner = msg.HttpAccept.endHttpAccept(builder);
  const baseRes = await dispatch.sendAsync(builder, msg.Any.HttpAccept, inner);
  assert(baseRes != null);
  assert(msg.Any.HttpAcceptRes === baseRes!.innerType());
  const res = new msg.HttpAcceptRes();
  assert(baseRes!.inner(res) != null);
  return new Transaction(res);
}

export function httpListen(address: string): HttpServer {
  const builder = flatbuffers.createBuilder();
  const address_ = builder.createString(address);
  msg.HttpListen.startHttpListen(builder);
  msg.HttpListen.addAddress(builder, address_);
  const inner = msg.HttpListen.endHttpListen(builder);
  const baseRes = dispatch.sendSync(builder, msg.Any.HttpListen, inner);
  assert(baseRes != null);
  assert(msg.Any.HttpListenRes === baseRes!.innerType());
  const res = new msg.HttpListenRes();
  assert(baseRes!.inner(res) != null);
  return new HttpServer(res.rid());
}
