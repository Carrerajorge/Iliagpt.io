#![deny(clippy::all)]

use napi_derive::napi;
use std::collections::HashMap;
use serde::{Serialize, Deserialize};

/// Enumeration of common UI element roles across platforms.
#[napi(string_enum)]
#[derive(Debug, Serialize, Deserialize)]
pub enum UIRole {
  Window,
  Button,
  TextField,
  Menu,
  MenuItem,
  Checkbox,
  Link,
  Tab,
  Image,
  Unknown
}

/// Represents a bounding box for a UI element.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// Represents a 2D coordinate for clicks or visual center points.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
  pub x: f64,
  pub y: f64,
}

/// Common UI Element representation that abstracts AXUIElement (macOS) and UIAutomation (Windows).
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIElement {
  pub id: String,
  pub role: UIRole,
  pub title: Option<String>,
  pub value: Option<String>,
  
  pub position: Point,
  pub size: Rect,
  
  pub is_enabled: bool,
  pub is_focused: bool,
  pub is_selected: bool,
  
  /// Additional platform-specific attributes
  pub attributes: HashMap<String, String>,
}

/// Represents a window on the desktop.
#[napi(object)]
pub struct WindowInfo {
  pub id: i64,
  pub title: String,
  pub app_name: String,
  pub is_focused: bool,
  pub bounds: Rect,
  pub z_order: i32,
}

/// A request for a specific click action.
#[napi(object)]
pub struct ClickOptions {
  pub button: Option<String>, // 'left', 'right', 'middle'
  pub double_click: Option<bool>,
}

/// Metadata about a captured screenshot.
#[napi(object)]
pub struct CaptureMetadata {
  pub timestamp: i64,
  pub width: u32,
  pub height: u32,
  pub display_id: u32,
}
