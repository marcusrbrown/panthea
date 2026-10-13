// The committed reference digests, as the checks' expected values. They come
// from a Node decode of the committed blobs (tools/scenarios/studio-zeus-scene),
// never from the webview's own decode.

import reference from "../../../../tools/scenarios/studio-zeus-scene/reference-digests.json";
import type { Reference } from "./reference";

export const REFERENCE: Reference = reference as Reference;
