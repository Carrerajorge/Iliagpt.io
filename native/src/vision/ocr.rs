use napi_derive::napi;
use napi::bindgen_prelude::Buffer;
use napi::Result;

#[napi]
pub fn extract_text(_image: Buffer) -> Result<String> {
  // Tesseract FFI or Windows OCR stub
  Ok("stubbed text".to_string())
}
