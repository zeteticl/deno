// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import * as msg from "gen/msg_generated";
import * as dispatch from "./dispatch";
import { createBuilder } from "./flatbuffers";
import { assert, log } from "./util";

interface CompilationResponse {
  done: boolean;
  filename: string;
}

interface CompilerStartResponse {
  debugFlag: boolean;
  next: CompilationResponse;
  recompileFlag: boolean;
  typesFlag: boolean;
}

/** Send the start message to the privileged side to validated the compiler has
 * started and to get some environment information and its first request to
 * compile a module.
 */
export function compilerStart(): CompilerStartResponse {
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
  const debugFlag = compilerStartRes.debugFlag();
  const recompileFlag = compilerStartRes.recompileFlag();
  const typesFlag = compilerStartRes.typesFlag();
  const filename = compilerStartRes.filename()!;
  assert(filename != null);
  return {
    debugFlag,
    next: {
      done: false,
      filename
    },
    recompileFlag,
    typesFlag
  };
}

/** Passes a compiled module back to the privileged side and gets the next
 * module to compile, or `done` is `true` if there are no further modules and
 * the compiler should exit.
 */
export function compilation(
  outputCode: string,
  sourceMap: string
): CompilationResponse {
  log("compilation:", outputCode.length, sourceMap.length);
  const builder = createBuilder();
  const enc = new TextEncoder();
  const data = enc.encode(outputCode);
  const sourceMap_ = builder.createString(sourceMap);
  msg.Compilation.startCompilation(builder);
  msg.Compilation.addSourceMap(builder, sourceMap_);
  const inner = msg.Compilation.endCompilation(builder);
  const baseRes = dispatch.sendSync(builder, msg.Any.Compilation, inner, data)!;
  assert(baseRes != null);
  assert(msg.Any.CompilationRes === baseRes.innerType());
  const compilationRes = new msg.CompilationRes();
  assert(baseRes!.inner(compilationRes) != null);
  const done = compilationRes.done();
  const filename = compilationRes.filename()!;
  assert(filename != null);
  return { done, filename };
}
