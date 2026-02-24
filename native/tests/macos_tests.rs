#[cfg(target_os = "macos")]
mod macos_tests {
    use iliagpt_native::platform::macos::screen_capture::capture_main_display;

    #[test]
    fn test_capture_screen_returns_valid_jpeg() {
        let result = capture_main_display();
        assert!(result.is_ok(), "capture_screen should return Ok");

        let buffer = result.unwrap();
        // Check standard JPEG magic bytes (FF D8 FF)
        assert!(buffer.len() > 100, "Buffer should have a reasonable size");
        assert_eq!(buffer[0], 0xFF);
        assert_eq!(buffer[1], 0xD8);
        assert_eq!(buffer[2], 0xFF);
    }
}
