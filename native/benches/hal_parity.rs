use criterion::{criterion_group, criterion_main, Criterion};

// Note: These functions will ONLY compile on macOS since they directly invoke macos stubs.
// In a true cross-platform bench we use `platform::macos` or `platform::windows` dynamically.
#[cfg(target_os = "macos")]
use iliagpt_native::platform::macos::screen_capture::capture_main_display;

#[cfg(target_os = "macos")]
use iliagpt_native::platform::macos::accessibility::get_element_tree;

#[cfg(target_os = "macos")]
fn bench_screen_capture(c: &mut Criterion) {
    let mut group = c.benchmark_group("HAL Latency");
    group.sample_size(10); // Keep small to prevent screen-flash spam if capturing actively
    group.bench_function("capture_screen_macos", |b: &mut criterion::Bencher| b.iter(|| {
        capture_main_display().unwrap();
    }));
    group.finish();
}

#[cfg(target_os = "macos")]
fn bench_accessibility_tree(c: &mut Criterion) {
    let mut group = c.benchmark_group("UI Parser Latency");
    group.sample_size(10);
    group.bench_function("get_element_tree_macos", |b: &mut criterion::Bencher| b.iter(|| {
        get_element_tree(0).unwrap();
    }));
    group.finish();
}

#[cfg(not(target_os = "macos"))]
fn bench_noop(_c: &mut Criterion) {
    // Dummy bench for non-mac environments executing `cargo bench` 
}

#[cfg(target_os = "macos")]
criterion_group!(benches, bench_screen_capture, bench_accessibility_tree);

#[cfg(not(target_os = "macos"))]
criterion_group!(benches, bench_noop);

criterion_main!(benches);
