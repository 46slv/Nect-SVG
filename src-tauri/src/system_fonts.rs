//! Read-only, bounded font discovery. IPC never accepts a filesystem path.
use std::{collections::HashSet, fs::File, io::{Read, Seek, SeekFrom}, path::{Path, PathBuf}, sync::Mutex};
const MAX_FONT: usize = 20_000_000;
const MAX_SOURCE: u64 = 128_000_000;
const MAX_FILES: usize = 4096;
type Identity = (u64, Option<std::time::SystemTime>, Option<std::time::SystemTime>);
type Entry = (PathBuf, PathBuf, u32, Identity);
fn identity(file: &File) -> Result<Identity, String> {
    let m = file.metadata().map_err(|e| e.to_string())?;
    Ok((m.len(),m.modified().ok(),m.created().ok()))
}
#[derive(Default)]
pub struct Catalog(pub Mutex<Vec<Entry>>);
fn read_at(file: &mut File, offset: u64, size: usize) -> Result<Vec<u8>, String> {
    if size > MAX_FONT || offset.checked_add(size as u64).ok_or("Font bounds overflow")? > file.metadata().map_err(|e| e.to_string())?.len() { return Err("Invalid font bounds".into()); }
    file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut bytes = vec![0; size];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(bytes)
}
fn u16be(b: &[u8], at: usize) -> u16 { u16::from_be_bytes([b[at], b[at+1]]) }
fn u32be(b: &[u8], at: usize) -> u32 { u32::from_be_bytes([b[at], b[at+1], b[at+2], b[at+3]]) }
fn put32(b: &mut [u8], at: usize, n: u32) { b[at..at+4].copy_from_slice(&n.to_be_bytes()); }
fn faces(file: &mut File) -> Result<Vec<u32>, String> {
    let header = read_at(file, 0, 12)?;
    if &header[..4] != b"ttcf" { return Ok(vec![0]); }
    if ![0x00010000, 0x00020000].contains(&u32be(&header, 4)) { return Err("Unsupported collection version".into()); }
    let count = u32be(&header, 8) as usize;
    if count == 0 || count > 256 { return Err("Invalid collection face count".into()); }
    let offsets = read_at(file, 12, count * 4)?;
    Ok((0..count).map(|i| u32be(&offsets, i*4)).collect())
}
fn directory(file: &mut File, offset: u32) -> Result<(Vec<u8>, Vec<u8>), String> {
    let header = read_at(file, offset as u64, 12)?;
    if ![0x00010000, 0x4f54544f].contains(&u32be(&header, 0)) { return Err("Unsupported outline format".into()); }
    let count = u16be(&header, 4) as usize;
    if count == 0 || count > 256 { return Err("Invalid table count".into()); }
    let dir = read_at(file, offset as u64 + 12, count * 16)?;
    let mut tags = HashSet::new();
    let size = file.metadata().map_err(|e| e.to_string())?.len();
    for t in dir.chunks_exact(16) {
        if !tags.insert(t[..4].to_vec()) || u32be(t, 8) as u64 + u32be(t, 12) as u64 > size { return Err("Invalid font table directory".into()); }
    }
    Ok((header, dir))
}
fn reason(dir: &[u8]) -> Option<String> {
    let tags: Vec<&[u8]> = dir.chunks_exact(16).map(|t| &t[..4]).collect();
    if tags.contains(&&b"fvar"[..]) || tags.contains(&&b"CFF2"[..]) { return Some("Variable fonts unsupported".into()); }
    if [b"COLR", b"CBDT", b"sbix", b"SVG "].iter().any(|t| tags.contains(&&t[..])) { return Some("Color/bitmap fonts unsupported".into()); }
    if !tags.contains(&&b"glyf"[..]) && !tags.contains(&&b"CFF "[..]) { return Some("No supported outlines".into()); }
    if dir.chunks_exact(16).map(|t| u32be(t, 12) as u64 + 3).sum::<u64>() + dir.len() as u64 + 12 > MAX_FONT as u64 { return Some("Face exceeds 20 MB".into()); }
    None
}
fn face_name(file: &mut File, dir: &[u8]) -> Option<String> {
    let t = dir.chunks_exact(16).find(|t| &t[..4] == b"name")?;
    let length = u32be(t, 12) as usize;
    if !(6..=65536).contains(&length) { return None; }
    let b = read_at(file, u32be(t, 8) as u64, length).ok()?;
    let count = u16be(&b, 2) as usize;
    let strings = u16be(&b, 4) as usize;
    if 6 + count*12 > b.len() { return None; }
    let mut fallback = None;
    for i in 0..count {
        let p = 6+i*12;
        if u16be(&b,p+6) != 4 || ![0,3].contains(&u16be(&b,p)) { continue; }
        let start = strings + u16be(&b,p+10) as usize;
        let len = u16be(&b,p+8) as usize;
        if len == 0 || len > 1024 || len%2 != 0 || start+len > b.len() { continue; }
        let words: Vec<u16> = b[start..start+len].chunks_exact(2).map(|p| u16be(p,0)).collect();
        let name = String::from_utf16(&words).ok()?;
        if name.chars().any(char::is_control) { continue; }
        if u16be(&b,p+4) == 0x409 { return Some(name); }
        fallback.get_or_insert(name);
    }
    fallback
}
fn checksum(bytes: &[u8]) -> u32 {
    bytes.chunks(4).fold(0u32, |sum, chunk| { let mut b = [0;4]; b[..chunk.len()].copy_from_slice(chunk); sum.wrapping_add(u32::from_be_bytes(b)) })
}
/// Repack one face, preserving outline/layout/license tables. Collection offsets are absolute.
fn extract(file: &mut File, offset: u32) -> Result<Vec<u8>, String> {
    let (header, dir) = directory(file, offset)?;
    if let Some(why) = reason(&dir) { return Err(why); }
    let tables: Vec<&[u8]> = dir.chunks_exact(16).filter(|t| &t[..4] != b"DSIG").collect();
    let count = tables.len();
    let mut bytes = vec![0; 12+count*16];
    bytes[..4].copy_from_slice(&header[..4]);
    bytes[4..6].copy_from_slice(&(count as u16).to_be_bytes());
    let power = 1usize << (usize::BITS - 1 - count.leading_zeros());
    bytes[6..8].copy_from_slice(&((power*16) as u16).to_be_bytes());
    bytes[8..10].copy_from_slice(&(power.trailing_zeros() as u16).to_be_bytes());
    bytes[10..12].copy_from_slice(&((count*16-power*16) as u16).to_be_bytes());
    let mut head = None;
    for (i, t) in tables.iter().enumerate() {
        let length = u32be(t,12) as usize;
        let start = bytes.len();
        let padded = (length+3)&!3;
        if start + padded > MAX_FONT { return Err("Face exceeds 20 MB".into()); }
        let mut data = read_at(file,u32be(t,8) as u64,length)?;
        if &t[..4] == b"head" { if length < 12 { return Err("Invalid head table".into()); } data[8..12].fill(0); head = Some(start); }
        let p = 12+i*16;
        bytes[p..p+4].copy_from_slice(&t[..4]);
        put32(&mut bytes,p+4,checksum(&data));
        put32(&mut bytes,p+8,start as u32);
        put32(&mut bytes,p+12,length as u32);
        bytes.extend(data); bytes.resize(start+padded,0);
    }
    let head = head.ok_or("Missing head table")?;
    let adjustment = 0xb1b0afbau32.wrapping_sub(checksum(&bytes));
    put32(&mut bytes,head+8,adjustment);
    Ok(bytes)
}
fn roots() -> Vec<PathBuf> {
    if !cfg!(windows) { return vec![]; }
    let mut roots = vec![];
    if let Some(w) = std::env::var_os("WINDIR") { roots.push(PathBuf::from(w).join("Fonts")); }
    if let Some(u) = std::env::var_os("LOCALAPPDATA") { roots.push(PathBuf::from(u).join("Microsoft/Windows/Fonts")); }
    roots
}
fn safe_path(path: &Path, root: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    if canonical.parent() != Some(root) { return Err("Font is outside its allowed directory".into()); }
    Ok(canonical)
}
// Validate the opened handle, not only the pre-open path (reparse-point races).
fn open_font(path: &Path, root: &Path) -> Result<File, String> {
    let safe = safe_path(path, root)?;
    let file = File::open(safe).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    {
        use std::os::windows::{io::AsRawHandle, ffi::OsStringExt};
        #[link(name = "kernel32")]
        extern "system" { fn GetFinalPathNameByHandleW(file: *mut std::ffi::c_void, path: *mut u16, size: u32, flags: u32) -> u32; }
        let mut buffer = vec![0u16;32768];
        let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(),buffer.as_mut_ptr(),buffer.len() as u32,0) } as usize;
        if length == 0 || length >= buffer.len() { return Err("Cannot verify installed font path".into()); }
        let final_path = PathBuf::from(std::ffi::OsString::from_wide(&buffer[..length]));
        if final_path.parent() != Some(root) { return Err("Opened font is outside its allowed directory".into()); }
    }
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_SOURCE { return Err("Invalid font file or collection exceeds 128 MB".into()); }
    Ok(file)
}
#[tauri::command]
pub async fn list_system_fonts(state: tauri::State<'_, Catalog>) -> Result<Vec<(String, String, Option<String>)>, String> {
    // Keep opaque IDs stable. A new app session refreshes the catalog.
    let mut catalog = state.inner().0.lock().map_err(|_| "Font catalog unavailable")?;
    let mut result = vec![];
    let mut seen = HashSet::new();
    for root in roots() {
        let Ok(root) = root.canonicalize() else { continue };
        let Ok(entries) = std::fs::read_dir(&root) else { continue };
        for entry in entries.take(MAX_FILES).flatten() {
            if result.len() >= MAX_FILES { break; }
            let path = entry.path();
            let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("").to_ascii_lowercase();
            if !["ttf","otf","ttc","otc"].contains(&ext.as_str()) { continue; }
            let Ok(path) = safe_path(&path,&root) else { continue };
            if !seen.insert(path.clone()) { continue; }
            let Ok(mut file) = open_font(&path,&root) else { continue };
            if file.metadata().map(|m| m.len() > MAX_SOURCE || !m.is_file()).unwrap_or(true) { continue; }
            let Ok(stamp) = identity(&file) else { continue };
            let Ok(offsets) = faces(&mut file) else { continue };
            for (face, offset) in offsets.iter().enumerate() {
                if result.len() >= MAX_FILES { break; }
                let Ok((_,dir)) = directory(&mut file,*offset) else { continue };
                let name = face_name(&mut file,&dir).unwrap_or_else(|| format!("{} · face {}",path.file_name().unwrap_or_default().to_string_lossy(),face+1));
                let index = if let Some(index) = catalog.iter().position(|e| e.0 == path && e.2 == *offset && e.3 == stamp) { index } else {
                    if catalog.len() >= MAX_FILES { continue; }
                    catalog.push((path.clone(),root.clone(),*offset,stamp)); catalog.len()-1
                };
                result.push((format!("system-{index}"),name,reason(&dir)));
            }
        }
    }
    result.sort_by(|a,b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
    Ok(result)
}
#[tauri::command]
pub async fn read_system_font(id: String, state: tauri::State<'_, Catalog>) -> Result<tauri::ipc::Response, String> {
    let index: usize = id.strip_prefix("system-").ok_or("Unknown installed font")?.parse().map_err(|_| "Unknown installed font")?;
    let (path,root,offset,stamp) = state.inner().0.lock().map_err(|_| "Font catalog unavailable")?.get(index).cloned().ok_or("Unknown installed font")?;
    let mut file = open_font(&path,&root)?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_SOURCE { return Err("Font collection exceeds 128 MB".into()); }
    if identity(&file)? != stamp { return Err("Installed font changed; restart to refresh the font list".into()); }
    let bytes = extract(&mut file,offset)?;
    if identity(&file)? != stamp { return Err("Installed font changed during reading; try again".into()); }
    Ok(tauri::ipc::Response::new(bytes))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn standalone_and_collection_roundtrip() {
        let source = include_bytes!("../../public/fonts/DejaVuSans.ttf");
        let mut file = tempfile::tempfile().unwrap();
        use std::io::Write;
        file.write_all(source).unwrap();
        let standalone = extract(&mut file,0).unwrap();
        assert_eq!(checksum(&standalone),0xb1b0afba);
        let mut ttc = vec![0u8;16];
        ttc[..4].copy_from_slice(b"ttcf"); put32(&mut ttc,4,0x10000); put32(&mut ttc,8,1); put32(&mut ttc,12,16);
        ttc.extend_from_slice(source);
        for i in 0..u16be(source,4) as usize { let p = 16+12+i*16+8; let n = u32be(&ttc,p)+16; put32(&mut ttc,p,n); }
        let mut collection = tempfile::tempfile().unwrap(); collection.write_all(&ttc).unwrap();
        assert_eq!(faces(&mut collection).unwrap(),vec![16]);
        assert_eq!(extract(&mut collection,16).unwrap(),standalone);
        let (_,dir) = directory(&mut collection,16).unwrap();
        assert!(face_name(&mut collection,&dir).unwrap().contains("DejaVu"));
    }
    #[test]
    fn second_face_shared_tables_preserves_license_and_rejects_bad_bounds() {
        use std::io::Write;
        let source = include_bytes!("../../public/fonts/DejaVuSans.ttf");
        let count = u16be(source,4) as usize;
        let directory_size = 12+count*16;
        let first = 20usize;
        let second = first+directory_size;
        let data_start = second+directory_size;
        let mut ttc = vec![0;data_start];
        ttc[..4].copy_from_slice(b"ttcf"); put32(&mut ttc,4,0x10000); put32(&mut ttc,8,2);
        put32(&mut ttc,12,first as u32); put32(&mut ttc,16,second as u32);
        ttc[first..first+directory_size].copy_from_slice(&source[..directory_size]);
        ttc[second..second+directory_size].copy_from_slice(&source[..directory_size]);
        ttc.extend_from_slice(source);
        for face in [first,second] {
            for i in 0..count { let p = face+12+i*16+8; let offset = u32be(&ttc,p)+data_start as u32; put32(&mut ttc,p,offset); }
        }
        // Both faces share the same table data. Restricted fsType must survive extraction.
        let os2 = source[12..directory_size].chunks_exact(16).find(|t| &t[..4] == b"OS/2").unwrap();
        let flags = data_start+u32be(os2,8) as usize+8;
        ttc[flags..flags+2].copy_from_slice(&2u16.to_be_bytes());
        let mut f = tempfile::tempfile().unwrap(); f.write_all(&ttc).unwrap();
        let b = extract(&mut f,second as u32).unwrap();
        assert_eq!(checksum(&b),0xb1b0afba);
        let t = b[12..directory_size].chunks_exact(16).find(|t| &t[..4] == b"OS/2").unwrap();
        assert_eq!(u16be(&b,u32be(t,8) as usize+8),2);
        put32(&mut ttc,second+12+8,u32::MAX);
        let mut broken = tempfile::tempfile().unwrap(); broken.write_all(&ttc).unwrap();
        assert!(extract(&mut broken,second as u32).is_err());
    }
    #[test]
    fn rejects_invalid_offsets_and_variable_faces() {
        use std::io::Write;
        let mut f = tempfile::tempfile().unwrap(); f.write_all(&[0;12]).unwrap();
        assert!(extract(&mut f,u32::MAX).is_err());
        let mut dir = vec![0;16]; dir[..4].copy_from_slice(b"fvar");
        assert!(reason(&dir).unwrap().contains("Variable"));
    }
    #[test]
    fn installed_japanese_collection_smoke_when_available() {
        if !cfg!(windows) { return; }
        for root in roots() {
            let Ok(root) = root.canonicalize() else { continue };
            for name in ["meiryo.ttc", "msgothic.ttc", "YuGothM.ttc", "YuGothR.ttc"] {
                let Ok(mut file) = open_font(&root.join(name),&root) else { continue };
                let offsets = faces(&mut file).unwrap();
                let bytes = extract(&mut file,offsets[0]).unwrap();
                let target = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/native-japanese-font-smoke.ttf");
                std::fs::create_dir_all(target.parent().unwrap()).unwrap();
                std::fs::write(target,&bytes).unwrap();
                println!("Installed Japanese TTC extracted for JS parser/layout smoke: {name}");
                return;
            }
        }
        println!("NOT RUN: no known Japanese TTC installed on this Windows runner");
    }
    #[test]
    fn identity_detects_replacement() {
        let root = tempfile::tempdir().unwrap(); let path = root.path().join("font.ttf");
        std::fs::write(&path,b"before").unwrap();
        let before = identity(&File::open(&path).unwrap()).unwrap();
        std::fs::write(&path,b"after is different").unwrap();
        assert_ne!(identity(&File::open(&path).unwrap()).unwrap(),before);
    }
    #[test]
    fn verified_handle_opens_only_regular_file_in_root() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("font.ttf");
        std::fs::write(&path,b"font").unwrap();
        assert!(open_font(&path,&root.path().canonicalize().unwrap()).is_ok());
    }
    #[test]
    fn rejects_paths_outside_root() {
        let root = tempfile::tempdir().unwrap(); let other = tempfile::NamedTempFile::new().unwrap();
        assert!(safe_path(other.path(),&root.path().canonicalize().unwrap()).is_err());
    }
}
