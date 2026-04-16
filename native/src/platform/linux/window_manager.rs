use napi::bindgen_prelude::*;

#[napi]
pub fn get_foreground_window() -> Result<String> {
    Err(Error::new(Status::GenericFailure, "Linux window manager not yet implemented.".to_string()))
}

#[napi]
pub fn find_window_by_name(_name: String) -> Result<String> {
    Err(Error::new(Status::GenericFailure, "Linux window manager not yet implemented.".to_string()))
}

#[napi]
pub fn set_foreground_window(_app_name: String) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Linux window manager not yet implemented.".to_string()))
}

#[napi]
pub fn list_open_windows() -> Result<String> {
    Err(Error::new(Status::GenericFailure, "Linux list open windows not yet implemented.".to_string()))
}

#[napi]
pub fn close_window(_app_name: String) -> Result<()> {
    Err(Error::new(Status::GenericFailure, "Linux close window not yet implemented.".to_string()))
}
