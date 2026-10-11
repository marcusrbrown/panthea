// How the packaged inspection fixture is reached. It is a route of the same
// bundle, not gated on `import.meta.env.DEV`: `?inspect=1` or `#inspect`
// selects it, and Alt+Shift+I toggles it from inside a running app, since a
// packaged window has no address bar.

export function isInspectRoute(search: string, hash: string): boolean {
  return (
    new URLSearchParams(search).get("inspect") === "1" || hash === "#inspect"
  );
}

export interface ChordEvent {
  readonly code: string;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export function isInspectChord(event: ChordEvent): boolean {
  return (
    event.code === "KeyI" &&
    event.altKey &&
    event.shiftKey &&
    !event.ctrlKey &&
    !event.metaKey
  );
}
