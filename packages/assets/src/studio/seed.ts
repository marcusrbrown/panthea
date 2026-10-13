/**
 * The highest seed a studio job may carry: 2^32 - 1, the range the pinned image
 * engine has been exercised on. A request's base seed plus its last ordinal must
 * not pass it, whether the jobs come from a submit or a reroll.
 *
 * A leaf module with no imports, so the webview takes it through the
 * browser-safe subpath without pulling in a `node:` module.
 */
export const MAX_SEED = 4_294_967_295;
