fn main() {
    unsafe {
        let windows = core_graphics::window::CGWindowListCopyWindowInfo(
            core_graphics::window::kCGWindowListOptionOnScreenOnly,
            core_graphics::window::kCGNullWindowID,
        );
        println!("Got windows");
    }
}
