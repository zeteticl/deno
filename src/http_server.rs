#![allow(dead_code)]
#![allow(unused_imports)]
#![allow(unused_variables)]
use errors::DenoError;
use errors::DenoResult;
use http_util;
use tokio_util;

use futures::future::lazy;
use futures::future::result;
use futures::sync::mpsc;
use futures::sync::oneshot;
use futures::Canceled;
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

pub type Res = Response<Body>;

// server -> loop
pub type ReqMsg = (Request<Body>, oneshot::Sender<Res>);

// accept -> loop
pub type ReqMsgSender = oneshot::Sender<ReqMsg>;

pub struct HttpServer {
  sender_a: mpsc::Sender<ReqMsgSender>,
  sender_b: mpsc::Sender<ReqMsg>,
}

impl HttpServer {
  pub fn accept(&self) -> impl Future<Item = ReqMsg, Error = DenoError> {
    let (req_msg_sender, req_msg_reciever) = oneshot::channel::<ReqMsg>();
    let tx = self.sender_a.clone();
    tx.send(req_msg_sender)
      .map_err(|e| DenoError::from(e))
      .and_then(|_| req_msg_reciever.map_err(|e| DenoError::from(e)))
  }
}

pub fn create_and_bind(addr: &SocketAddr) -> DenoResult<HttpServer> {
  let (sender_a, loop_rx) = mpsc::channel::<ReqMsgSender>(1);
  let (sender_b, loop2_rx) = mpsc::channel::<ReqMsg>(1);

  let sender_b2 = sender_b.clone();

  let loop_fut = loop_rx.zip(loop2_rx).for_each(|(req_msg_sender, req_msg)| {
    req_msg_sender.send(req_msg).unwrap();
    Ok(())
  });

  let new_service = move || {
    // Yes, this is oddly necessary. Attempts to remove it end in tears.
    let sender_b3 = sender_b2.clone();

    service_fn(move |req: Request<Body>| {
      let (res_send, res_recv) = oneshot::channel::<Res>();
      // Clone necessary here too.
      sender_b3
        .clone()
        .send((req, res_send))
        .map_err(|e| DenoError::from(e))
        .and_then(|_| res_recv.map_err(|e| DenoError::from(e)))
    })
  };

  let builder = Server::try_bind(&addr)?;
  let fut = builder.serve(new_service);
  let fut = fut.map_err(|err| panic!(err));

  tokio::spawn(loop_fut);
  tokio::spawn(fut);

  let http_server = HttpServer { sender_a, sender_b };

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

    let accept_fut = http_server
      .accept()
      .map(move |(req, response_tx)| {
        assert_eq!(req.uri(), "/foo");
        assert!(response_tx.is_canceled() == false);
        let r = response_tx.send(Response::new(Body::from("hi")));
        assert!(r.is_ok());
        req_counter_.fetch_add(1, Ordering::SeqCst);
        ()
      }).map_err(|e| panic!(e));
    tokio::spawn(accept_fut);

    let r = http_util::fetch_sync_string("http://127.0.0.1:4500/foo");
    assert!(r.is_ok());
    let (res_body, _res_content_type) = r.unwrap();
    assert_eq!(res_body, "hi");
  });
  assert_eq!(req_counter.load(Ordering::SeqCst), 1);
}
