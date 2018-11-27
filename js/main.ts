// Copyright 2018 the Deno authors. All rights reserved. MIT license.
// We need to make sure this module loads, for its side effects.
import "./globals";

import * as flatbuffers from "./flatbuffers";
import * as msg from "gen/msg_generated";
import { assert, log, setLogDebug } from "./util";
import { exit } from "./os";
import * as codeProvider from "./code_provider";
import { Runner } from "./runner";
import { libdeno } from "./libdeno";
import { args } from "./deno";
import { sendSync, handleAsyncMsgFromRust } from "./dispatch";
import { promiseErrorExaminer, promiseRejectHandler } from "./promise_util";
import { replLoop } from "./repl";

function sendStart(): msg.StartRes {
  const builder = flatbuffers.createBuilder();
  msg.Start.startStart(builder);
  const startOffset = msg.Start.endStart(builder);
  const baseRes = sendSync(builder, msg.Any.Start, startOffset);
  assert(baseRes != null);
  assert(msg.Any.StartRes === baseRes!.innerType());
  const startRes = new msg.StartRes();
  assert(baseRes!.inner(startRes) != null);
  return startRes;
}

function onGlobalError(
  message: string,
  source: string,
  lineno: number,
  colno: number,
  error: any // tslint:disable-line:no-any
) {
  if (error instanceof Error) {
    console.log(error.stack);
  } else {
    console.log(`Thrown: ${String(error)}`);
  }
  exit(1);
}

/* tslint:disable-next-line:no-default-export */
export default function denoMain() {
  libdeno.recv(handleAsyncMsgFromRust);
  libdeno.setGlobalErrorHandler(onGlobalError);
  libdeno.setPromiseRejectHandler(promiseRejectHandler);
  libdeno.setPromiseErrorExaminer(promiseErrorExaminer);

  // First we send an empty "Start" message to let the privileged side know we
  // are ready. The response should be a "StartRes" message containing the CLI
  // args and other info.
  const startResMsg = sendStart();

  setLogDebug(startResMsg.debugFlag());

  // handle `--version`
  if (startResMsg.versionFlag()) {
    console.log("deno:", startResMsg.denoVersion());
    console.log("v8:", startResMsg.v8Version());
    // TODO find another way to determine TypeScript version
    exit(0);
  }

  const cwd = startResMsg.cwd();
  log("cwd", cwd);

  for (let i = 1; i < startResMsg.argvLength(); i++) {
    args.push(startResMsg.argv(i));
  }
  log("args", args);
  Object.freeze(args);
  const inputFn = args[0];

  const runner = new Runner(codeProvider);

  if (inputFn) {
    runner.run(inputFn, `${cwd}/`);
  } else {
    replLoop();
  }
}
