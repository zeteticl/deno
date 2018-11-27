// Copyright 2018 the Deno authors. All rights reserved. MIT license.

import * as msg from "gen/msg_generated";
import * as dispatch from "./dispatch";
import { createBuilder } from "./flatbuffers";
import { assert, log } from "./util";

interface GetSourceResponse {
  sourceCode: string;
  mediaType: msg.MediaType;
}

/** Retrieve a module's filename based on a specifier and a containing file */
export function getFilename(
  moduleSpecifier: string,
  containingFile: string
): string {
  log("moduleFilename:", { moduleSpecifier, containingFile });
  const builder = createBuilder();
  const moduleSpecifier_ = builder.createString(moduleSpecifier);
  const containingFile_ = builder.createString(containingFile);
  msg.ModuleFilename.startModuleFilename(builder);
  msg.ModuleFilename.addModuleSpecifier(builder, moduleSpecifier_);
  msg.ModuleFilename.addContainingFile(builder, containingFile_);
  const inner = msg.ModuleFilename.endModuleFilename(builder);
  const baseRes = dispatch.sendSync(builder, msg.Any.ModuleFilename, inner)!;
  assert(baseRes != null);
  assert(msg.Any.ModuleFilenameRes === baseRes.innerType());
  const moduleFilenameRes = new msg.ModuleFilenameRes();
  assert(baseRes!.inner(moduleFilenameRes) != null);
  const filename = moduleFilenameRes.filename()!;
  assert(filename != null);
  return filename;
}

/** Retrieve the compiled code for a module given its filename. */
export function getOutput(filename: string): string {
  log("moduleCodeFetch:", filename);
  const dec = new TextDecoder();
  const builder = createBuilder();
  const filename_ = builder.createString(filename);
  msg.ModuleCodeFetch.startModuleCodeFetch(builder);
  msg.ModuleCodeFetch.addFilename(builder, filename_);
  const inner = msg.ModuleCodeFetch.endModuleCodeFetch(builder);
  const baseRes = dispatch.sendSync(builder, msg.Any.ModuleCodeFetch, inner)!;
  assert(baseRes != null);
  assert(msg.Any.ModuleCodeFetchRes === baseRes.innerType());
  const moduleCodeFetchRes = new msg.ModuleCodeFetchRes();
  assert(baseRes!.inner(moduleCodeFetchRes) != null);
  const dataArray = moduleCodeFetchRes.dataArray()!;
  assert(dataArray != null);
  return dec.decode(dataArray);
}

/** Retrieve the source and the media type for a module given its filename. */
export function getSource(filename: string): GetSourceResponse {
  log("moduleSourceFetch:", filename);
  const dec = new TextDecoder();
  const builder = createBuilder();
  const filename_ = builder.createString(filename);
  msg.ModuleSourceFetch.startModuleSourceFetch(builder);
  msg.ModuleSourceFetch.addFilename(builder, filename_);
  const inner = msg.ModuleSourceFetch.endModuleSourceFetch(builder);
  const baseRes = dispatch.sendSync(builder, msg.Any.ModuleSourceFetch, inner)!;
  assert(baseRes != null);
  assert(msg.Any.ModuleSourceFetchRes === baseRes.innerType());
  const moduleSourceFetchRes = new msg.ModuleSourceFetchRes();
  assert(baseRes!.inner(moduleSourceFetchRes) != null);
  const mediaType = moduleSourceFetchRes.mediaType();
  const dataArray = moduleSourceFetchRes.dataArray()!;
  assert(dataArray != null);
  return {
    mediaType,
    sourceCode: dec.decode(dataArray)
  };
}
