use napi_derive::napi;
use napi::{Result, Error, Status};
use crate::types::{WindowInfo, Rect};
use core_foundation::array::CFArray;
use core_foundation::base::{TCFType, CFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::CFString;
use core_foundation::number::CFNumber;
use core_graphics::window::{CGWindowListCopyWindowInfo, kCGWindowListOptionOnScreenOnly, kCGNullWindowID};
use std::process::Command;

#[napi]
pub fn get_active_window() -> Result<WindowInfo> {
    // CGWindowListCopyWindowInfo does not flag which window is active.
    // We use a small AppleScript to get the frontmost app's PID and Name, then match it.
    let script = r#"
        tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return (unix id of frontApp as string) & "," & (name of frontApp)
        end tell
    "#;
    let output = Command::new("osascript")
        .arg("-e").arg(script)
        .output()
        .map_err(|e| Error::new(Status::GenericFailure, format!("osascript failed: {}", e)))?;
    
    let out_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let parts: Vec<&str> = out_str.splitn(2, ',').collect();
    let (pid_str, app_name) = if parts.len() == 2 { (parts[0], parts[1]) } else { ("", "Unknown") };
    let _expected_pid: i32 = pid_str.parse().unwrap_or(-1);

    let windows = list_windows()?;
    
    // Find highest z-order window matching the app
    for w in windows {
        if w.app_name == app_name {
            // Found the topmost window for the active app
            let mut active_w = w;
            active_w.is_focused = true;
            return Ok(active_w);
        }
    }

    Ok(WindowInfo {
        id: -1,
        title: "Unknown".to_string(),
        app_name: app_name.to_string(),
        is_focused: true,
        bounds: Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
        z_order: 0,
    })
}

#[napi]
pub fn list_windows() -> Result<Vec<WindowInfo>> {
    let mut result_windows = Vec::new();
    
    unsafe {
        let array_ref = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
        if array_ref.is_null() {
            return Ok(result_windows);
        }
        
        let array: CFArray<*const std::ffi::c_void> = CFType::wrap_under_create_rule(array_ref as _).downcast_into::<CFArray<*const std::ffi::c_void>>().unwrap();
        
        let extract_string = |dict: &CFDictionary, key: &str| -> String {
            let k = CFString::new(key);
            let key_ptr = k.as_CFTypeRef() as *const std::ffi::c_void;
            if dict.contains_key(&key_ptr) {
                let val_ptr = *dict.get(key_ptr);
                let cf_type = CFType::wrap_under_get_rule(val_ptr as _);
                if let Some(cf_str) = cf_type.downcast_into::<CFString>() {
                    return cf_str.to_string();
                }
            }
            String::new()
        };

        let extract_i64 = |dict: &CFDictionary, key: &str| -> Option<i64> {
            let k = CFString::new(key);
            let key_ptr = k.as_CFTypeRef() as *const std::ffi::c_void;
            if dict.contains_key(&key_ptr) {
                let val_ptr = *dict.get(key_ptr);
                let cf_type = CFType::wrap_under_get_rule(val_ptr as _);
                if let Some(num) = cf_type.downcast_into::<CFNumber>() {
                    return num.to_i64();
                }
            }
            None
        };

        for (i, item) in array.into_iter().enumerate() {
            let dict_ptr = *item;
            let cf_type = CFType::wrap_under_get_rule(dict_ptr as _);
            if let Some(dict) = cf_type.downcast_into::<CFDictionary>() {
                let app_name = extract_string(&dict, "kCGWindowOwnerName");
                let title = extract_string(&dict, "kCGWindowName");
                let id = extract_i64(&dict, "kCGWindowNumber").unwrap_or(0);
                
                let mut rect = Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 };
                
                let k_bounds = CFString::new("kCGWindowBounds");
                let bounds_key_ptr = k_bounds.as_CFTypeRef() as *const std::ffi::c_void;
                if dict.contains_key(&bounds_key_ptr) {
                    let bounds_ptr = *dict.get(bounds_key_ptr);
                    let cf_type = CFType::wrap_under_get_rule(bounds_ptr as _);
                    if let Some(bounds_dict) = cf_type.downcast_into::<CFDictionary>() {
                        let extract_bounds_f64 = |b_dict: &CFDictionary, key: &str| -> f64 {
                            let k = CFString::new(key);
                            let ptr = k.as_CFTypeRef() as *const std::ffi::c_void;
                            if b_dict.contains_key(&ptr) {
                                let val_ptr = *b_dict.get(ptr);
                                let cf_type = CFType::wrap_under_get_rule(val_ptr as _);
                                if let Some(num) = cf_type.downcast_into::<CFNumber>() {
                                    return num.to_f64().unwrap_or(0.0);
                                }
                            }
                            0.0
                        };
                        rect.x = extract_bounds_f64(&bounds_dict, "X");
                        rect.y = extract_bounds_f64(&bounds_dict, "Y");
                        rect.width = extract_bounds_f64(&bounds_dict, "Width");
                        rect.height = extract_bounds_f64(&bounds_dict, "Height");
                    }
                }
                
                // Filter out desktop background and tiny ghost windows
                if rect.width > 5.0 && rect.height > 5.0 {
                    result_windows.push(WindowInfo {
                        id,
                        title,
                        app_name,
                        is_focused: false,
                        bounds: rect,
                        z_order: i as i32,
                    });
                }
            }
        }
    }
    
    Ok(result_windows)
}

#[napi]
pub fn focus_window(_window_id: i64) -> Result<bool> {
  // Not implemented in core_graphics purely, would require AXUIElement or AppleScript
  Ok(true)
}

#[napi]
pub fn close_window(_window_id: i64) -> Result<bool> {
  // Not implemented directly in core_graphics
  Ok(true)
}
