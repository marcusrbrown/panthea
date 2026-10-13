#!/usr/bin/env bash
# Captures the Panthea window, and only that window, to a PNG.
#
#   capture.sh <out.png> [process-name-or-pid]
#
# The process defaults to `panthea-desktop`, the name of both the debug binary
# and the release bundle's executable. The window is found from the process's
# pid through CoreGraphics' window list, then handed to `screencapture -l`, so
# nothing outside that window is ever captured. With no window found the script
# exits non-zero and writes nothing; it never falls back to the desktop.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "usage: capture.sh <out.png> [process-name-or-pid]" >&2
  exit 2
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "capture.sh: macOS only (CoreGraphics window list, screencapture)" >&2
  exit 1
fi

OUT="$1"
TARGET="${2:-panthea-desktop}"

if [[ "$TARGET" =~ ^[0-9]+$ ]]; then
  PID="$TARGET"
else
  # An exact process-name match; the newest one when several run.
  PID="$(pgrep -n -x "$TARGET" || true)"
fi
if [[ -z "${PID:-}" ]]; then
  echo "capture.sh: no running process named '$TARGET'" >&2
  exit 1
fi

# The window of that pid: an ordinary window (layer 0) of useful size, the
# largest when there are several. Windows that are offscreen are included, so a
# window behind others still resolves; a window that is not drawn at all (a
# locked screen, a hidden window) is captured as WindowServer holds it.
WINDOW_ID="$(
  swift - "$PID" <<'SWIFT'
import CoreGraphics
import Foundation

let pid = Int32(CommandLine.arguments[1])!
let windows = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
var best: (id: Int, area: Double)?
for window in windows {
  guard (window[kCGWindowOwnerPID as String] as? Int32) == pid,
        (window[kCGWindowLayer as String] as? Int) == 0,
        let id = window[kCGWindowNumber as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: Double],
        let width = bounds["Width"], let height = bounds["Height"],
        width >= 200, height >= 200
  else { continue }
  if best == nil || width * height > best!.area { best = (id, width * height) }
}
if let best { print(best.id) }
SWIFT
)"

if [[ -z "$WINDOW_ID" ]]; then
  echo "capture.sh: process $PID has no window of at least 200x200 to capture" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT")"
# -l captures that window alone; -o leaves out its shadow; -x makes no sound.
screencapture -x -o -l "$WINDOW_ID" "$OUT"
echo "captured window $WINDOW_ID of pid $PID to $OUT"
