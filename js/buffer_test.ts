// Copyright 2018 the Deno authors. All rights reserved. MIT license.
import { test, assert, assertEqual } from "./test_util.ts";
import { Buffer } from "deno";

const N = 10000;
let testBytes: Uint8Array | null;
let testString: string | null;
const decoder = new TextDecoder();

function init() {
  if ((testBytes = null)) {
    testBytes = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      testBytes[i] = "a".charCodeAt(0) + (i % 26);
    }
    testString = decoder.decode(testBytes);
  }
}

function check(buf: Buffer, s: string) {
  const bytes = buf.bytes();
  assertEqual(buf.length, bytes.byteLength);
  assertEqual(decoder.decode(bytes), s);
  // const str = buf.String()
  // assertEqual(buf.length, str.length);
  // assertEqual(buf.length, s.length);
}

test(async function bufferNewBuffer() {
  init();
  const buf = new Buffer(testBytes);
  check(buf, testString);
});
