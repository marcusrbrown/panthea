fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "studio_call",
            "subscribe_studio",
            "preview_bytes",
            "edit_open",
            "edit_export",
            "edit_import",
            "config_status",
            "config_choose",
        ]),
    ))
    .expect("tauri build configuration should be valid");
}
