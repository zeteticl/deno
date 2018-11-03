// Copyright 2018 the Deno authors. All rights reserved. MIT license.
import { test, testPerm, assert, assertEqual } from "./test_util.ts";
import * as deno from "deno";

testPerm({ net: true }, async function fetchJsonSuccess() {

  deno.httpServe("127.0.0.1:4500", (req, res) => {
    assertEqual(req.url, "/foo");
    console.log("got request", req.method, req.url);
    console.log("got request headers", req.headers);
  });
});
