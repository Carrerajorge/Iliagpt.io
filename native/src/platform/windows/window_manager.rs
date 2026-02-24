#![cfg(target_os = "windows")]
use napi::bindgen_prelude::*;
use napi_derive::napi;
use napi::Result;
use crate::types::{WindowInfo, Rect};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowTextW, EnumWindows, GetWindowRect, 
    IsWindowVisible, SetForegroundWindow, PostMessageW, WM_CLOSE,
    GetWindowThreadProcessId
};
use windows::Win32::System::Threading::{OpenProcess, PROCESS_QUERY_INFORMATION, PROCESS_VM_READ, QueryFullProcessImageNameW};
use windows::Win32::Foundation::{BOOL, HWND, LPARAM, WPARAM, MAX_PATH};

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let vec_ptr = lparam.0 as *mut Vec<WindowInfo>;
    let vec = &mut *vec_ptr;

    if IsWindowVisible(hwnd).as_bool() {
        let mut text_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut text_buf);
        if len > 0 {
            let title = String::from_utf16_lossy(&text_buf[..len as usize]);
            let mut process_id = 0;
            let _ = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
            let mut app_name = title.clone(); // Fallback
            
            if process_id != 0 {
                let h_process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, process_id);
                if let Ok(handle) = h_process {
                    let mut path_buf = [0u16; MAX_PATH as usize];
                    let mut path_len = MAX_PATH;
                    // Using query full process to safely read 64/32 path boundaries
                    let _ = QueryFullProcessImageNameW(handle, windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0), windows::core::PWSTR(path_buf.as_mut_ptr()), &mut path_len);
                    if path_len > 0 {
                        let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                        app_name = std::path::Path::new(&full_path)
                            .file_name()
                            .map(|s| s.to_string_lossy().into_owned())
                            .unwrap_or(title.clone());
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(handle);
                }
            }
            
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);

            vec.push(WindowInfo {
                id: hwnd.0 as i64,
                title,
                app_name,
                is_focused: false,
                bounds: Rect { 
                    x: rect.left as f64, 
                    y: rect.top as f64, 
                    width: (rect.right - rect.left) as f64, 
                    height: (rect.bottom - rect.top) as f64 
                },
                z_order: vec.len() as i32,
            });
        }
    }
    BOOL(1)
}

#[napi]
pub fn get_active_window() -> Result<WindowInfo> {
    unsafe {
        let hwnd = GetForegroundWindow();
        let mut text_buf = [0u16; 512];
        let len = GetWindowTextW(hwnd, &mut text_buf);
        let title = String::from_utf16_lossy(&text_buf[..len as usize]);
        
        // Rect details
        let mut rect = windows::Win32::Foundation::RECT::default();
        let _ = GetWindowRect(hwnd, &mut rect);

        let mut process_id = 0;
        let _ = GetWindowThreadProcessId(hwnd, Some(&mut process_id));
        let mut app_name = title.clone();
        
        if process_id != 0 {
            let h_process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, process_id);
            if let Ok(handle) = h_process {
                let mut path_buf = [0u16; MAX_PATH as usize];
                let mut path_len = MAX_PATH;
                let _ = QueryFullProcessImageNameW(handle, windows::Win32::System::Threading::PROCESS_NAME_FORMAT(0), windows::core::PWSTR(path_buf.as_mut_ptr()), &mut path_len);
                if path_len > 0 {
                    let full_path = String::from_utf16_lossy(&path_buf[..path_len as usize]);
                    app_name = std::path::Path::new(&full_path)
                        .file_name()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or(title.clone());
                }
                let _ = windows::Win32::Foundation::CloseHandle(handle);
            }
        }

        Ok(WindowInfo {
            id: hwnd.0 as i64,
            title,
            app_name, 
            is_focused: true,
            bounds: Rect { 
                x: rect.left as f64, 
                y: rect.top as f64, 
                width: (rect.right - rect.left) as f64, 
                height: (rect.bottom - rect.top) as f64 
            },
            z_order: 0,
        })
    }
}

#[napi]
pub fn list_windows() -> Result<Vec<WindowInfo>> {
    let mut windows = Vec::new();
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut windows as *mut _ as isize)
        );
    }
    Ok(windows)
}

#[napi]
pub fn focus_window(hwnd: i64) -> Result<bool> {
    unsafe {
        let _ = SetForegroundWindow(HWND(hwnd as isize));
    }
    Ok(true)
}

#[napi]
pub fn close_window(hwnd: i64) -> Result<bool> {
    unsafe {
        let _ = PostMessageW(
            HWND(hwnd as isize),
            WM_CLOSE,
            WPARAM(0),
            LPARAM(0)
        );
    }
    Ok(true)
}
