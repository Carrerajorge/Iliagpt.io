#![deny(clippy::all)]

pub mod platform;
pub mod vision;
pub mod types;

// Base functions will be integrated via the platform submodules
// using NAPI bindings generated at build time.

