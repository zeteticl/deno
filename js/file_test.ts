import * as deno from "deno";
import { test, assert, assertEqual } from "./test_util.ts";

test(async function copyFileToStdout() {
  const filename = "package.json";
  const file = await deno.open(filename);
  const bytesWritten = await deno.copy(deno.stdout, file);
  const fileSize = deno.statSync(filename).len;
  assertEqual(bytesWritten, fileSize);
});
