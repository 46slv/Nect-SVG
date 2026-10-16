//! Opt-in disposable storage. Normal mode changes no directory or environment.
use std::{
    ffi::OsString,
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub const ROOT_ENV: &str = "NECT_SVG_ACCEPTANCE_ROOT";
const ROOT_PREFIX: &str = "nect-svg-acceptance-";

#[derive(Clone, Default)]
pub struct RunStorage(pub Option<AcceptancePaths>);

#[derive(Clone)]
pub struct AcceptancePaths {
    root: PathBuf,
    pub webview: PathBuf,
    documents: PathBuf,
}

fn component_is_unambiguous(value: &str) -> bool {
    let stem = value
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches(' ')
        .to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"];
    let port = stem
        .strip_prefix("COM")
        .or_else(|| stem.strip_prefix("LPT"));
    !value.is_empty()
        && value != "."
        && value != ".."
        && !value.ends_with(['.', ' '])
        && !value
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
        && !reserved.contains(&stem.as_str())
        && !port.is_some_and(|s| {
            ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&s)
        })
}

fn absolute_windows_path(value: &str) -> Result<PathBuf, String> {
    let bytes = value.as_bytes();
    if value.trim() != value
        || bytes.len() < 4
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || !value[3..].split('\\').all(component_is_unambiguous)
    {
        return Err("Acceptance paths require an unambiguous absolute local drive path".into());
    }
    Ok(PathBuf::from(value))
}

