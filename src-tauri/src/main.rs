#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::io::{Read, Write};
#[tauri::command]
fn open_document() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new().add_filter("Nect project", &["json"]).pick_file() else { return Ok(None) };
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut text = String::new();
    file.take(50_000_001).read_to_string(&mut text).map_err(|e| e.to_string())?;
    if text.len() > 50_000_000 { return Err("Project exceeds 50 MB".into()); }
    Ok(Some(text))
}
#[tauri::command]
fn save_document(contents: String, suggested_name: String, kind: String) -> Result<bool, String> {
    let limit = if kind == "svg" { 20_000_000 } else { 50_000_000 };
    if contents.len() > limit { return Err("Document exceeds its size limit".into()); }
    let extension = if kind == "svg" { "svg" } else { "json" };
    let Some(path) = rfd::FileDialog::new().set_file_name(&suggested_name).add_filter("Nect document", &[extension]).save_file() else { return Ok(false) };
    // Stage beside the selected destination, then atomically replace it.
    let parent = path.parent().ok_or("Invalid destination")?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staged.write_all(contents.as_bytes()).map_err(|e| e.to_string())?;
    staged.as_file().sync_all().map_err(|e| e.to_string())?;
    staged.persist(&path).map_err(|e| e.to_string())?;
    Ok(true)
}
fn main() {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![open_document, save_document])
        .run(tauri::generate_context!()).expect("Could not start Nect SVG");
}
