use napi_derive::napi;
use napi::{Result, Error, Status};
use std::collections::HashMap;

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType, CFTypeRef};
use core_foundation::string::{CFString, CFStringRef};
use core_foundation::boolean::CFBoolean;

use accessibility_sys_ng::{
    AXUIElementCreateApplication,
    AXUIElementCopyAttributeValue,
    kAXRoleAttribute,
    kAXTitleAttribute,
    kAXValueAttribute,
    kAXPositionAttribute,
    kAXSizeAttribute,
    kAXChildrenAttribute,
    kAXFocusedAttribute,
    kAXEnabledAttribute,
    AXUIElementRef,
    AXValueGetValue,
    kAXValueTypeCGPoint,
    kAXValueTypeCGSize,
    AXValueRef,
    AXUIElementCreateSystemWide,
};

#[napi(object)]
#[derive(Clone)]
pub struct Point { pub x: f64, pub y: f64 }

#[napi(object)]
#[derive(Clone)]
pub struct Rect { pub x: f64, pub y: f64, pub width: f64, pub height: f64 }

#[napi(string_enum)]
pub enum UIRole {
    Button, TextField, StaticText, Window, Menu, MenuItem,
    CheckBox, RadioButton, Slider, List, ScrollArea, Toolbar,
    Group, Image, Link, TabGroup, Unknown,
}

#[napi(object)]
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
    pub attributes: HashMap<String, String>,
}

unsafe fn get_ax_attribute_cf_type(element: AXUIElementRef, attr: &str) -> Option<CFType> {
    let mut value_ref: CFTypeRef = std::ptr::null();
    let cf_attr = CFString::new(attr);
    let result = AXUIElementCopyAttributeValue(element, cf_attr.as_concrete_TypeRef() as CFStringRef, &mut value_ref);
    if result == 0 && !value_ref.is_null() {
        Some(CFType::wrap_under_create_rule(value_ref))
    } else {
        None
    }
}

unsafe fn get_ax_string(element: AXUIElementRef, attr: &str) -> Option<String> {
    if let Some(cf_type) = get_ax_attribute_cf_type(element, attr) {
        if let Some(cf_str) = cf_type.downcast_into::<CFString>() {
            return Some(cf_str.to_string());
        }
    }
    None
}

unsafe fn get_ax_bool(element: AXUIElementRef, attr: &str) -> bool {
    if let Some(cf_type) = get_ax_attribute_cf_type(element, attr) {
        if let Some(cf_bool) = cf_type.downcast_into::<CFBoolean>() {
            return cf_bool.into();
        }
    }
    false
}

unsafe fn get_ax_point(element: AXUIElementRef, attr: &str) -> Point {
    if let Some(cf_type) = get_ax_attribute_cf_type(element, attr) {
        let val_ref = cf_type.as_CFTypeRef() as AXValueRef;
        #[repr(C)]
        struct CGPoint { x: f64, y: f64 }
        let mut pt = CGPoint { x: 0.0, y: 0.0 };
        if AXValueGetValue(val_ref, kAXValueTypeCGPoint, &mut pt as *mut _ as *mut std::ffi::c_void) {
            return Point { x: pt.x, y: pt.y };
        }
    }
    Point { x: 0.0, y: 0.0 }
}

unsafe fn get_ax_size(element: AXUIElementRef, attr: &str) -> Rect {
    if let Some(cf_type) = get_ax_attribute_cf_type(element, attr) {
        let val_ref = cf_type.as_CFTypeRef() as AXValueRef;
        #[repr(C)]
        struct CGSize { w: f64, h: f64 }
        let mut sz = CGSize { w: 0.0, h: 0.0 };
        if AXValueGetValue(val_ref, kAXValueTypeCGSize, &mut sz as *mut _ as *mut std::ffi::c_void) {
            return Rect { x: 0.0, y: 0.0, width: sz.w, height: sz.h };
        }
    }
    Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 }
}

fn map_role(role_str: &str) -> UIRole {
    match role_str {
        "AXButton" => UIRole::Button,
        "AXTextField" | "AXTextArea" => UIRole::TextField,
        "AXStaticText" => UIRole::StaticText,
        "AXWindow" => UIRole::Window,
        "AXMenu" | "AXMenuBar" => UIRole::Menu,
        "AXMenuItem" => UIRole::MenuItem,
        "AXCheckBox" => UIRole::CheckBox,
        "AXRadioButton" => UIRole::RadioButton,
        "AXSlider" => UIRole::Slider,
        "AXList" | "AXTable" => UIRole::List,
        "AXScrollArea" => UIRole::ScrollArea,
        "AXToolbar" => UIRole::Toolbar,
        "AXGroup" => UIRole::Group,
        "AXImage" => UIRole::Image,
        "AXLink" => UIRole::Link,
        "AXTabGroup" => UIRole::TabGroup,
        _ => UIRole::Unknown,
    }
}

unsafe fn build_tree(element: AXUIElementRef, depth: u32, max_depth: u32, elements: &mut Vec<UIElement>) {
    if depth > max_depth { return; }

    let role_str = get_ax_string(element, kAXRoleAttribute).unwrap_or_default();
    let title = get_ax_string(element, kAXTitleAttribute);
    let value = get_ax_string(element, kAXValueAttribute);
    
    let position = get_ax_point(element, kAXPositionAttribute);
    let mut size = get_ax_size(element, kAXSizeAttribute);
    size.x = position.x;
    size.y = position.y;

    let is_focused = get_ax_bool(element, kAXFocusedAttribute);
    let is_enabled = get_ax_bool(element, kAXEnabledAttribute);

    let id = format!("{}-{}-{}", role_str, position.x, position.y);
    let role = map_role(&role_str);

    elements.push(UIElement {
        id,
        role,
        title,
        value,
        position,
        size,
        is_focused,
        is_enabled,
        is_selected: false,
        attributes: HashMap::new(),
    });

    if let Some(cf_type) = get_ax_attribute_cf_type(element, kAXChildrenAttribute) {
        if let Some(array) = cf_type.downcast_into::<CFArray<*const std::ffi::c_void>>() {
            for child_ptr in array.into_iter() {
                build_tree(*child_ptr as AXUIElementRef, depth + 1, max_depth, elements);
            }
        }
    }
}

#[napi]
pub fn get_focused_element() -> Result<UIElement> {
    unsafe {
        let _system_wide = AXUIElementCreateSystemWide();
        // Since we don't have GetFocusedUIElement directly exposed easily, returning a mock
        // in reality, we'd query kAXFocusedApplicationAttribute then kAXFocusedUIElementAttribute
        let _pt = Point { x: 0.0, y: 0.0 };
        return Ok(UIElement {
            id: "system-focused".to_string(), role: UIRole::Unknown, title: None, value: None,
            position: Point { x: 0.0, y: 0.0 }, size: Rect { x: 0.0, y: 0.0, width: 0.0, height: 0.0 },
            is_enabled: true, is_focused: true, is_selected: false, attributes: HashMap::new()
        });
    }
}

#[napi]
pub fn get_element_tree(pid: i32) -> Result<Vec<UIElement>> {
    let mut elements = Vec::new();
    unsafe {
        let app = AXUIElementCreateApplication(pid);
        build_tree(app, 0, 5, &mut elements); // Max depth 5 for performance
    }
    
    if elements.is_empty() {
        Ok(vec![get_focused_element()?])
    } else {
        Ok(elements)
    }
}

#[napi]
pub fn get_element_attributes(_element_id: String) -> Result<HashMap<String, String>> {
    Ok(HashMap::new())
}
