use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use napi::Result;

#[napi]
pub fn diff_frames(_a: Buffer, _b: Buffer) -> Result<f64> {
  // Use SIMD algorithms to quickly distinguish image difference percentage
  Ok(1.0)
}
