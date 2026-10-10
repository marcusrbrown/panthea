//! The app's one setting: the path to a CLI studio config file, chosen through a
//! native picker and kept in the app data directory. The app and the CLI read
//! the same file, so the app has no config format of its own. This module also
//! reads that file for the one thing native code needs from it: which Aseprite
//! to launch, found the way the session finds it.
//!
//! Nothing here returns a path to the webview, and no error text names one.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

/// The largest config file the app will read or accept.
const MAX_CONFIG_BYTES: u64 = 1024 * 1024;

const SETTINGS_FILE: &str = "settings.json";
const DEFAULT_BUNDLE: &str = "/Applications/Aseprite.app/Contents/MacOS/aseprite";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConfigError {
    Unreadable,
    TooLarge,
    NotJson,
    NotAnObject,
    CannotSave,
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            ConfigError::Unreadable => "the config file cannot be read",
            ConfigError::TooLarge => "the config file is too large",
            ConfigError::NotJson => "the config file is not JSON",
            ConfigError::NotAnObject => "the config file is not a JSON object",
            ConfigError::CannotSave => "the app cannot save the setting",
        })
    }
}

/// Checks that `config` is a readable JSON object. The session does the real
/// validation when it loads the file; this keeps a wrong pick from becoming the
/// setting.
pub fn validate(config: &Path) -> Result<(), ConfigError> {
    read_object(config).map(|_| ())
}

fn read_object(path: &Path) -> Result<serde_json::Map<String, Value>, ConfigError> {
    let size = fs::metadata(path)
        .map_err(|_| ConfigError::Unreadable)?
        .len();
    if size > MAX_CONFIG_BYTES {
        return Err(ConfigError::TooLarge);
    }
    let bytes = fs::read(path).map_err(|_| ConfigError::Unreadable)?;
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(object)) => Ok(object),
        Ok(_) => Err(ConfigError::NotAnObject),
        Err(_) => Err(ConfigError::NotJson),
    }
}

/// Where the setting lives: `settings.json` in the app data directory.
pub struct ConfigStore {
    dir: PathBuf,
}

impl ConfigStore {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    /// The chosen config file, or `None` when none is set. A missing,
    /// unreadable or malformed settings file is "none", never a failure.
    pub fn path(&self) -> Option<PathBuf> {
        let settings = read_object(&self.dir.join(SETTINGS_FILE)).ok()?;
        match settings.get("configPath") {
            Some(Value::String(path)) if !path.is_empty() => Some(PathBuf::from(path)),
            _ => None,
        }
    }

    /// Saves `config` (after `validate`) as the setting, through a temp file and
    /// a rename so a crash never leaves half a file.
    pub fn set(&self, config: &Path) -> Result<(), ConfigError> {
        validate(config)?;
        let absolute = std::path::absolute(config).map_err(|_| ConfigError::CannotSave)?;
        let text = serde_json::to_string(&json!({ "configPath": absolute.to_str() }))
            .map_err(|_| ConfigError::CannotSave)?;
        if absolute.to_str().is_none() {
            return Err(ConfigError::CannotSave);
        }
        fs::create_dir_all(&self.dir).map_err(|_| ConfigError::CannotSave)?;
        let temp = self
            .dir
            .join(format!("{SETTINGS_FILE}.tmp-{}", std::process::id()));
        fs::write(&temp, text)
            .and_then(|()| fs::rename(&temp, self.dir.join(SETTINGS_FILE)))
            .map_err(|_| {
                let _ = fs::remove_file(&temp);
                ConfigError::CannotSave
            })
    }
}

