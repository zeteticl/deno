// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import "./globals"; // imported for side-effects

import * as msg from "gen/msg_generated";
import { createBuilder } from "./flatbuffers";
import * as dispatch from "./dispatch";
import { libdeno } from "./libdeno";
import { exit as osExit } from "./os";
import { promiseErrorExaminer, promiseRejectHandler } from "./promise_util";
import { assert, log, setLogDebug } from "./util";
// import { TextEncoder, TextDecoder } from "./text_encoding";

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
  osExit(1);
}

interface CompilationResponse {
  done: boolean;
  filename: string;
  sourceCode: string;
}

function getFilenameSource(
  msg: msg.CompilerStartRes | msg.CompilationRes
): { filename: string; sourceCode: string } {
  const dec = new TextDecoder();
  const filename = msg.filename()!;
  assert(filename != null);
  const dataArray = msg.dataArray();
  assert(dataArray != null);
  const sourceCode = dec.decode(dataArray!);
  return { filename, sourceCode };
}

interface CompilerStartResponse {
  debugFlag: boolean;
  next: CompilationResponse;
  recompileFlag: boolean;
}

function sendCompilerStart(): CompilerStartResponse {
  const builder = createBuilder();
  msg.CompilerStart.startCompilerStart(builder);
  const startOffset = msg.Start.endStart(builder);
  const baseRes = dispatch.sendSync(
    builder,
    msg.Any.CompilerStart,
    startOffset
  );
  assert(baseRes != null);
  assert(msg.Any.CompilerStartRes === baseRes!.innerType());
  const compilerStartRes = new msg.CompilerStartRes();
  assert(baseRes!.inner(compilerStartRes) != null);
  const recompileFlag = compilerStartRes.recompileFlag();
  const debugFlag = compilerStartRes.debugFlag();
  const { filename, sourceCode } = getFilenameSource(compilerStartRes);
  return {
    debugFlag,
    next: {
      done: false,
      filename,
      sourceCode
    },
    recompileFlag
  };
}

async function compilation(
  outputCode: string,
  sourceMap: string
): Promise<CompilationResponse> {
  log("compilation:", outputCode.length, sourceMap.length);
  const builder = createBuilder();
  const enc = new TextEncoder();
  const data = enc.encode(outputCode);
  const sourceMap_ = builder.createString(sourceMap);
  msg.Compilation.startCompilation(builder);
  msg.Compilation.addSourceMap(builder, sourceMap_);
  const inner = msg.Compilation.endCompilation(builder);
  const baseRes = await dispatch.sendAsync(
    builder,
    msg.Any.Compilation,
    inner,
    data
  );
  assert(msg.Any.CompilationRes === baseRes.innerType());
  const compilationRes = new msg.CompilationRes();
  assert(baseRes!.inner(compilationRes) != null);
  const done = compilationRes.done();
  const { filename, sourceCode } = getFilenameSource(compilationRes);
  return { done, filename, sourceCode };
}

/* tslint:disable-next-line:no-default-export */
export default async function compilerMain() {
  libdeno.recv(dispatch.handleAsyncMsgFromRust);
  libdeno.setGlobalErrorHandler(onGlobalError);
  libdeno.setPromiseRejectHandler(promiseRejectHandler);
  libdeno.setPromiseErrorExaminer(promiseErrorExaminer);

  let done = false;
  const startResponse = sendCompilerStart();
  const { debugFlag } = startResponse;
  setLogDebug(debugFlag);
  let { next } = startResponse;
  let count = 0;

  while (!done) {
    const { filename, sourceCode } = next;
    console.log("compile: ", filename);
    console.log(sourceCode);
    count++;
    next = await compilation("'outputCode';", `{"count":${count}}`);
    done = next.done;
  }
  console.log("done");
}
