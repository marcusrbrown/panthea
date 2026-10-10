#!/usr/bin/env bash
# Compiles the studio session (tools/studio/src/index.ts) into a standalone Bun
# binary named for the Tauri `externalBin` target triple convention, e.g.
# `panthea-studio-sidecar-aarch64-apple-darwin`. The native host runs it as
# `panthea-studio-sidecar session --config <file> --parent-pid <pid>`.
# Run from anywhere; paths are resolved relative to this script.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STUDIO_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$STUDIO_DIR/../.." && pwd)"
ENTRY="$REPO_ROOT/tools/studio/src/index.ts"

# Derives the Rust target triple from the macOS host; other platforms must
# pass PANTHEA_SIDECAR_TRIPLE/PANTHEA_SIDECAR_TARGET explicitly.
detect_host_triple() {
  local os arch
  os="$(uname -s)"
  arch="$(uname -m)"
  if [[ "$os" != "Darwin" ]]; then
    echo "build-sidecar: unsupported OS '$os' -- this script only auto-derives a target for macOS; set PANTHEA_SIDECAR_TRIPLE and PANTHEA_SIDECAR_TARGET explicitly for other platforms" >&2
    exit 1
  fi
  case "$arch" in
    arm64) echo "aarch64-apple-darwin" ;;
    x86_64) echo "x86_64-apple-darwin" ;;
    *)
      echo "build-sidecar: unrecognized macOS architecture '$arch'" >&2
      exit 1
      ;;
  esac
}

# Maps a Rust target triple to the matching `bun build --compile --target`.
detect_bun_target() {
  case "$1" in
    aarch64-apple-darwin) echo "bun-darwin-arm64" ;;
    x86_64-apple-darwin) echo "bun-darwin-x64" ;;
    *)
      echo "build-sidecar: no known bun --compile target for triple '$1'; set PANTHEA_SIDECAR_TARGET explicitly" >&2
      exit 1
      ;;
  esac
}

if [[ -n "${PANTHEA_SIDECAR_TRIPLE:-}" ]]; then
  TRIPLE="$PANTHEA_SIDECAR_TRIPLE"
else
  TRIPLE="$(detect_host_triple)"
fi

if [[ -n "${PANTHEA_SIDECAR_TARGET:-}" ]]; then
  TARGET="$PANTHEA_SIDECAR_TARGET"
else
  TARGET="$(detect_bun_target "$TRIPLE")"
fi

# The crate's `externalBin` directory; the override lets a test build elsewhere.
OUT_DIR="${PANTHEA_SIDECAR_OUT_DIR:-$STUDIO_DIR/src-tauri/binaries}"
OUT_FILE="$OUT_DIR/panthea-studio-sidecar-$TRIPLE"

mkdir -p "$OUT_DIR"

echo "build-sidecar: compiling $ENTRY -> $OUT_FILE (target=$TARGET, triple=$TRIPLE)"
# Run from the repo root so workspace packages resolve; the Lua export script
# is imported as text and travels inside the binary.
cd "$REPO_ROOT"
bun build --compile --target="$TARGET" "$ENTRY" --outfile "$OUT_FILE"
chmod 755 "$OUT_FILE"

echo "build-sidecar: wrote $OUT_FILE"
ls -lh "$OUT_FILE"
