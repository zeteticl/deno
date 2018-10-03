import * as deno from "deno";

deno.httpServe("127.0.0.1:4500", (req, res) => {
  console.log("got request");
});
