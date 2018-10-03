#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]
use http_util;
use tokio_util;

use futures::future::lazy;
use futures::future::result;
use futures::sync::mpsc;
use futures::sync::oneshot;
use futures::Sink;
use hyper;
use hyper::rt::{Future, Stream};
use hyper::server::conn::AddrIncoming;
use hyper::service::service_fn;
use hyper::{Body, Request, Response, Server};
use std;
use std::net::SocketAddr;
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use tokio;

pub struct HttpServer {
  //pub fut: hyper::Server<AddrIncoming, ()>,
  pub server_rx: mpsc::Receiver<ReqMsg>,
}

type ReqMsg = (Request<Body>, oneshot::Sender<Response<Body>>);

pub fn create_and_bind(addr: &SocketAddr) -> hyper::error::Result<HttpServer> {
  let (server_tx, server_rx) = mpsc::channel::<ReqMsg>(2);

  let new_service = move || {
    let server_tx2 = Box::new(server_tx.clone());
    service_fn(move |req: Request<Body>| {
      let server_tx3 = server_tx2.clone();
      let (tx, rx) = oneshot::channel::<Response<Body>>();
      let rx = Box::new(rx);
      let msg = (req, tx);
      assert!(server_tx3.is_closed() == false);
      server_tx3
        .send(msg)
        .map_err(|err| {
          println!("server_tx.send error {}", err);
          panic!(err)
        }).and_then(|_| rx)
    })
  };

  let builder = Server::try_bind(&addr)?;
  let fut = builder.serve(new_service);
  let fut = fut.map_err(|err| panic!(err));
  tokio::spawn(fut);

  let http_server = HttpServer { server_rx };

  Ok(http_server)
}

#[test]
fn test_http_server_create() {
  let req_counter = Arc::new(AtomicUsize::new(0));
  // Clone the counter, so we can access it in the closure (which may happen on
  // another thread.
  let req_counter_ = req_counter.clone();
  let addr = SocketAddr::from_str("127.0.0.1:4500").unwrap();
  tokio_util::init(|| {
    let http_server = create_and_bind(&addr).unwrap();

    tokio::spawn(http_server.server_rx.for_each(move |req_msg| {
      let (req, response_tx) = req_msg;
      assert!(response_tx.is_canceled() == false);
      assert_eq!(req.uri(), "/foo");
      let r = response_tx.send(Response::new(Body::from("hi")));
      assert!(r.is_ok());
      req_counter_.fetch_add(1, Ordering::SeqCst);
      result(r.map_err(|err| panic!(err)))
    }));

    let r = http_util::fetch_sync_string("http://127.0.0.1:4500/foo");
    assert!(r.is_ok());
    let (res_body, _res_content_type) = r.unwrap();
    assert_eq!(res_body, "hi");
  });
  assert_eq!(req_counter.load(Ordering::SeqCst), 1);
}
