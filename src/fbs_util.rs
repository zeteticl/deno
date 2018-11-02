use flatbuffers;
use flatbuffers::FlatBufferBuilder;
use hyper::Body;
use hyper::Request;
use msg;

pub fn serialize_request<'bldr>(
  builder: &mut FlatBufferBuilder<'bldr>,
  r: &Request<Body>,
) -> flatbuffers::WIPOffset<msg::HttpHeaders<'bldr>> {
  let method_ = builder.create_string(r.method().as_str());
  let url_ = builder.create_string(r.uri().to_string().as_ref());
  msg::HttpHeaders::create(
    builder,
    &msg::HttpHeadersArgs {
      is_request: true,
      method: Some(method_),
      url: Some(url_),
      ..Default::default()
    },
  )
}
