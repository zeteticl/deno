// This code has been ported almost directly from Go's src/bytes/buffer_test.go
// Copyright 2009 The Go Authors. All rights reserved. BSD license.
// https://github.com/golang/go/blob/master/LICENSE
import { test, assert, assertEqual } from "./test_util.ts";
import { Buffer } from "deno";

// const N = 10000;
const N = 100;
let testBytes: Uint8Array | null;
let testString: string | null;

function init() {
  if (testBytes == null) {
    testBytes = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      testBytes[i] = "a".charCodeAt(0) + (i % 26);
    }
    const decoder = new TextDecoder();
    testString = decoder.decode(testBytes);
  }
}

function check(buf: Buffer, s: string) {
  const bytes = buf.bytes();
  //console.log("bytes", bytes);
  //console.log("bytes.byteLength", bytes.byteLength);
  //console.log("buf.length", buf.length);
  assertEqual(buf.length, bytes.byteLength);
  const decoder = new TextDecoder();
  const bytesStr = decoder.decode(bytes);
  //console.log("bytesStr", bytesStr.length);
  assertEqual(bytesStr, s);
  // const str = buf.String()
  // assertEqual(buf.length, str.length);
  // assertEqual(buf.length, s.length);
}

// Empty buf through repeated reads into fub.
// The initial contents of buf corresponds to the string s.
async function empty(buf: Buffer, s: string, fub: Uint8Array): Promise<void> {
  check(buf, s);
  while (true) {
    const r = await buf.read(fub);
    if (r.nread == 0) {
      break;
    }
    s = s.slice(r.nread);
    check(buf, s);
  }
  check(buf, "");
}

test(function bufferNewBuffer() {
  init();
  const buf = new Buffer(testBytes);
  check(buf, testString);
});

test(async function bufferBasicOperations() {
  init();
  let buf = new Buffer();
  for (let i = 0; i < 5; i++) {
    check(buf, "");

    buf.reset();
    check(buf, "");

    buf.truncate(0);
    check(buf, "");

    let n = await buf.write(testBytes.subarray(0, 1));
    assertEqual(n, 1);
    check(buf, "a");

    n = await buf.write(testBytes.subarray(1, 2));
    assertEqual(n, 1);
    check(buf, "ab");

    n = await buf.write(testBytes.subarray(2, 26));
    assertEqual(n, 24);
    check(buf, testString.slice(0, 26));

    buf.truncate(26);
    check(buf, testString.slice(0, 26));

    buf.truncate(20);
    check(buf, testString.slice(0, 20));

    await empty(buf, testString.slice(0, 20), new Uint8Array(5));
    await empty(buf, "", new Uint8Array(100));

    // buf.truncate()
    buf.reset();
  }
});