fn is_reparse(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

fn check_directory_chain(path: &Path) -> Result<(), String> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&current).map_err(|e| e.to_string())?;
        if !metadata.is_dir() || is_reparse(&metadata) {
            return Err("Acceptance directories must not contain links or reparse points".into());
        }
    }
    Ok(())
}

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    check_directory_chain(path)?;
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    // Use ordinary absolute drive spelling with WebView2 and native dialogs.
    #[cfg(windows)]
    {
        let text = canonical
            .to_str()
            .ok_or("Non-Unicode acceptance directory")?;
        absolute_windows_path(text.strip_prefix(r"\\?\").unwrap_or(text))
    }
    #[cfg(not(windows))]
    {
        Ok(canonical)
    }
}

fn same_path(a: &Path, b: &Path) -> bool {
    // Canonical paths may belong to case-sensitive NTFS directories. Never
    // equate distinct canonical spellings; conservative refusal is intentional.
    a == b
}

impl RunStorage {
    pub fn prepare(
        requested: Option<OsString>,
        executable_directory: impl FnOnce() -> Result<PathBuf, String>,
    ) -> Result<Self, String> {
        let Some(requested) = requested else {
            return Ok(Self::default());
        };
        if !cfg!(windows) {
            return Err("Acceptance storage mode is supported only on Windows".into());
        }
        let text = requested
            .into_string()
            .map_err(|_| "Non-Unicode acceptance root")?;
        let requested = absolute_windows_path(&text)?;
        let name = requested
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("Missing run name")?;
        if !name.starts_with(ROOT_PREFIX) || name.len() == ROOT_PREFIX.len() {
            return Err(
                "Acceptance root needs the prefix nect-svg-acceptance- and a run ID".into(),
            );
        }
        let parent = canonical_directory(requested.parent().ok_or("Missing run parent")?)?;
        let executable = canonical_directory(&executable_directory()?)?;
        if !same_path(&parent, &executable) {
            return Err(
                "Acceptance root must be a new direct child of the isolated EXE directory".into(),
            );
        }
        let root = parent.join(name);
        // Atomic refusal of every existing root, even an empty directory.
        // Never create ancestors or fall back to the ordinary profile.
        fs::create_dir(&root).map_err(|e| format!("Cannot create fresh acceptance root: {e}"))?;
        let paths = AcceptancePaths {
            webview: root.join("webview2"),
            documents: root.join("documents"),
            root,
        };
        fs::create_dir(&paths.webview).map_err(|e| e.to_string())?;
        fs::create_dir(&paths.documents).map_err(|e| e.to_string())?;
        paths.check_directories()?;
        Ok(Self(Some(paths)))
    }

    pub fn dialog(&self) -> rfd::FileDialog {
        let dialog = rfd::FileDialog::new();
        match &self.0 {
            Some(paths) => dialog.set_directory(&paths.documents),
            None => dialog,
        }
    }

    fn document_path(&self, path: &Path, must_exist: bool) -> Result<PathBuf, String> {
        let Some(paths) = &self.0 else {
            return Ok(path.to_path_buf());
        };
        paths.check_directories()?;
        let path = absolute_windows_path(path.to_str().ok_or("Non-Unicode document path")?)?;
        let parent = canonical_directory(path.parent().ok_or("Missing document directory")?)?;
        if !same_path(&parent, &paths.documents) {
            return Err(
                "Acceptance Open/Save is restricted to this run's documents directory".into(),
            );
        }
        let target = parent.join(path.file_name().ok_or("Missing document name")?);
        match fs::symlink_metadata(&target) {
            Ok(metadata) if !metadata.is_file() || is_reparse(&metadata) => {
                return Err("Acceptance documents must be regular files, not links".into());
            }
            Ok(_) => {}
            Err(e) if !must_exist && e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        Ok(target)
    }

    pub fn read_project(&self, path: &Path) -> Result<String, String> {
        let path = self.document_path(path, true)?;
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut text = String::new();
        file.take(50_000_001)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() > 50_000_000 {
            return Err("Project exceeds 50 MB".into());
        }
        Ok(text)
    }

    pub fn write_bytes(&self, path: &Path, contents: &[u8]) -> Result<(), String> {
        let path = self.document_path(path, false)?;
        let parent = path.parent().ok_or("Invalid destination")?;
        let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        staged.write_all(contents).map_err(|e| e.to_string())?;
        staged.as_file().sync_all().map_err(|e| e.to_string())?;
        self.document_path(&path, false)?;
        staged.persist(&path).map_err(|e| e.to_string())?;
        Ok(())
    }
}

impl AcceptancePaths {
    pub fn check_directories(&self) -> Result<(), String> {
        for path in [&self.root, &self.webview, &self.documents] {
            if !same_path(&canonical_directory(path)?, path) {
                return Err("Acceptance directory identity changed".into());
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_ambiguous_windows_spellings() {
        for value in [
            "",
            " ",
            "C:run",
            "run",
            r"\run",
            r"C:\",
            r"C:\run\",
            r"C:\a\..\run",
            r"C:\a\.\run",
            r"C:\a\\run",
            r"\\server\share\run",
            r"\\?\C:\run",
            r"\\.\C:\run",
            r"C:/run",
            r"C:\run.",
            "C:\\run ",
            r"C:\run:stream",
            r"C:\NUL.txt\run",
            r"C:\COM1\run",
            r"C:\LPT¹\run",
            " C:\\run",
        ] {
            assert!(absolute_windows_path(value).is_err(), "accepted {value:?}");
        }
        assert!(absolute_windows_path(r"C:\test space\日本語\nect-svg-acceptance-001").is_ok());
    }

    #[test]
    fn absent_option_does_not_resolve_or_create_any_directory() {
        let storage =
            RunStorage::prepare(None, || panic!("normal mode resolved an EXE path")).unwrap();
        assert!(storage.0.is_none());
    }

    #[test]
    fn canonical_identity_does_not_fold_case_sensitive_directory_names() {
        let first = Path::new(r"C:\task\Bin\documents");
        let second = Path::new(r"C:\task\bin\documents");
        assert!(!same_path(first, second));
        assert!(same_path(first, first));
    }

    #[test]
    fn invalid_opt_in_never_resolves_an_executable_or_falls_back() {
        for value in ["", " ", "relative", "C:relative", r"\\server\share\run"] {
            let result = RunStorage::prepare(Some(OsString::from(value)), || {
                panic!("invalid input reached executable resolution")
            });
            assert!(
                result.is_err(),
                "invalid input became normal mode: {value:?}"
            );
        }
        #[cfg(windows)]
        {
            use std::os::windows::ffi::OsStringExt;
            let invalid = OsString::from_wide(&[0xd800]);
            assert!(RunStorage::prepare(Some(invalid), || panic!("non-Unicode root")).is_err());
        }
    }

    #[cfg(windows)]
    fn fixture() -> (tempfile::TempDir, RunStorage) {
        let directory = tempfile::tempdir().unwrap();
        let base = canonical_directory(directory.path()).unwrap();
        let root = base.join("nect-svg-acceptance-001");
        let storage = RunStorage::prepare(Some(root.into_os_string()), || Ok(base)).unwrap();
        (directory, storage)
    }

    #[test]
    #[cfg(windows)]
    fn fresh_root_and_native_roundtrip_stay_in_disposable_documents() {
        let (_fixture, storage) = fixture();
        let paths = storage.0.as_ref().unwrap();
        assert!(paths.webview.is_dir());
        let file = paths.documents.join("日本語 project.json");
        storage.write_bytes(&file, b"{\"roundtrip\":1}").unwrap();
        assert_eq!(storage.read_project(&file).unwrap(), "{\"roundtrip\":1}");
        storage.write_bytes(&file, b"{\"roundtrip\":2}").unwrap();
        assert_eq!(storage.read_project(&file).unwrap(), "{\"roundtrip\":2}");
        assert_eq!(fs::read_dir(&paths.documents).unwrap().count(), 1);
        assert_eq!(fs::read_dir(&paths.root).unwrap().count(), 2);
    }

    #[test]
    #[cfg(windows)]
    fn existing_root_wrong_parent_and_bad_name_preserve_existing_data() {
        let (fixture, storage) = fixture();
        let paths = storage.0.as_ref().unwrap();
        let base = canonical_directory(fixture.path()).unwrap();
        let sentinel = paths.documents.join("existing.json");
        fs::write(&sentinel, b"preserve").unwrap();
        let again = RunStorage::prepare(Some(paths.root.clone().into_os_string()), || {
            Ok(base.clone())
        });
        assert!(again.is_err());
        let other = tempfile::tempdir().unwrap();
        let outside = canonical_directory(other.path())
            .unwrap()
            .join("nect-svg-acceptance-other");
        let wrong =
            RunStorage::prepare(Some(outside.clone().into_os_string()), || Ok(base.clone()));
        assert!(wrong.is_err());
        assert!(!outside.exists());
        let bad = base.join("normal-profile");
        let invalid = RunStorage::prepare(Some(bad.clone().into_os_string()), || Ok(base.clone()));
        assert!(invalid.is_err());
        assert!(!bad.exists());
        assert_eq!(fs::read(sentinel).unwrap(), b"preserve");
    }

    #[test]
    #[cfg(windows)]
    fn outside_traversal_subdirectory_and_stream_targets_cannot_write() {
        let (fixture, storage) = fixture();
        let paths = storage.0.as_ref().unwrap();
        let outside = canonical_directory(fixture.path())
            .unwrap()
            .join("outside.json");
        fs::write(&outside, b"preserve").unwrap();
        let nested = paths.documents.join("nested");
        fs::create_dir(&nested).unwrap();
        for target in [
            outside.clone(),
            paths.documents.join(r"..\outside.json"),
            nested.join("file.json"),
            paths.documents.join("file.json:stream"),
            paths.webview.join("file.json"),
        ] {
            assert!(storage.write_bytes(&target, b"bad").is_err());
            assert!(storage.read_project(&target).is_err());
        }
        assert_eq!(fs::read(outside).unwrap(), b"preserve");
        assert_eq!(fs::read_dir(&paths.documents).unwrap().count(), 1);
    }

    #[test]
    #[cfg(windows)]
    fn junction_replacement_is_refused_before_native_writes() {
        use std::process::Command;
        let (_fixture, storage) = fixture();
        let paths = storage.0.as_ref().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let sentinel = outside.path().join("preserve.json");
        fs::write(&sentinel, b"unchanged").unwrap();
        fs::remove_dir(&paths.documents).unwrap();
        let result = Command::new("cmd.exe")
            .args(["/D", "/C", "mklink", "/J"])
            .arg(&paths.documents)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "junction fixture failed: {result:?}"
        );
        assert!(storage
            .write_bytes(&paths.documents.join("preserve.json"), b"bad")
            .is_err());
        assert!(storage
            .read_project(&paths.documents.join("preserve.json"))
            .is_err());
        assert_eq!(fs::read(sentinel).unwrap(), b"unchanged");
        fs::remove_dir(&paths.documents).unwrap();
    }

    #[test]
    fn normal_native_file_adapter_retains_existing_transaction_behavior() {
        let fixture = tempfile::tempdir().unwrap();
        let file = fixture.path().join("normal.json");
        let storage = RunStorage::default();
        storage.write_bytes(&file, b"normal").unwrap();
        assert_eq!(storage.read_project(&file).unwrap(), "normal");
        assert_eq!(fs::read_dir(fixture.path()).unwrap().count(), 1);
    }
}
