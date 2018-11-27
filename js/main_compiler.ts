// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import "./globals"; // imported for side-effects

import * as codeProvider from "./code_provider";
import { Compiler } from "./compiler";
import { compilerStart, compilation } from "./compiler_ops";
import * as dispatch from "./dispatch";
import { libdeno } from "./libdeno";
import { exit } from "./os";
import { promiseErrorExaminer, promiseRejectHandler } from "./promise_util";
import { log, setLogDebug } from "./util";

function onGlobalError(
  _message: string,
  _source: string,
  _lineno: number,
  _colno: number,
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
export default function compilerMain() {
  libdeno.recv(dispatch.handleAsyncMsgFromRust);
  libdeno.setGlobalErrorHandler(onGlobalError);
  libdeno.setPromiseRejectHandler(promiseRejectHandler);
  libdeno.setPromiseErrorExaminer(promiseErrorExaminer);

  // Create the compiler, and signal it is ready
  const compiler = new Compiler(codeProvider);
  const startResponse = compilerStart();
  const { debugFlag, typesFlag } = startResponse;
  setLogDebug(debugFlag);

  // handle `--types`
  if (typesFlag) {
    log("--types");
    const defaultLibFileName = compiler.getDefaultLibFileName();
    console.log(compiler.readFile(defaultLibFileName));
    exit(0);
  }

  let done = false;
  let { next } = startResponse;

  while (!done) {
    const { filename } = next;
    const { outputCode, sourceMap } = compiler.compile(filename);
    next = compilation(outputCode, sourceMap);
    done = next.done;
  }
  log("compiler done");
}
