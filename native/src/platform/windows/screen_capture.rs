#![cfg(target_os = "windows")]
use napi_derive::napi;
use napi::{Result, Error, Status};
use napi::bindgen_prelude::Buffer;
use windows::Win32::Graphics::Gdi::{
    GetDC, ReleaseDC, CreateCompatibleDC, CreateCompatibleBitmap, SelectObject,
    DeleteObject, DeleteDC, BitBlt, GetDIBits, BITMAPINFO, BITMAPINFOHEADER, 
    BI_RGB, DIB_RGB_COLORS, SRCCOPY
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN
};
use windows::Win32::Foundation::HWND;

#[napi]
pub fn capture_screen() -> Result<Buffer> {
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if width == 0 || height == 0 {
            return Err(Error::new(Status::GenericFailure, "Invalid screen metrics".to_string()));
        }

        let hdc_screen = GetDC(HWND(0 as isize));
        let hdc_mem = CreateCompatibleDC(hdc_screen);
        let hbm_screen = CreateCompatibleBitmap(hdc_screen, width, height);

        let hbm_old = SelectObject(hdc_mem, hbm_screen);

        BitBlt(hdc_mem, 0, 0, width, height, hdc_screen, x, y, SRCCOPY).unwrap();

        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height, // top-down
                biPlanes: 1,
                biBitCount: 24, // 24 bpp para BMP estandar
                biCompression: BI_RGB.0,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            },
            bmiColors: [windows::Win32::Graphics::Gdi::RGBQUAD::default(); 1],
        };

        // BMP rows are padded to 4 bytes
        let row_size = ((width * 24 + 31) / 32) * 4;
        let buf_size = (row_size * height) as usize;
        let mut pixels = vec![0u8; buf_size];

        let res = GetDIBits(
            hdc_mem,
            hbm_screen,
            0,
            height as u32,
            Some(pixels.as_mut_ptr() as *mut _),
            &mut bmi,
            DIB_RGB_COLORS,
        );

        // Libera Handles de GDI de Inmediato
        SelectObject(hdc_mem, hbm_old);
        DeleteObject(hbm_screen);
        let _ = ReleaseDC(HWND(0 as isize), hdc_screen);

        if res == 0 {
            return Err(Error::new(Status::GenericFailure, "GetDIBits falló".to_string()));
        }

        let mut bmp_file = Vec::with_capacity(54 + pixels.len());
        // BITMAPFILEHEADER (14 bytes)
        bmp_file.extend_from_slice(b"BM");
        let file_size: u32 = 54 + pixels.len() as u32;
        bmp_file.extend_from_slice(&file_size.to_le_bytes()); // Size
        bmp_file.extend_from_slice(&[0, 0, 0, 0]); // Reserved
        let offset: u32 = 54;
        bmp_file.extend_from_slice(&offset.to_le_bytes()); // Offset to memory map

        // BITMAPINFOHEADER (40 bytes)
        bmp_file.extend_from_slice(&40u32.to_le_bytes()); // Header size
        bmp_file.extend_from_slice(&width.to_le_bytes()); // Width
        let height_h = -height;
        bmp_file.extend_from_slice(&height_h.to_le_bytes()); // Height
        bmp_file.extend_from_slice(&1u16.to_le_bytes()); // Planes
        bmp_file.extend_from_slice(&24u16.to_le_bytes()); // BPP
        bmp_file.extend_from_slice(&0u32.to_le_bytes()); // Compression
        let img_size = pixels.len() as u32;
        bmp_file.extend_from_slice(&img_size.to_le_bytes()); 
        bmp_file.extend_from_slice(&0u32.to_le_bytes());
        bmp_file.extend_from_slice(&0u32.to_le_bytes());
        bmp_file.extend_from_slice(&0u32.to_le_bytes());
        bmp_file.extend_from_slice(&0u32.to_le_bytes());

        bmp_file.extend_from_slice(&pixels);

        Ok(Buffer::from(bmp_file))
    }
}
