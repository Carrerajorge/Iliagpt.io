#![cfg(target_os = "windows")]
use napi_derive::napi;
use napi::Result;
use crate::types::{UIElement, Rect, Point, UIRole};
use std::collections::HashMap;

use windows::Win32::UI::Accessibility::{IUIAutomation, CUIAutomation};
use windows::core::BSTR;
use windows::Win32::System::Com::{CoInitializeEx, CoCreateInstance, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};

#[napi]
pub fn get_focused_element() -> Result<UIElement> {
  unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      
      let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
          .map_err(|e| napi::Error::from_reason(format!("Failed to create IUIAutomation: {}", e)))?;
      
      let element = automation.GetFocusedElement()
          .map_err(|e| napi::Error::from_reason(format!("No focused element: {}", e)))?;
      
      let name = element.CurrentName().unwrap_or(BSTR::default()).to_string();
      let rt = element.CurrentBoundingRectangle().unwrap_or_default();
      let is_enabled = element.CurrentIsEnabled().unwrap_or(windows::Win32::Foundation::BOOL(0)).as_bool();
      let is_focused = element.CurrentHasKeyboardFocus().unwrap_or(windows::Win32::Foundation::BOOL(0)).as_bool();
      
      Ok(UIElement {
          id: "win_focused".to_string(),
          role: UIRole::Window, 
          title: Some(name),
          value: None,
          position: Point { x: rt.left as f64, y: rt.top as f64 },
          size: Rect { 
              x: rt.left as f64, 
              y: rt.top as f64, 
              width: (rt.right - rt.left) as f64, 
              height: (rt.bottom - rt.top) as f64 
          },
          is_enabled,
          is_focused,
          is_selected: false,
          attributes: HashMap::new()
      })
  }
}

#[napi]
pub fn get_element_at_position(x: f64, y: f64) -> Result<UIElement> {
  unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      
      let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
          .map_err(|_| napi::Error::from_reason("COM Error"))?;
          
      let pt = windows::Win32::Foundation::POINT { x: x as i32, y: y as i32 };
      let element = automation.ElementFromPoint(pt)
          .map_err(|_| napi::Error::from_reason("No element found"))?;
          
      let name = element.CurrentName().unwrap_or(BSTR::default()).to_string();
      let rt = element.CurrentBoundingRectangle().unwrap_or_default();
      
      Ok(UIElement {
          id: format!("win_point_{}_{}", x, y),
          role: UIRole::Window,
          title: Some(name),
          value: None,
          position: Point { x: rt.left as f64, y: rt.top as f64 },
          size: Rect { x: rt.left as f64, y: rt.top as f64, width: (rt.right - rt.left) as f64, height: (rt.bottom - rt.top) as f64 },
          is_enabled: true,
          is_focused: false,
          is_selected: false,
          attributes: HashMap::new()
      })
  }
}

fn traverse_element(
    automation: &IUIAutomation,
    walker: &windows::Win32::UI::Accessibility::IUIAutomationTreeWalker,
    element: windows::Win32::UI::Accessibility::IUIAutomationElement,
    elements: &mut Vec<UIElement>,
    depth: i32
) {
    unsafe {
        if let Ok(name) = element.CurrentName() {
            let n = name.to_string();
            if !n.is_empty() {
                let rt = element.CurrentBoundingRectangle().unwrap_or_default();
                let is_enabled = element.CurrentIsEnabled().unwrap_or(windows::Win32::Foundation::BOOL(0)).as_bool();
                let is_focused = element.CurrentHasKeyboardFocus().unwrap_or(windows::Win32::Foundation::BOOL(0)).as_bool();

                elements.push(UIElement {
                    id: format!("win_node_{}", elements.len()),
                    role: UIRole::Window,
                    title: Some(n),
                    value: None,
                    position: Point { x: rt.left as f64, y: rt.top as f64 },
                    size: Rect { 
                        x: rt.left as f64, 
                        y: rt.top as f64, 
                        width: (rt.right - rt.left) as f64, 
                        height: (rt.bottom - rt.top) as f64 
                    },
                    is_enabled,
                    is_focused,
                    is_selected: false,
                    attributes: HashMap::new()
                });
            }
        }
        
        if depth > 5 || elements.len() > 500 { return; } // Reduced safety bound for real-world performance


        let mut child = walker.GetFirstChildElement(&element).ok();
        while let Some(c) = child {
            traverse_element(automation, walker, c.clone(), elements, depth + 1);
            child = walker.GetNextSiblingElement(&c).ok();
        }
    }
}

#[napi]
pub fn get_element_tree(_hwnd: i64) -> Result<Vec<UIElement>> {
  unsafe {
      let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
      let automation: IUIAutomation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER)
          .map_err(|_| napi::Error::from_reason("COM Error"))?;
          
      let root = automation.ElementFromHandle(windows::Win32::Foundation::HWND(_hwnd as isize)).map_err(|_| napi::Error::from_reason("Failed to get element from HWND"))?;
      let walker = automation.ControlViewWalker().map_err(|_| napi::Error::from_reason("No Walker"))?;
      
      let mut elements = Vec::new();
      traverse_element(&automation, &walker, root, &mut elements, 0);
      
      Ok(elements)
  }
}
