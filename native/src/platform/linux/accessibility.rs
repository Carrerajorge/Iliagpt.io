use napi::bindgen_prelude::*;

#[napi]
pub fn get_element_attributes() -> Result<String> {
    Err(Error::new(Status::GenericFailure, "Linux element attributes not yet implemented. Requires AT-SPI2.".to_string()))
}

#[napi]
pub fn get_element_tree() -> Result<String> {
    Err(Error::new(Status::GenericFailure, "Linux element tree not yet implemented. Requires AT-SPI2.".to_string()))
}
