// Copyright 2018 the Deno authors. All rights reserved. MIT license.
// Public deno module.
/// <amd-module name="deno"/>
export {
  env,
  exit,
  FileInfo,
  makeTempDirSync,
  renameSync,
  statSync,
  lstatSync
} from "./os";
export { mkdirSync, mkdir } from "./mkdir";
export {
  Reader,
  ReadResult,
  Writer,
  Closer,
  Seeker,
  ReaderCloser,
  ReadWriteCloser,
  copy
} from "./io";
export { File, open, close, read, write, stdin, stdout, stderr } from "./file";
export { readFileSync, readFile } from "./read_file";
export { writeFileSync, writeFile } from "./write_file";
export { ErrorKind, DenoError } from "./errors";
export { libdeno } from "./libdeno";
export const argv: string[] = [];
