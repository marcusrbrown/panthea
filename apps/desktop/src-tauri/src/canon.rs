// Native loader for the bundled canon registry (content/greek/assets).
//
// Rust does integrity and containment only: it reads every file under
// `registry/manifests` and `registry/blobs`, keeps those whose sha256 equals
// their file name, and refuses any path that resolves outside the root
// (through `..` or a symlink). It parses no manifest -- the webview parses the
// index and manifests with the contract parser, so the schema has one
// definition, in TypeScript.
//
// The verified set is loaded once at startup and is immutable. Blob bytes are
// held in memory, so serving one never touches the disk again and a file
// swapped after verification can't be served.

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Which kind of root the registry was read from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RootKind {
    /// Release builds: under the app's resource directory.
    Bundled,
    /// Debug builds: the committed repo paths, so `tauri dev` works.
    Repo,
}

/// A file or directory that was dropped, and why. `path` is relative to the
/// root, never absolute.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Problem {
    pub path: String,
    pub reason: String,
}

/// What `canon_registry` returns: texts only, for the webview to parse.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonRegistry {
    pub index: Option<String>,
    pub manifests: Vec<String>,
    pub vocabulary: Option<String>,
    pub root_kind: RootKind,
    pub problems: Vec<Problem>,
}

#[derive(Debug, PartialEq, Eq)]
pub enum AtlasError {
    Malformed,
    Unknown,
}

impl std::fmt::Display for AtlasError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AtlasError::Malformed => write!(f, "atlas hash must be 64 lowercase hex characters"),
            AtlasError::Unknown => write!(f, "atlas is not in the verified canon set"),
        }
    }
}

/// The verified registry, managed as app state.
pub struct CanonStore {
    registry: CanonRegistry,
    blobs: HashMap<String, Vec<u8>>,
}

