use napi_derive::napi;
use napi::{Result, Error, Status};
use std::ffi::c_void;

// C-bindings directas para CoreGraphics de OS X ya que `core-graphics` crate no expone eventos mutables
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventCreateMouseEvent(
        source: *const c_void, 
        mouseType: u32, 
        mouseCursorPosition: CGPoint, 
        mouseButton: u32
    ) -> *mut c_void;
    
    fn CGEventPost(tapLocation: u32, event: *mut c_void);
    fn CFRelease(cftype: *mut c_void);
    fn CGEventCreateKeyboardEvent(source: *const c_void, virtualKey: u16, keyDown: bool) -> *mut c_void;
    fn CGEventKeyboardSetUnicodeString(event: *mut c_void, stringLength: usize, unicodeString: *const u16);
    fn CGEventSetFlags(event: *mut c_void, flags: u64);
    fn CGEventCreateScrollWheelEvent(source: *const c_void, units: u32, wheelCount: u32, wheel1: i32, wheel2: i32) -> *mut c_void;
}

fn get_keycode(key: &str) -> u16 {
    match key.to_lowercase().as_str() {
        "a" => 0x00, "s" => 0x01, "d" => 0x02, "f" => 0x03, "h" => 0x04, "g" => 0x05, "z" => 0x06, "x" => 0x07, "c" => 0x08, "v" => 0x09, "b" => 0x0B, "q" => 0x0C, "w" => 0x0D, "e" => 0x0E, "r" => 0x0F, "y" => 0x10, "t" => 0x11, "1" => 0x12, "2" => 0x13, "3" => 0x14, "4" => 0x15, "6" => 0x16, "5" => 0x17, "=" => 0x18, "9" => 0x19, "7" => 0x1A, "-" => 0x1B, "8" => 0x1C, "0" => 0x1D, "]" => 0x1E, "o" => 0x1F, "u" => 0x20, "[" => 0x21, "i" => 0x22, "p" => 0x23, "l" => 0x25, "j" => 0x26, "'" => 0x27, "k" => 0x28, ";" => 0x29, "\\" => 0x2A, "," => 0x2B, "/" => 0x2C, "n" => 0x2D, "m" => 0x2E, "." => 0x2F,
        "return" | "enter" => 0x24,
        "tab" => 0x30,
        "space" => 0x31,
        "delete" | "backspace" => 0x33,
        "escape" | "esc" => 0x35,
        "command" | "cmd" | "meta" => 0x37,
        "shift" => 0x38,
        "capslock" => 0x39,
        "option" | "alt" => 0x3A,
        "control" | "ctrl" => 0x3B,
        "right_shift" => 0x3C,
        "right_option" | "right_alt" => 0x3D,
        "right_control" | "right_ctrl" => 0x3E,
        "function" | "fn" => 0x3F,
        "f1" => 0x7A, "f2" => 0x78, "f3" => 0x63, "f4" => 0x76, "f5" => 0x60, "f6" => 0x61, "f7" => 0x62, "f8" => 0x64, "f9" => 0x65, "f10" => 0x6D, "f11" => 0x67, "f12" => 0x6F,
        "left" => 0x7B, "right" => 0x7C, "down" => 0x7D, "up" => 0x7E,
        _ => 0xFFFF
    }
}

fn get_modifier_flag(modifier: &str) -> u64 {
    match modifier.to_lowercase().as_str() {
        "shift" => 0x00020000,
        "control" | "ctrl" => 0x00040000,
        "option" | "alt" => 0x00080000,
        "command" | "cmd" | "meta" => 0x00100000,
        _ => 0
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

// Constantes CGEventType
const K_CG_EVENT_LEFT_MOUSE_DOWN: u32 = 1;
const K_CG_EVENT_LEFT_MOUSE_UP: u32 = 2;
const K_CG_EVENT_RIGHT_MOUSE_DOWN: u32 = 3;
const K_CG_EVENT_RIGHT_MOUSE_UP: u32 = 4;
const K_CG_HID_EVENT_TAP: u32 = 0; // kCGHIDEventTap

#[napi]
pub fn mouse_move(x: f64, y: f64) -> Result<()> {
    unsafe {
        let pt = CGPoint { x, y };
        let event = CGEventCreateMouseEvent(std::ptr::null(), 5, pt, 0); // 5 = kCGEventMouseMoved
        if !event.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event);
            CFRelease(event);
        }
    }
    Ok(())
}

