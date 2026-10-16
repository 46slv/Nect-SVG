#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod acceptance_storage;
#[rustfmt::skip]
mod system_fonts;
use acceptance_storage::RunStorage;
use system_fonts::{list_system_fonts, read_system_font, Catalog};

#[tauri::command]
fn open_document(storage: tauri::State<'_, RunStorage>) -> Result<Option<String>, String> {
    let Some(path) = storage
        .dialog()
        .add_filter("Nect project", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    storage.read_project(&path).map(Some)
}

#[tauri::command]
fn save_document(
    contents: String,
    suggested_name: String,
    kind: String,
    storage: tauri::State<'_, RunStorage>,
) -> Result<bool, String> {
    if kind != "svg" && kind != "json" {
        return Err("Unsupported document kind".into());
    }
    if contents.len() > 50_000_000 {
        return Err("Document exceeds its size limit".into());
    }
    let extension = if kind == "svg" { "svg" } else { "json" };
    let Some(path) = storage
        .dialog()
        .set_file_name(&suggested_name)
        .add_filter("Nect document", &[extension])
        .save_file()
    else {
        return Ok(false);
    };
    storage.write_bytes(&path, contents.as_bytes())?;
    Ok(true)
}

#[tauri::command]
fn save_png(
    bytes: Vec<u8>,
    suggested_name: String,
    storage: tauri::State<'_, RunStorage>,
) -> Result<bool, String> {
    if bytes.len() > 64_000_000 || !bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]) {
        return Err("Invalid PNG or PNG exceeds 64 MB".into());
    }
    let Some(path) = storage
        .dialog()
        .set_file_name(&suggested_name)
        .add_filter("PNG image", &["png"])
        .save_file()
    else {
        return Ok(false);
    };
    storage.write_bytes(&path, &bytes)?;
    Ok(true)
}

// Run before Builder::run: Tauri otherwise prepares its ordinary data directory
// for automatic windows before WebView2 sees environment overrides.
fn acceptance_window(
    config: &mut tauri::Config,
    enabled: bool,
) -> Result<Option<tauri::utils::config::WindowConfig>, String> {
    if !enabled {
        return Ok(None);
    }
    if config.app.windows.len() != 1 || !config.app.windows[0].create {
        return Err("Acceptance mode requires exactly one automatic window".into());
    }
    let window = config.app.windows[0].clone();
    config.app.windows[0].create = false;
    Ok(Some(window))
}

fn run() -> Result<(), String> {
    let requested = std::env::var_os(acceptance_storage::ROOT_ENV);
    let mut context = tauri::generate_context!();
    let window = acceptance_window(context.config_mut(), requested.is_some())?;
    let storage = RunStorage::prepare(requested, || {
        std::env::current_exe()
            .map_err(|e| e.to_string())?
            .parent()
            .map(std::path::Path::to_path_buf)
            .ok_or_else(|| "Cannot locate acceptance executable directory".to_string())
    })?;
    if let Some(paths) = &storage.0 {
        // Process-only, before Tauri starts threads. This wins over an inherited
        // WebView2 UDF/registry override. The explicit builder directory also
        // prevents Tauri itself from creating its ordinary profile first.
        std::env::set_var("WEBVIEW2_USER_DATA_FOLDER", &paths.webview);
    }
    let window_storage = storage.clone();
    tauri::Builder::default()
        .manage(storage)
        .manage(Catalog::default())
        .invoke_handler(tauri::generate_handler![
            open_document,
            save_document,
            save_png,
            list_system_fonts,
            read_system_font
        ])
        .setup(move |app| {
            if let Some(config) = window {
                let paths = window_storage.0.as_ref().ok_or("Missing acceptance storage")?;
                paths.check_directories()?;
                tauri::WebviewWindowBuilder::from_config(app, &config)?
                    .data_directory(paths.webview.clone())
                    .build()?;
            }
            Ok(())
        })
        .run(context)
        .expect("Could not start Nect SVG");
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Nect SVG startup failed: {error}");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod startup_tests {
    use super::*;

    #[test]
    fn normal_windows_are_unchanged_and_acceptance_disables_auto_creation() {
        let mut config = tauri::Config::default();
        config.app.windows = vec![Default::default()];
        let before = config.app.windows[0].clone();
        assert!(acceptance_window(&mut config, false).unwrap().is_none());
        assert_eq!(config.app.windows[0].create, before.create);
        assert_eq!(config.app.windows[0].data_directory, before.data_directory);
        let manual = acceptance_window(&mut config, true).unwrap().unwrap();
        assert!(manual.create);
        assert!(!config.app.windows[0].create);
    }

    #[test]
    fn ambiguous_window_configuration_fails_without_mutation() {
        for count in [0, 2] {
            let mut config = tauri::Config::default();
            config.app.windows = vec![Default::default(); count];
            assert!(acceptance_window(&mut config, true).is_err());
            assert!(config.app.windows.iter().all(|window| window.create));
        }
        let mut config = tauri::Config::default();
        config.app.windows = vec![Default::default()];
        config.app.windows[0].create = false;
        assert!(acceptance_window(&mut config, true).is_err());
    }
}
