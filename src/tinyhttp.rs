// Work in progress http 
// To Test:
//  ./tools/build.py test_rs && ./target/debug/test_rs tinyhttp::test::test_http_server_create --nocapture
// 
#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]

//! A "tiny" example of HTTP request/response handling using just tokio-core
//!
//! This example is intended for *learning purposes* to see how various pieces
//! hook up together and how HTTP can get up and running. Note that this example
//! is written with the restriction that it *can't* use any "big" library other
//! than tokio-core, if you'd like a "real world" HTTP library you likely want a
//! crate like Hyper.
//!
//! Code here is based on the `echo-threads` example and implements two paths,
//! the `/plaintext` and `/json` routes to respond with some text and json,
//! respectively. By default this will run I/O on all the cores your system has
//! available, and it doesn't support HTTP request bodies.

#![deny(warnings)]

/*
#[macro_use]
extern crate serde_derive;
extern crate serde_json;
extern crate time;
extern crate tokio;
extern crate tokio_io;
*/

use std::net::SocketAddr;
use std::{env, fmt, io};

use http;
use httparse;
use tokio;
use tokio::codec::{Decoder, Encoder};
use tokio::net::{TcpListener, TcpStream};
use tokio::prelude::*;

use bytes::BytesMut;
use http::header::HeaderValue;
use http::{Request, Response, StatusCode};

fn process(socket: TcpStream) {
  let (tx, rx) =
        // Frame the socket using the `Http` protocol. This maps the TCP socket
        // to a Stream + Sink of HTTP frames.
        Http.framed(socket)
        // This splits a single `Stream + Sink` value into two separate handles
        // that can be used independently (even on different tasks or threads).
        .split();

  // Map all requests into responses and send them back to the client.
  let task = tx.send_all(rx.and_then(respond)).then(|res| {
    if let Err(e) = res {
      println!("failed to process connection; error = {:?}", e);
    }

    Ok(())
  });

  // Spawn the task that handles the connection.
  tokio::spawn(task);
}

/// "Server logic" is implemented in this function.
///
/// This function is a map from and HTTP request to a future of a response and
/// represents the various handling a server might do. Currently the contents
/// here are pretty uninteresting.
fn respond(
  req: Request<()>,
) -> Box<Future<Item = Response<String>, Error = io::Error> + Send> {
  let mut ret = Response::builder();
  let body = match req.uri().path() {
    "/foo" => {
      ret.header("Content-Type", "text/plain");
      "Hello, World!".to_string()
    }
    _ => {
      ret.status(StatusCode::NOT_FOUND);
      String::new()
    }
  };
  Box::new(future::ok(ret.body(body).unwrap()))
}

struct Http;

/// Implementation of encoding an HTTP response into a `BytesMut`, basically
/// just writing out an HTTP/1.1 response.
impl Encoder for Http {
  type Item = Response<String>;
  type Error = io::Error;

  fn encode(
    &mut self,
    item: Response<String>,
    dst: &mut BytesMut,
  ) -> io::Result<()> {
    use std::fmt::Write;

    write!(
      BytesWrite(dst),
      "\
       HTTP/1.1 {}\r\n\
       Server: Example\r\n\
       Content-Length: {}\r\n\
       ",
      item.status(),
      item.body().len()
    ).unwrap();

    for (k, v) in item.headers() {
      dst.extend_from_slice(k.as_str().as_bytes());
      dst.extend_from_slice(b": ");
      dst.extend_from_slice(v.as_bytes());
      dst.extend_from_slice(b"\r\n");
    }

    dst.extend_from_slice(b"\r\n");
    dst.extend_from_slice(item.body().as_bytes());

    return Ok(());

    // Right now `write!` on `Vec<u8>` goes through io::Write and is not
    // super speedy, so inline a less-crufty implementation here which
    // doesn't go through io::Error.
    struct BytesWrite<'a>(&'a mut BytesMut);

