# ILIAGPT Native Module

This directory contains the Rust API wrapper (using N-API/NAPI-RS) that interfaces with the underlying host OS to provide capabilities such as Screen Capture, Accessibility Tree parsing, and mouse/keyboard automation to the ILIAGPT desktop agent.

## Precompiled Binary (`iliagpt-native.node`)

**CRITICAL NOTE:**
The currently checked-in `iliagpt-native.node` binary in this folder was compiled **specifically for macOS `arm64` (Apple Silicon)**.

If you are developing or building on a different architecture (e.g., macOS `x86_64`, Windows `x64`, Linux `x86_64`), this prebuilt binary **WILL NOT WORK**. You must compile the Rust code for your target platform natively, or rely on the GitHub Actions CI pipeline which uses `cargo` to cross-compile the appropriate binary for each platform before packaging the Electron app.

### Building Natively

To compile the module for your current architecture, ensure you have the Rust toolchain installed:

```bash
cd native
npm install
npm run build:native
```

This will replace the `iliagpt-native.node` with a binary compiled for your system.
