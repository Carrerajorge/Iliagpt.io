#![allow(dead_code)]
#![allow(non_snake_case)]

use napi::bindgen_prelude::*;
use napi_derive::napi;

use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX, GetVersionExW, OSVERSIONINFOW};

#[napi]
pub fn get_battery_level_win() -> Result<f64> {
    unsafe {
        let mut status: SYSTEM_POWER_STATUS = std::mem::zeroed();
        let success = GetSystemPowerStatus(&mut status);
        
        if success.is_ok() {
            if status.BatteryLifePercent == 255 {
                Ok(100.0) // No battery (desktop)
            } else {
                Ok(status.BatteryLifePercent as f64)
            }
        } else {
            Ok(100.0)
        }
    }
}

#[napi]
pub fn get_os_version_win() -> Result<String> {
    unsafe {
        let mut info: OSVERSIONINFOW = std::mem::zeroed();
        info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
        
        let success = GetVersionExW(&mut info);
        if success.is_ok() {
            Ok(format!("Windows {}.{} (Build {})", info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber))
        } else {
            Ok("Windows (Unknown Version)".to_string())
        }
    }
}

#[napi]
pub fn get_cpu_info_win() -> Result<String> {
    // WMI is too complex/slow to spin up just for the CPU string. Reading ENV variables is standard practice here.
    Ok(std::env::var("PROCESSOR_IDENTIFIER").unwrap_or("Unknown CPU".to_string()))
}

#[napi]
pub fn get_total_memory_win() -> Result<f64> {
    unsafe {
        let mut info: MEMORYSTATUSEX = std::mem::zeroed();
        info.dwLength = std::mem::size_of::<MEMORYSTATUSEX>() as u32;
        let success = GlobalMemoryStatusEx(&mut info);
        
        if success.is_ok() {
            Ok(info.ullTotalPhys as f64)
        } else {
            Err(Error::new(Status::GenericFailure, "Failed to get total memory"))
        }
    }
}
