// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import { Closer } from "./io";
import * as msg from "gen/msg_generated";
import { assert } from "./util";
import * as dispatch from "./dispatch";
import * as flatbuffers from "./flatbuffers";
import { close } from "./files";
//import * as headers from "./headers";
//import * as domTypes from "./dom_types";

type HttpHandler = (req: ServerRequest, res: ServerResponse) => void;

export class HttpServer implements Closer {
  private closing = false;

  constructor(readonly rid: number) {
    assert(rid >= 2);
  }

  async serve(handler: HttpHandler): Promise<void> {
    while (this.closing === false) {
      let [req, res] = await httpAccept(this.rid);
      console.log("accepted http connection");
      handler(req, res);
    }
  }

  close(): void {
    this.closing = true;
    close(this.rid);
  }
}

export function httpServe(address: string, handler: HttpHandler): HttpServer {
  const s = httpListen(address);
  s.serve(handler);
  return s;
}

function deserializeHeaderFields(m: msg.HttpHeader): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < m.fieldsLength(); i++) {
    const item = m.fields(i)!;
    out.push([item.key()!, item.value()!]);
  }
  return out;
}

class ServerRequest /* TODO implements domTypes.Request */ {
  rid: number;
  readonly method: string;
  readonly url: string;
  //readonly headers: domTypes.Headers;

  /*
  // Unsupported.
  readonly body: domTypes.ReadableStream | null;
  readonly cache: domTypes.RequestCache = "default";
  readonly credentials: domTypes.RequestCredentials = "omit";
  readonly destination: domTypes.RequestDestination = "";
  readonly integrity: string = "";
  readonly isHistoryNavigation: boolean = false;
  readonly isReloadNavigation: boolean = false;
  readonly keepalive: boolean = false;
  readonly mode: domTypes.RequestMode = "navigate";
  readonly redirect: domTypes.RequestRedirect;
  readonly referrer: string;
  readonly referrerPolicy: domTypes.ReferrerPolicy;
  readonly signal: domTypes.AbortSignal;
   */

  constructor(m: msg.HttpAcceptRes) {
    this.rid = m.transactionRid();

    let header = m.header()!;
    let fields = deserializeHeaderFields(header);
    console.log(fields)
    //this.headers = new Headers(fields);
    this.url = header.url()!;
    this.method = header.method()!;
  }

  /*
  clone(): Request {
    return notImplemented();
  }

  readonly body: domTypes.ReadableStream | null = null;
  readonly bodyUsed: boolean = false;
  arrayBuffer(): Promise<ArrayBuffer> {
    return notImplemented();
  }
  blob(): Promise<Blob> {
    return notImplemented();
  }
  formData(): Promise<FormData> {
    return notImplemented();
  }
  json(): Promise<any> {
    return notImplemented();
  }
  text(): Promise<string> {
    return notImplemented();
  }
  */
}

class ServerResponse /* TODO implements domTypes.Response */ {
  rid: number;

  //readonly headers: domTypes.Headers;
  /*
  readonly ok: boolean = false;
  readonly redirected: boolean = false;
  readonly status: number = 500;
  readonly statusText: string = "";
  readonly trailer: Promise<Headers>;
  readonly type: domTypes.ResponseType = "basic";
  readonly url: string;
  */

  constructor(m: msg.HttpAcceptRes) {
    this.rid = m.transactionRid();
    //this.headers = new headers.Headers();
  }

  /*
  clone(): domTypes.Response {
    return notImplemented();
  }
  */
}

async function httpAccept(
  rid: number
): Promise<[ServerRequest, ServerResponse]> {
  const builder = flatbuffers.createBuilder();
  msg.HttpAccept.startHttpAccept(builder);
  msg.HttpAccept.addListenerRid(builder, rid);
  const inner = msg.HttpAccept.endHttpAccept(builder);
  const baseRes = await dispatch.sendAsync(builder, msg.Any.HttpAccept, inner);
  assert(baseRes != null);
  assert(msg.Any.HttpAcceptRes === baseRes!.innerType());
  const acceptResMsg = new msg.HttpAcceptRes();
  assert(baseRes!.inner(acceptResMsg) != null);
  let req = new ServerRequest(acceptResMsg);
  let res = new ServerResponse(acceptResMsg);
  return [req, res];
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
