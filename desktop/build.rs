fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "backend_start",
            "backend_request",
            "save_export",
        ]),
    ))
    .expect("Unable to build desktop permissions");
}
