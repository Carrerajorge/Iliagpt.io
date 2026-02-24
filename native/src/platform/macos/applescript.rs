use napi_derive::napi;
use napi::{Result, Error, Status};
use std::process::Command;
use std::time::{Duration, Instant};

#[napi]
pub fn execute_applescript(script: String) -> Result<String> {
    let mut child = Command::new("osascript")
        .arg("-e").arg(&script)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| Error::new(Status::GenericFailure, format!("Failed to spawn osascript: {}", e)))?;
        
    let start = Instant::now();
    let timeout = Duration::from_secs(10);
    
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child.wait_with_output().unwrap();
                if status.success() {
                    return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
                } else {
                    return Err(Error::new(Status::GenericFailure, String::from_utf8_lossy(&output.stderr).to_string()));
                }
            },
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(Error::new(Status::GenericFailure, "AppleScript execution timed out after 10 seconds".to_string()));
                }
                std::thread::sleep(Duration::from_millis(50));
            },
            Err(e) => {
                let _ = child.kill();
                return Err(Error::new(Status::GenericFailure, format!("Error waiting for osascript: {}", e)));
            }
        }
    }
}