    impl<'a> fmt::Write for BytesWrite<'a> {
      fn write_str(&mut self, s: &str) -> fmt::Result {
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
      }

      fn write_fmt(&mut self, args: fmt::Arguments) -> fmt::Result {
        fmt::write(self, args)
      }
    }
  }
}

/// Implementation of decoding an HTTP request from the bytes we've read so far.
/// This leverages the `httparse` crate to do the actual parsing and then we use
/// that information to construct an instance of a `http::Request` object,
/// trying to avoid allocations where possible.
impl Decoder for Http {
  type Item = Request<()>;
  type Error = io::Error;

  fn decode(&mut self, src: &mut BytesMut) -> io::Result<Option<Request<()>>> {
    // TODO: we should grow this headers array if parsing fails and asks
    //       for more headers
    let mut headers = [None; 16];
    let (method, path, version, amt) = {
      let mut parsed_headers = [httparse::EMPTY_HEADER; 16];
      let mut r = httparse::Request::new(&mut parsed_headers);
      let status = r.parse(src).map_err(|e| {
        let msg = format!("failed to parse http request: {:?}", e);
        io::Error::new(io::ErrorKind::Other, msg)
      })?;

      let amt = match status {
        httparse::Status::Complete(amt) => amt,
        httparse::Status::Partial => return Ok(None),
      };

      let toslice = |a: &[u8]| {
        let start = a.as_ptr() as usize - src.as_ptr() as usize;
        assert!(start < src.len());
        (start, start + a.len())
      };

      for (i, header) in r.headers.iter().enumerate() {
        let k = toslice(header.name.as_bytes());
        let v = toslice(header.value);
        headers[i] = Some((k, v));
      }

      (
        toslice(r.method.unwrap().as_bytes()),
        toslice(r.path.unwrap().as_bytes()),
        r.version.unwrap(),
        amt,
      )
    };
    if version != 1 {
      return Err(io::Error::new(
        io::ErrorKind::Other,
        "only HTTP/1.1 accepted",
      ));
    }
    let data = src.split_to(amt).freeze();
    let mut ret = Request::builder();
    ret.method(&data[method.0..method.1]);
    ret.uri(data.slice(path.0, path.1));
    ret.version(http::Version::HTTP_11);
    for header in headers.iter() {
      let (k, v) = match *header {
        Some((ref k, ref v)) => (k, v),
        None => break,
      };
      let value =
        unsafe { HeaderValue::from_shared_unchecked(data.slice(v.0, v.1)) };
      ret.header(&data[k.0..k.1], value);
    }

    let req = ret
      .body(())
      .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    Ok(Some(req))
  }
}

#[cfg(test)]
mod test {
  use super::*;
  use futures::Future;
  use http_util;
  use hyper::{Body, Response};
  use std;
  use std::net::SocketAddr;
  use std::str::FromStr;
  use std::sync::atomic::{AtomicUsize, Ordering};
  use std::sync::Arc;
  use tokio;
  use tokio_util;

  #[test]
  fn test_http_server_create() {
    // Rust does not die on panic by default. And -Cpanic=abort is broken.
    // https://github.com/rust-lang/cargo/issues/2738
    // Therefore this hack.
    std::panic::set_hook(Box::new(|panic_info| {
      eprintln!("{}", panic_info.to_string());
      std::process::abort();
    }));

    let addr = SocketAddr::from_str("127.0.0.1:4500").unwrap();
    tokio_util::init(|| {
      // Create TcpServer
      let listener = TcpListener::bind(&addr).unwrap();
      let server =
        listener
          .incoming()
          .map_err(|e| panic!(e))
          .for_each(move |socket| {
            process(socket);
            Ok(())
          });
      tokio::spawn(server);

      let r = http_util::fetch_sync_string("http://127.0.0.1:4500/foo");
      assert!(r.is_ok());
      let (res_body, _res_content_type) = r.unwrap();
      assert_eq!(res_body, "Hello, World!");
    });
  }
}
