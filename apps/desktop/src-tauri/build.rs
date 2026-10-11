fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "subscribe_world",
            "present_event",
            "read_model_settings",
            "save_model_settings",
            "set_endpoint_key",
            "delete_endpoint_key",
            "endpoint_key_status",
            "canon_registry",
            "canon_atlas",
        ]),
    ))
    .expect("tauri build configuration should be valid");
}
