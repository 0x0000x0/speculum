//! Which file to open at launch: command-line paths, the last-opened file,
//! and the `.speculum` extension rule. Pure helpers so the app shell stays thin.

use std::path::{Path, PathBuf};

/// File extension of Speculum documents (without the dot).
pub const EXTENSION: &str = "speculum";

/// Name of the small text file (in the app config dir) remembering the last file.
pub const LAST_FILE_NAME: &str = "last-file.txt";

/// True when `path` ends in `.speculum` (case-insensitive).
pub fn is_speculum_path(path: &Path) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().eq_ignore_ascii_case(EXTENSION))
        .unwrap_or(false)
}

/// Append `.speculum` when a save path has no or another extension.
pub fn with_speculum_extension(path: &Path) -> PathBuf {
    if is_speculum_path(path) {
        path.to_path_buf()
    } else {
        let mut s = path.as_os_str().to_os_string();
        s.push(".");
        s.push(EXTENSION);
        PathBuf::from(s)
    }
}

/// The document path passed on a command line (`argv[0]` is the program).
/// Flags (`-x`, `--x`) are skipped, as are `file://` URL prefixes; relative
/// paths are resolved against `cwd`. Returns the first `.speculum` argument.
pub fn path_from_args<S: AsRef<str>>(args: &[S], cwd: Option<&Path>) -> Option<PathBuf> {
    args.iter().skip(1).find_map(|a| {
        let a = a.as_ref().trim().trim_matches('"');
        if a.is_empty() || a.starts_with('-') {
            return None;
        }
        let a = a.strip_prefix("file://").unwrap_or(a);
        let p = PathBuf::from(a);
        if !is_speculum_path(&p) {
            return None;
        }
        Some(match cwd {
            Some(dir) if p.is_relative() => dir.join(p),
            _ => p,
        })
    })
}

/// Read the remembered last file from `config_dir`. Only returns a path that
/// still exists and is a `.speculum` file.
pub fn read_last_file(config_dir: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(config_dir.join(LAST_FILE_NAME)).ok()?;
    let p = PathBuf::from(text.trim());
    (is_speculum_path(&p) && p.is_file()).then_some(p)
}

/// Remember `path` as the last-opened file.
pub fn write_last_file(config_dir: &Path, path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(config_dir)?;
    std::fs::write(
        config_dir.join(LAST_FILE_NAME),
        path.to_string_lossy().as_bytes(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extension_rule() {
        assert!(is_speculum_path(Path::new("a/b/Map.speculum")));
        assert!(is_speculum_path(Path::new("Map.SPECULUM")));
        assert!(!is_speculum_path(Path::new("Map.json")));
        assert!(!is_speculum_path(Path::new("speculum")));
        assert_eq!(
            with_speculum_extension(Path::new("x/Map")),
            PathBuf::from("x/Map.speculum")
        );
        assert_eq!(
            with_speculum_extension(Path::new("x/Map.speculum")),
            PathBuf::from("x/Map.speculum")
        );
    }

    #[test]
    fn args_pick_first_document() {
        let cwd = Path::new("/home/u");
        assert_eq!(path_from_args(&["app"], Some(cwd)), None);
        assert_eq!(
            path_from_args(&["app", "--flag", "notes.txt", "Map.speculum"], Some(cwd)),
            Some(PathBuf::from("/home/u/Map.speculum"))
        );
        assert_eq!(
            path_from_args(&["app", "/abs/One Two.speculum"], Some(cwd)),
            Some(PathBuf::from("/abs/One Two.speculum"))
        );
        assert_eq!(
            path_from_args(&["app", "\"rel.speculum\""], None),
            Some(PathBuf::from("rel.speculum"))
        );
        assert_eq!(
            path_from_args(&["app", "file:///abs/x.speculum"], None),
            Some(PathBuf::from("/abs/x.speculum"))
        );
    }

    #[test]
    fn last_file_roundtrip() {
        let dir = std::env::temp_dir().join(format!("spec-last-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_last_file(&dir), None);
        let doc = dir.join("Doc.speculum");
        write_last_file(&dir, &doc).unwrap();
        // Not on disk yet -> ignored.
        assert_eq!(read_last_file(&dir), None);
        std::fs::write(&doc, b"{}").unwrap();
        assert_eq!(read_last_file(&dir), Some(doc.clone()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
