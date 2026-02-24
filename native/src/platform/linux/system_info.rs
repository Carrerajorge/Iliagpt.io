use napi::bindgen_prelude::*;

#[napi]
pub fn get_battery_level() -> Result<f64> {
    Err(Error::new(Status::GenericFailure, "Linux system info not yet implemented.".to_string()))
}

#[napi]
pub fn get_os_version() -> Result<String> {
    Ok("Linux (MICHAT Daemon)".to_string())
}
