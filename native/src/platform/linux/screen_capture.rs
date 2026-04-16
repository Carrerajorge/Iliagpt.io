use napi::bindgen_prelude::*;

#[napi]
pub fn capture_screen() -> Result<Buffer> {
    Err(Error::new(Status::GenericFailure, "Linux screen capture not yet implemented. Requires X11/Wayland context.".to_string()))
}
