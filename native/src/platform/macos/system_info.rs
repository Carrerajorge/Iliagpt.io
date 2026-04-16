use napi::Result;
use core_graphics::display::CGGetActiveDisplayList;

pub fn get_battery_level() -> Result<f64> {
  // Use `pmset -g batt` as it's the most reliable way to get battery percentage without massive IOKit C-bindings
  let output = std::process::Command::new("pmset")
    .arg("-g")
    .arg("batt")
    .output()
    .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("pmset failed: {}", e)))?;

  let stdout = String::from_utf8_lossy(&output.stdout);
  
  // Look for text like "100%;" or "85%;"
  if let Some(percent_idx) = stdout.find("%") {
      let slice = &stdout[..percent_idx];
      // Find the last space before the percentage
      if let Some(space_idx) = slice.rfind(|c: char| c.is_whitespace() || c == '\t') {
          let num_str = &slice[space_idx + 1..];
          if let Ok(val) = num_str.parse::<f64>() {
              return Ok(val);
          }
      }
  }

  // Fallback if unable to parse (e.g., desktop mac with no battery)
  Ok(100.0)
}

pub fn get_display_count() -> Result<u32> {
  let display_count = unsafe {
      let mut count: u32 = 0;
      // Get the number of active displays
      CGGetActiveDisplayList(0, std::ptr::null_mut(), &mut count);
      count
  };
  Ok(if display_count == 0 { 1 } else { display_count })
}

pub fn get_os_version() -> Result<String> {
  let output = std::process::Command::new("sw_vers")
    .arg("-productVersion")
    .output()
    .map_err(|e| napi::Error::new(napi::Status::GenericFailure, format!("sw_vers failed: {}", e)))?;

  let v = String::from_utf8_lossy(&output.stdout).trim().to_string();
  Ok(if v.is_empty() { "15.0".to_string() } else { v })
}
