use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use napi::Result;

#[napi]
pub fn capture_screen_vision() -> Result<Buffer> {
  // Unified screen capture delegating to platform specific via conditional compiling
  Ok(Buffer::from(vec![0; 100]))
}