/// The Aseprite to launch: the config's `editor.executable` (a relative path is
/// against the config file's directory), then `aseprite` on `path_var`, then the
/// macOS app bundle. `usable` says whether a path is an executable file.
pub fn editor_executable(
    config: &Path,
    path_var: Option<&str>,
    usable: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    let configured = read_object(config)
        .ok()
        .and_then(|object| {
            object
                .get("editor")?
                .get("executable")?
                .as_str()
                .map(PathBuf::from)
        })
        .map(|executable| {
            if executable.is_absolute() {
                executable
            } else {
                config.parent().unwrap_or(Path::new("")).join(executable)
            }
        });
    configured
        .filter(|path| usable(path))
        .or_else(|| {
            std::env::split_paths(path_var.unwrap_or_default())
                .filter(|dir| !dir.as_os_str().is_empty())
                .map(|dir| dir.join("aseprite"))
                .find(|candidate| usable(candidate))
        })
        .or_else(|| Some(PathBuf::from(DEFAULT_BUNDLE)).filter(|bundle| usable(bundle)))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    struct Dir(PathBuf);

    impl Dir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "panthea-studio-config-{name}-{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Dir(dir)
        }
        fn file(&self, name: &str, text: &str) -> PathBuf {
            let path = self.0.join(name);
            fs::write(&path, text).unwrap();
            path
        }
    }

    impl Drop for Dir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn nothing_is_configured_until_a_config_is_set() {
        let dir = Dir::new("empty");
        assert_eq!(ConfigStore::new(dir.0.join("app")).path(), None);
    }

    #[test]
    fn a_config_that_was_set_is_read_back_and_survives_a_new_store() {
        let dir = Dir::new("roundtrip");
        let config = dir.file("studio.json", r#"{"studioRoot":"/x"}"#);
        let app = dir.0.join("app");

        ConfigStore::new(app.clone()).set(&config).unwrap();

        assert_eq!(ConfigStore::new(app).path(), Some(config));
    }

    #[test]
    fn setting_a_new_config_replaces_the_old_and_leaves_no_temp_file() {
        let dir = Dir::new("replace");
        let first = dir.file("a.json", "{}");
        let second = dir.file("b.json", "{}");
        let app = dir.0.join("app");
        let store = ConfigStore::new(app.clone());

        store.set(&first).unwrap();
        store.set(&second).unwrap();

        assert_eq!(store.path(), Some(second));
        let names: Vec<String> = fs::read_dir(&app)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(names, vec![SETTINGS_FILE.to_string()]);
    }

    #[test]
    fn a_damaged_settings_file_reads_as_not_configured() {
        let dir = Dir::new("damaged");
        let app = dir.0.join("app");
        fs::create_dir_all(&app).unwrap();
        for text in [
            "",
            "not json",
            "[]",
            r#"{"configPath":7}"#,
            r#"{"configPath":""}"#,
            "{}",
        ] {
            fs::write(app.join(SETTINGS_FILE), text).unwrap();
            assert_eq!(ConfigStore::new(app.clone()).path(), None, "{text:?}");
        }
    }

    #[test]
    fn a_pick_that_is_not_a_json_object_is_refused_and_does_not_become_the_setting() {
        let dir = Dir::new("refuse");
        let store = ConfigStore::new(dir.0.join("app"));
        let not_json = dir.file("a.txt", "hello");
        let array = dir.file("b.json", "[1]");
        let missing = dir.0.join("nope.json");
        let big = dir.file(
            "c.json",
            &format!("{{\"x\":\"{}\"}}", "a".repeat(1024 * 1024)),
        );

        assert_eq!(store.set(&not_json), Err(ConfigError::NotJson));
        assert_eq!(store.set(&array), Err(ConfigError::NotAnObject));
        assert_eq!(store.set(&missing), Err(ConfigError::Unreadable));
        assert_eq!(store.set(&big), Err(ConfigError::TooLarge));
        assert_eq!(store.path(), None);
    }

    #[test]
    fn an_error_never_names_the_file() {
        for error in [
            ConfigError::Unreadable,
            ConfigError::TooLarge,
            ConfigError::NotJson,
            ConfigError::NotAnObject,
            ConfigError::CannotSave,
        ] {
            let text = error.to_string();
            assert!(!text.contains('/'), "{text}");
        }
    }

    #[test]
    fn the_configured_editor_wins_and_a_relative_one_is_against_the_configs_directory() {
        let dir = Dir::new("editor");
        let config = dir.file(
            "studio.json",
            r#"{"editor":{"executable":"bin/aseprite","timeoutMs":1,"editPollMs":1}}"#,
        );
        let usable = |path: &Path| {
            path == dir.0.join("bin/aseprite") || path == Path::new("/usr/bin/aseprite")
        };

        assert_eq!(
            editor_executable(&config, Some("/usr/bin"), &usable),
            Some(dir.0.join("bin/aseprite"))
        );
    }

    #[test]
    fn an_absolute_configured_editor_is_used_as_given() {
        let dir = Dir::new("absolute");
        let config = dir.file(
            "studio.json",
            r#"{"editor":{"executable":"/opt/ase/aseprite"}}"#,
        );

        assert_eq!(
            editor_executable(&config, None, &|path| path
                == Path::new("/opt/ase/aseprite")),
            Some(PathBuf::from("/opt/ase/aseprite"))
        );
    }

    #[test]
    fn a_configured_editor_that_is_not_usable_falls_through_to_path_then_the_bundle() {
        let dir = Dir::new("fallthrough");
        let config = dir.file(
            "studio.json",
            r#"{"editor":{"executable":"/gone/aseprite"}}"#,
        );

        assert_eq!(
            editor_executable(&config, Some("/a:/b"), &|path| path
                == Path::new("/b/aseprite")),
            Some(PathBuf::from("/b/aseprite"))
        );
        assert_eq!(
            editor_executable(&config, Some("/a:/b"), &|path| path
                == Path::new(DEFAULT_BUNDLE)),
            Some(PathBuf::from(DEFAULT_BUNDLE))
        );
        assert_eq!(editor_executable(&config, Some("/a:/b"), &|_| false), None);
    }

    #[test]
    fn with_no_editor_in_the_config_path_is_searched_in_order_and_empty_entries_are_skipped() {
        let dir = Dir::new("no-editor");
        let config = dir.file("studio.json", "{}");

        assert_eq!(
            editor_executable(&config, Some(":/first::/second"), &|path| {
                path == Path::new("/first/aseprite") || path == Path::new("/second/aseprite")
            }),
            Some(PathBuf::from("/first/aseprite"))
        );
    }

    #[test]
    fn an_unreadable_or_malformed_config_still_finds_an_editor_on_path() {
        let dir = Dir::new("bad-config");
        let broken = dir.file("studio.json", "not json");
        let missing = dir.0.join("gone.json");
        let usable = |path: &Path| path == Path::new("/usr/bin/aseprite");

        assert_eq!(
            editor_executable(&broken, Some("/usr/bin"), &usable),
            Some(PathBuf::from("/usr/bin/aseprite"))
        );
        assert_eq!(
            editor_executable(&missing, Some("/usr/bin"), &usable),
            Some(PathBuf::from("/usr/bin/aseprite"))
        );
    }
}
