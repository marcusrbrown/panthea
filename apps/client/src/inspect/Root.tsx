// Chooses between the game and the inspection fixture, from the URL and from
// the Alt+Shift+I chord (a packaged window has no address bar).

import { useEffect, useState } from "react";

import { App } from "../App";
import { InspectView } from "./InspectView";
import { isInspectChord, isInspectRoute } from "./route";

export function Root() {
  const [inspect, setInspect] = useState(() =>
    isInspectRoute(window.location.search, window.location.hash),
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isInspectChord(event)) setInspect((on) => !on);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return inspect ? <InspectView /> : <App />;
}
