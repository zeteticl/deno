// Copyright 2018 the Deno authors. All rights reserved. MIT license.
import { test, testPerm, assert, assertEqual } from "./test_util.ts";
import * as deno from "deno";

async function testServer(addr: string): Promise<void> {
  const server = deno.listen(addr);

  while (true) {
    const conn = await server.accept();
    if (conn == null) {
      break;
    }

    // Closes conn.rid
    const httpConn = await deno.httpWrap(conn);
    if (httpConn == null) {
      break;
    }

    (async () => {
      try {
        for await (const req of httpConn) {
          assertEqual(req.url, "/foo");
          assertEqual(req.method, "GET");
          assertEqual(req.headers, [["host", "127.0.0.1:4501"]]);
          await req.respond({
            status: 404,
            headers: [["content-type", "text/plain"], ["hello", "world"]],
            body: new TextEncoder().encode("404 Not Found\n"),
          });
          counter++;
          // req.close();
        }
      } finally {
        httpConn.close();
      }
    })();
  }

  server.close();
}

testPerm({ net: true }, async function httpServerBasic() {
  const addr = "127.0.0.1:4501";
  let counter = 0;

  const fetchRes = await fetch("http://" + addr + "/foo");
  server.close();
  // TODO
  // assertEqual(fetchRes.headers, [
  //   [ "content-type", "text/plain" ],
  //   [ "hello", "world" ],
  // ]);
  // assertEqual(fetchRes.statusText, "Not Found");
  assertEqual(fetchRes.status, 404);
  const body = await fetchRes.text();
  assertEqual(body, "404 Not Found\n");

  await serverComplete;
  assertEqual(counter, 1);
});