#[napi]
pub fn mouse_click(x: f64, y: f64, button: u32) -> Result<()> {
    let _pt = CGPoint { x, y };
    let (down_type, up_type, btn_enum) = match button {
        2 => (K_CG_EVENT_RIGHT_MOUSE_DOWN, K_CG_EVENT_RIGHT_MOUSE_UP, 1),
        _ => (K_CG_EVENT_LEFT_MOUSE_DOWN, K_CG_EVENT_LEFT_MOUSE_UP, 0),
    };

    unsafe {
        // Mover Cursor
        let event_move = CGEventCreateMouseEvent(std::ptr::null(), 5, CGPoint{x,y}, 0);
        if !event_move.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_move);
            CFRelease(event_move);
        }

        // Down
        let event_down = CGEventCreateMouseEvent(std::ptr::null(), down_type, CGPoint{x,y}, btn_enum);
        if !event_down.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_down);
            CFRelease(event_down);
        }

        // Up
        let event_up = CGEventCreateMouseEvent(std::ptr::null(), up_type, CGPoint{x,y}, btn_enum);
        if !event_up.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_up);
            CFRelease(event_up);
        }
    }
    Ok(())
}

#[napi]
pub fn mouse_double_click(x: f64, y: f64) -> Result<()> {
    mouse_click(x, y, 1)?;
    mouse_click(x, y, 1)?;
    Ok(())
}

#[napi]
pub fn mouse_drag(from_x: f64, from_y: f64, to_x: f64, to_y: f64) -> Result<()> {
    unsafe {
        let pt_from = CGPoint { x: from_x, y: from_y };
        let event_move = CGEventCreateMouseEvent(std::ptr::null(), 5, pt_from, 0); // K_CG_EVENT_MOUSE_MOVED
        if !event_move.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_move);
            CFRelease(event_move);
        }
        
        let event_down = CGEventCreateMouseEvent(std::ptr::null(), K_CG_EVENT_LEFT_MOUSE_DOWN, pt_from, 0);
        if !event_down.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_down);
            CFRelease(event_down);
        }
        
        let pt_to = CGPoint { x: to_x, y: to_y };
        let event_drag = CGEventCreateMouseEvent(std::ptr::null(), 6, pt_to, 0); // K_CG_EVENT_LEFT_MOUSE_DRAGGED = 6
        if !event_drag.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_drag);
            CFRelease(event_drag);
        }
        
        let event_up = CGEventCreateMouseEvent(std::ptr::null(), K_CG_EVENT_LEFT_MOUSE_UP, pt_to, 0);
        if !event_up.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_up);
            CFRelease(event_up);
        }
    }
    Ok(())
}

#[napi]
pub fn mouse_scroll(_x: f64, _y: f64, delta_x: i32, delta_y: i32) -> Result<()> {
    unsafe {
        // units 0 = pixel, 1 = line. Using 0 for pixel-based scroll.
        let event_scroll = CGEventCreateScrollWheelEvent(std::ptr::null(), 0, 2, delta_y, delta_x);
        if !event_scroll.is_null() {
            CGEventPost(K_CG_HID_EVENT_TAP, event_scroll);
            CFRelease(event_scroll);
        }
    }
    Ok(())
}

#[napi]
pub fn keyboard_type(text: String) -> Result<()> {
    unsafe {
        let utf16: Vec<u16> = text.encode_utf16().collect();
        let event_down = CGEventCreateKeyboardEvent(std::ptr::null(), 0, true);
        if !event_down.is_null() {
            CGEventKeyboardSetUnicodeString(event_down, utf16.len(), utf16.as_ptr());
            CGEventPost(K_CG_HID_EVENT_TAP, event_down);
            CFRelease(event_down);
        }
        
        let event_up = CGEventCreateKeyboardEvent(std::ptr::null(), 0, false);
        if !event_up.is_null() {
            CGEventKeyboardSetUnicodeString(event_up, utf16.len(), utf16.as_ptr());
            CGEventPost(K_CG_HID_EVENT_TAP, event_up);
            CFRelease(event_up);
        }
    }
    Ok(())
}

#[napi]
pub fn keyboard_press(key: String, modifiers: Vec<String>) -> Result<()> {
    let keycode = get_keycode(&key);
    if keycode == 0xFFFF {
        return Err(Error::new(Status::InvalidArg, format!("Unknown key: {}", key)));
    }

    let mut flags: u64 = 0;
    for m in &modifiers {
        flags |= get_modifier_flag(m);
    }

    unsafe {
        let event_down = CGEventCreateKeyboardEvent(std::ptr::null(), keycode, true);
        if !event_down.is_null() {
            if flags != 0 { CGEventSetFlags(event_down, flags); }
            CGEventPost(K_CG_HID_EVENT_TAP, event_down);
            CFRelease(event_down);
        }

        let event_up = CGEventCreateKeyboardEvent(std::ptr::null(), keycode, false);
        if !event_up.is_null() {
            if flags != 0 { CGEventSetFlags(event_up, flags); }
            CGEventPost(K_CG_HID_EVENT_TAP, event_up);
            CFRelease(event_up);
        }
    }
    Ok(())
}

#[napi]
pub fn keyboard_hotkey(keys: Vec<String>) -> Result<()> {
    if keys.is_empty() { return Ok(()); }
    
    let main_key = &keys[keys.len() - 1];
    let modifiers = &keys[0..keys.len() - 1];
    
    keyboard_press(main_key.clone(), modifiers.to_vec())
}
