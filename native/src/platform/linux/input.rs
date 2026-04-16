use napi::bindgen_prelude::*;

#[napi]
pub fn mouse_click() -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Linux mouse click not yet implemented. Requires X11/Wayland.".to_string()))
}

#[napi]
pub fn keyboard_type(_text: String) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Linux keyboard not yet implemented.".to_string()))
}