const REGISTRY_DIR: &str = "registry";
const VOCABULARY_FILE: &str = "vocabulary.json";

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn is_sha256_hex(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn problem(path: &str, reason: impl Into<String>) -> Problem {
    Problem {
        path: path.to_string(),
        reason: reason.into(),
    }
}

/// `root` joined with `relative`, canonicalized (resolving `..` and
/// symlinks), and required to stay inside the canonical `root`. The reason
/// never carries an absolute path.
fn resolve_within(root: &Path, relative: &Path) -> Result<PathBuf, String> {
    let resolved = root
        .join(relative)
        .canonicalize()
        .map_err(|error| format!("unreadable: {error}"))?;
    if resolved.starts_with(root) {
        Ok(resolved)
    } else {
        Err("resolves outside the canon root".to_string())
    }
}

/// A contained, regular file read as UTF-8 text.
fn read_text(root: &Path, relative: &str) -> Result<String, String> {
    let bytes = read_file(root, relative)?;
    String::from_utf8(bytes).map_err(|_| "not valid UTF-8".to_string())
}

fn read_file(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = resolve_within(root, Path::new(relative))?;
    let metadata = fs::metadata(&path).map_err(|error| format!("unreadable: {error}"))?;
    if !metadata.is_file() {
        return Err("not a regular file".to_string());
    }
    fs::read(&path).map_err(|error| format!("unreadable: {error}"))
}

/// Every `<sha256>.<ext>` file directly under `root/dir` whose bytes hash to
/// the name, keyed by that hash. Anything else is dropped with a problem.
fn load_hashed_dir(
    root: &Path,
    dir: &str,
    ext: &str,
    problems: &mut Vec<Problem>,
) -> BTreeMap<String, Vec<u8>> {
    let mut verified = BTreeMap::new();
    let listing = resolve_within(root, Path::new(dir))
        .and_then(|path| fs::read_dir(path).map_err(|error| format!("unreadable: {error}")));
    let entries = match listing {
        Ok(entries) => entries,
        Err(reason) => {
            problems.push(problem(dir, reason));
            return verified;
        }
    };
    let mut names: Vec<String> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();

    let suffix = format!(".{ext}");
    for name in names {
        let relative = format!("{dir}/{name}");
        let Some(stem) = name
            .strip_suffix(&suffix)
            .filter(|stem| is_sha256_hex(stem))
        else {
            problems.push(problem(
                &relative,
                format!("file name is not <sha256>.{ext}"),
            ));
            continue;
        };
        match read_file(root, &relative) {
            Err(reason) => problems.push(problem(&relative, reason)),
            Ok(bytes) if sha256_hex(&bytes) != stem => problems.push(problem(
                &relative,
                "bytes do not match the sha256 in the file name",
            )),
            Ok(bytes) => {
                verified.insert(stem.to_string(), bytes);
            }
        }
    }
    verified
}

/// The root to read and its kind. Debug builds read the repo paths; release
/// builds read the resource directory.
pub fn locate_root(resource_dir: Option<PathBuf>, debug: bool) -> (Option<PathBuf>, RootKind) {
    if debug {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../content/greek/assets");
        (Some(repo), RootKind::Repo)
    } else {
        (resource_dir, RootKind::Bundled)
    }
}

impl CanonStore {
    /// Loads from the root `locate_root` picks.
    pub fn load_for(resource_dir: Option<PathBuf>, debug: bool) -> Self {
        let (root, kind) = locate_root(resource_dir, debug);
        Self::load(root.as_deref(), kind)
    }

    /// Loads `root/registry/**` and `root/vocabulary.json`. Never fails: a
    /// missing or unreadable registry is an empty set plus a problem, so the
    /// game still runs on placeholders.
    pub fn load(root: Option<&Path>, root_kind: RootKind) -> Self {
        let mut problems = Vec::new();
        let mut registry = CanonRegistry {
            index: None,
            manifests: Vec::new(),
            vocabulary: None,
            root_kind,
            problems: Vec::new(),
        };
        let mut blobs = HashMap::new();

        let canonical_root = match root {
            None => Err("no canon root is available".to_string()),
            Some(root) => root
                .canonicalize()
                .map_err(|error| format!("canon root is unreadable: {error}")),
        };
        match canonical_root {
            Err(reason) => problems.push(problem(".", reason)),
            Ok(root) => {
                match resolve_within(&root, Path::new(REGISTRY_DIR)) {
                    Err(reason) => problems.push(problem(REGISTRY_DIR, reason)),
                    Ok(_) => {
                        let index = format!("{REGISTRY_DIR}/index.json");
                        match read_text(&root, &index) {
                            Ok(text) => registry.index = Some(text),
                            Err(reason) => problems.push(problem(&index, reason)),
                        }
                        let manifest_dir = format!("{REGISTRY_DIR}/manifests");
                        let manifests =
                            load_hashed_dir(&root, &manifest_dir, "json", &mut problems);
                        for (hash, bytes) in manifests {
                            match String::from_utf8(bytes) {
                                Ok(text) => registry.manifests.push(text),
                                Err(_) => problems.push(problem(
                                    &format!("{manifest_dir}/{hash}.json"),
                                    "not valid UTF-8",
                                )),
                            }
                        }
                        let blob_dir = format!("{REGISTRY_DIR}/blobs");
                        blobs.extend(load_hashed_dir(&root, &blob_dir, "png", &mut problems));
                    }
                }
                match read_text(&root, VOCABULARY_FILE) {
                    Ok(text) => registry.vocabulary = Some(text),
                    Err(reason) => problems.push(problem(VOCABULARY_FILE, reason)),
                }
            }
        }

        registry.problems = problems;
        CanonStore { registry, blobs }
    }

    pub fn registry(&self) -> &CanonRegistry {
        &self.registry
    }

    /// The verified blob named by `hash`, from memory. A malformed or
    /// unverified hash is refused before anything else happens.
    pub fn atlas(&self, hash: &str) -> Result<&[u8], AtlasError> {
        if !is_sha256_hex(hash) {
            return Err(AtlasError::Malformed);
        }
        self.blobs
            .get(hash)
            .map(Vec::as_slice)
            .ok_or(AtlasError::Unknown)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Fixtures are isolated registries under a temp dir, never the committed
    // canon (docs/solutions/test-failures/canon-registry-polluted-validator-fixtures).

    static NEXT: AtomicU32 = AtomicU32::new(0);

    struct Fixture {
        base: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let base = std::env::temp_dir().join(format!(
                "panthea-canon-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = fs::remove_dir_all(&base);
            fs::create_dir_all(&base).unwrap();
            Fixture { base }
        }

        /// The assets root (`registry/` and `vocabulary.json` live here).
        fn root(&self) -> PathBuf {
            self.base.join("assets")
        }

        /// A sibling of the root whose name starts with the root's name.
        fn outside(&self) -> PathBuf {
            self.base.join("assets-outside")
        }

        fn put(&self, relative: &str, bytes: &[u8]) {
            let path = self.root().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, bytes).unwrap();
        }

        /// Writes content-addressed under `dir`, returns the hash.
        fn put_hashed(&self, dir: &str, ext: &str, bytes: &[u8]) -> String {
            let hash = sha256_hex(bytes);
            self.put(&format!("registry/{dir}/{hash}.{ext}"), bytes);
            hash
        }

        fn load(&self) -> CanonStore {
            CanonStore::load(Some(&self.root()), RootKind::Repo)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    const SPRITE_MANIFEST: &str = r#"{"assetId":"fixture-sprite"}"#;
    const PORTRAIT_MANIFEST: &str = r#"{"assetId":"fixture-portrait"}"#;
    const SPRITE_PNG: &[u8] = b"\x89PNG sprite atlas bytes";
    const PORTRAIT_PNG: &[u8] = b"\x89PNG portrait atlas bytes";
    const VOCABULARY: &str = r#"{"states":["idle"]}"#;

    /// One sprite and one portrait, with an index and vocabulary.
    fn publish_two(fixture: &Fixture) -> (String, String, String, String) {
        let sprite_rev = fixture.put_hashed("manifests", "json", SPRITE_MANIFEST.as_bytes());
        let portrait_rev = fixture.put_hashed("manifests", "json", PORTRAIT_MANIFEST.as_bytes());
        let sprite_blob = fixture.put_hashed("blobs", "png", SPRITE_PNG);
        let portrait_blob = fixture.put_hashed("blobs", "png", PORTRAIT_PNG);
        fixture.put(
            "registry/index.json",
            br#"{"entries":[],"schemaVersion":1}"#,
        );
        fixture.put("vocabulary.json", VOCABULARY.as_bytes());
        (sprite_rev, portrait_rev, sprite_blob, portrait_blob)
    }

    #[test]
    fn sha256_hex_matches_the_known_digest_of_abc() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn a_fixture_registry_with_one_sprite_and_one_portrait_verifies() {
        let fixture = Fixture::new();
        let (_, _, sprite_blob, portrait_blob) = publish_two(&fixture);

        let store = fixture.load();
        let registry = store.registry();

        assert_eq!(registry.problems, vec![]);
        assert_eq!(registry.root_kind, RootKind::Repo);
        assert_eq!(
            registry.index.as_deref(),
            Some(r#"{"entries":[],"schemaVersion":1}"#)
        );
        assert_eq!(registry.vocabulary.as_deref(), Some(VOCABULARY));
        let mut manifests = registry.manifests.clone();
        manifests.sort();
        let mut expected = vec![SPRITE_MANIFEST.to_string(), PORTRAIT_MANIFEST.to_string()];
        expected.sort();
        assert_eq!(manifests, expected);
        assert_eq!(store.atlas(&sprite_blob).unwrap(), SPRITE_PNG);
        assert_eq!(store.atlas(&portrait_blob).unwrap(), PORTRAIT_PNG);
    }

    #[test]
    fn the_registry_payload_serializes_camel_case_with_a_lowercase_root_kind() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        let json = serde_json::to_value(fixture.load().registry()).unwrap();
        assert_eq!(json["rootKind"], "repo");
        assert!(json["manifests"].is_array());
        assert!(json["problems"].is_array());
        assert!(json.get("root_kind").is_none());
    }

    #[test]
    fn a_manifest_whose_bytes_do_not_match_its_name_is_dropped_and_the_rest_load() {
        let fixture = Fixture::new();
        let (sprite_rev, _, sprite_blob, _) = publish_two(&fixture);
        let tampered_name = sha256_hex(b"what the name claims");
        fixture.put(
            &format!("registry/manifests/{tampered_name}.json"),
            br#"{"assetId":"tampered"}"#,
        );

        let store = fixture.load();
        let registry = store.registry();

        assert_eq!(registry.manifests.len(), 2);
        assert!(!registry
            .manifests
            .iter()
            .any(|text| text.contains("tampered")));
        assert_eq!(registry.problems.len(), 1);
        assert_eq!(
            registry.problems[0].path,
            format!("registry/manifests/{tampered_name}.json")
        );
        assert!(registry.problems[0].reason.contains("sha256"));
        assert!(registry
            .manifests
            .iter()
            .any(|text| text == SPRITE_MANIFEST));
        assert!(!sprite_rev.is_empty());
        assert_eq!(store.atlas(&sprite_blob).unwrap(), SPRITE_PNG);
    }

    #[test]
    fn a_blob_whose_bytes_do_not_match_its_name_is_not_served() {
        let fixture = Fixture::new();
        let (_, _, sprite_blob, _) = publish_two(&fixture);
        let tampered_name = sha256_hex(b"what the blob claims");
        fixture.put(
            &format!("registry/blobs/{tampered_name}.png"),
            b"swapped bytes",
        );

        let store = fixture.load();

        assert_eq!(store.atlas(&tampered_name), Err(AtlasError::Unknown));
        assert_eq!(store.registry().problems.len(), 1);
        assert_eq!(
            store.registry().problems[0].path,
            format!("registry/blobs/{tampered_name}.png")
        );
        assert_eq!(store.atlas(&sprite_blob).unwrap(), SPRITE_PNG);
    }

    #[test]
    fn a_file_that_is_not_named_by_a_sha256_is_dropped() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        fixture.put("registry/blobs/notes.png", b"not content addressed");
        fixture.put("registry/manifests/README.md", b"stray");

        let registry = fixture.load().registry().clone();

        assert_eq!(registry.manifests.len(), 2);
        assert_eq!(registry.problems.len(), 2);
    }

    #[test]
    fn a_blob_symlinked_outside_the_root_by_a_relative_path_is_refused() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        let outside_bytes = b"outside atlas";
        let hash = sha256_hex(outside_bytes);
        fs::create_dir_all(fixture.outside()).unwrap();
        fs::write(fixture.outside().join("atlas.png"), outside_bytes).unwrap();
        // The bytes match the name, so only containment can refuse it.
        symlink(
            "../../../assets-outside/atlas.png",
            fixture.root().join(format!("registry/blobs/{hash}.png")),
        )
        .unwrap();

        let store = fixture.load();

        assert_eq!(store.atlas(&hash), Err(AtlasError::Unknown));
        assert_eq!(store.registry().problems.len(), 1);
        assert!(store.registry().problems[0].reason.contains("outside"));
    }

    #[test]
    fn a_manifest_symlinked_outside_the_root_by_an_absolute_path_is_refused() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        let outside_text = br#"{"assetId":"outside"}"#;
        let hash = sha256_hex(outside_text);
        fs::create_dir_all(fixture.outside()).unwrap();
        fs::write(fixture.outside().join("m.json"), outside_text).unwrap();
        symlink(
            fixture.outside().join("m.json"),
            fixture
                .root()
                .join(format!("registry/manifests/{hash}.json")),
        )
        .unwrap();

        let registry = fixture.load().registry().clone();

        assert_eq!(registry.manifests.len(), 2);
        assert!(!registry
            .manifests
            .iter()
            .any(|text| text.contains("outside")));
        assert_eq!(registry.problems.len(), 1);
    }

    #[test]
    fn a_blobs_directory_symlinked_outside_the_root_serves_nothing_from_it() {
        let fixture = Fixture::new();
        let outside_bytes = b"outside atlas";
        let hash = sha256_hex(outside_bytes);
        fs::create_dir_all(fixture.outside().join("blobs")).unwrap();
        fs::write(
            fixture.outside().join(format!("blobs/{hash}.png")),
            outside_bytes,
        )
        .unwrap();
        fs::create_dir_all(fixture.root().join("registry")).unwrap();
        symlink(
            fixture.outside().join("blobs"),
            fixture.root().join("registry/blobs"),
        )
        .unwrap();

        let store = fixture.load();

        assert_eq!(store.atlas(&hash), Err(AtlasError::Unknown));
        assert!(!store.registry().problems.is_empty());
    }

    #[test]
    fn an_index_symlinked_outside_the_root_is_not_returned() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        fs::create_dir_all(fixture.outside()).unwrap();
        fs::write(fixture.outside().join("index.json"), b"secret").unwrap();
        fs::remove_file(fixture.root().join("registry/index.json")).unwrap();
        symlink(
            fixture.outside().join("index.json"),
            fixture.root().join("registry/index.json"),
        )
        .unwrap();

        let registry = fixture.load().registry().clone();

        assert_eq!(registry.index, None);
        assert!(registry
            .problems
            .iter()
            .any(|problem| problem.path == "registry/index.json"));
    }

    #[test]
    fn resolve_within_refuses_dot_dot_that_leaves_the_root() {
        let fixture = Fixture::new();
        fixture.put("registry/index.json", b"{}");
        fs::create_dir_all(fixture.outside()).unwrap();
        fs::write(fixture.outside().join("secret.txt"), b"secret").unwrap();
        let root = fixture.root().canonicalize().unwrap();

        let escaped = resolve_within(&root, Path::new("registry/../../assets-outside/secret.txt"));
        assert!(escaped.unwrap_err().contains("outside"));
        let sibling = resolve_within(&root, Path::new("../assets-outside/secret.txt"));
        assert!(sibling.unwrap_err().contains("outside"));
        // `..` that stays inside is fine.
        let inside = resolve_within(&root, Path::new("registry/../registry/index.json"));
        assert_eq!(inside.unwrap(), root.join("registry/index.json"));
    }

    #[test]
    fn a_malformed_hash_is_refused() {
        let fixture = Fixture::new();
        let (_, _, sprite_blob, _) = publish_two(&fixture);
        let store = fixture.load();

        for bad in [
            "",
            "abc",
            "../../etc/passwd",
            &format!("{sprite_blob}.png"),
            &sprite_blob.to_uppercase(),
            &format!("{}g", &sprite_blob[..63]),
            &format!("{sprite_blob}0"),
        ] {
            assert_eq!(store.atlas(bad), Err(AtlasError::Malformed), "{bad:?}");
        }
    }

    #[test]
    fn an_unknown_hash_is_refused_without_touching_the_disk() {
        let fixture = Fixture::new();
        let (_, _, sprite_blob, _) = publish_two(&fixture);
        let store = fixture.load();
        let unknown = sha256_hex(b"never published");
        // Remove the registry: a refusal must not need it, and a verified atlas
        // is served from memory rather than re-read.
        fs::remove_dir_all(&fixture.base).unwrap();

        assert_eq!(store.atlas(&unknown), Err(AtlasError::Unknown));
        assert_eq!(store.atlas(&sprite_blob).unwrap(), SPRITE_PNG);
    }

    #[test]
    fn a_missing_root_gives_an_empty_set_and_a_problem() {
        let fixture = Fixture::new();
        let store = CanonStore::load(Some(&fixture.root()), RootKind::Repo);
        let registry = store.registry();

        assert!(registry.manifests.is_empty());
        assert_eq!(registry.index, None);
        assert_eq!(registry.vocabulary, None);
        assert!(!registry.problems.is_empty());
        assert_eq!(store.atlas(&sha256_hex(b"x")), Err(AtlasError::Unknown));
    }

    #[test]
    fn no_root_at_all_gives_an_empty_set_and_a_problem() {
        let store = CanonStore::load(None, RootKind::Bundled);
        assert!(store.registry().manifests.is_empty());
        assert_eq!(store.registry().root_kind, RootKind::Bundled);
        assert_eq!(store.registry().problems.len(), 1);
    }

    #[test]
    fn a_registry_without_its_subdirectories_lists_each_as_a_problem() {
        let fixture = Fixture::new();
        fixture.put("registry/index.json", b"{}");
        fixture.put("vocabulary.json", b"{}");

        let registry = fixture.load().registry().clone();

        assert_eq!(registry.index.as_deref(), Some("{}"));
        assert_eq!(registry.problems.len(), 2);
    }

    #[test]
    fn a_release_layout_root_resolves_under_the_resource_dir_and_reports_bundled() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        let resource_dir = fixture.root();

        let (root, kind) = locate_root(Some(resource_dir.clone()), false);
        assert_eq!(root, Some(resource_dir.clone()));
        assert_eq!(kind, RootKind::Bundled);

        let store = CanonStore::load_for(Some(resource_dir), false);
        assert_eq!(store.registry().root_kind, RootKind::Bundled);
        assert_eq!(store.registry().problems, vec![]);
        assert_eq!(store.registry().manifests.len(), 2);
    }

    #[test]
    fn a_release_build_without_a_resource_dir_has_no_root() {
        let (root, kind) = locate_root(None, false);
        assert_eq!(root, None);
        assert_eq!(kind, RootKind::Bundled);
    }

    #[test]
    fn a_debug_build_reads_the_repo_paths_even_when_a_resource_dir_exists() {
        let (root, kind) = locate_root(Some(PathBuf::from("/somewhere/Resources")), true);
        assert_eq!(kind, RootKind::Repo);
        let root = root.unwrap();
        assert!(root.ends_with("content/greek/assets"), "{root:?}");
    }

    #[test]
    fn problems_are_relative_paths_and_never_absolute() {
        let fixture = Fixture::new();
        publish_two(&fixture);
        fixture.put("registry/blobs/notes.png", b"x");
        let problems = fixture.load().registry().problems.clone();
        for problem in problems {
            assert!(
                !problem.path.starts_with('/') && !problem.reason.contains("panthea-canon"),
                "{problem:?}"
            );
        }
    }
}
