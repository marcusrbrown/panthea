import {
  EFFECTS_MODES,
  type EffectsMode,
  STRIKE_ASSET,
  type StructureArt,
  strikeAnimation,
} from "@panthea/renderer";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import { type CheckResult, runChecks } from "./check/run";
import { BUILDING_STATES, type BuildingState } from "./harness/building";
import {
  abilitiesForKey,
  animationKeyMessage,
  clockTiming,
  createPlaybackClock,
  directionsForState,
  entryKey,
  expressionAfterListing,
  expressionKeyMessage,
  firstAnimationForState,
  followClipTiming,
  harnessItems,
  harnessSubject,
  type OcclusionPair,
  type PlaybackClock,
  pickIn,
  spriteKeyAfterListing,
  statesForEntry,
} from "./harness/layout";
import { createStrikeScene, type StrikeScene } from "./harness/strike";
import { usePreview } from "./harness/usePreview";
import { inTauri } from "./host/tauri";
import { ZOOMS, type Zoom } from "./renderer/preview";
import type { ListingEntry, Selection, SourceKind } from "./source/port";
import { SOURCE_KINDS } from "./source/port";
import { routePreviewSelection } from "./workflow/actions";
import { type PreviewSelection, WorkflowApp } from "./workflow/Workflow";

type CheckState =
  | { readonly status: "idle" | "running" }
  | { readonly status: "error"; readonly message: string }
  | CheckResult;

declare global {
  interface Window {
    __studioCheck?: CheckState;
  }
}

const keyOf = (selection: Selection) => `${selection.source}:${selection.id}`;

function parseKey(key: string | null): Selection | undefined {
  if (key === null) return undefined;
  const [source, id] = key.split(":");
  return SOURCE_KINDS.includes(source as SourceKind) && id
    ? { source: source as SourceKind, id }
    : undefined;
}

function readParams() {
  const query = new URLSearchParams(window.location.search);
  const zoom = Number(query.get("zoom"));
  const source = query.get("source");
  return {
    check: query.has("check"),
    forceWebGL: query.get("backend") === "webgl",
    animate: query.get("animate") !== "0" && !query.has("check"),
    zoom: (ZOOMS as readonly number[]).includes(zoom) ? (zoom as Zoom) : 2,
    source: SOURCE_KINDS.includes(source as SourceKind)
      ? (source as SourceKind)
      : ("canon" as SourceKind),
    occlusion:
      query.get("occlusion") === "structure-front"
        ? ("structure-front" as const)
        : ("subject-front" as const),
    subject: query.get("subject"),
    portrait: query.get("portrait"),
    ground: query.get("ground"),
  };
}

const describe = (entry: ListingEntry) =>
  `${entry.id}${entry.assetId === entry.id ? "" : ` (${entry.assetId})`}${entry.ok ? "" : " — refused"}`;

export function App() {
  const params = readParams();
  if (params.check || !inTauri()) return <PreviewHarness />;
  return (
    <WorkflowApp
      renderPreview={(selection) => (
        <PreviewHarness compact selection={selection} />
      )}
    />
  );
}

function PreviewHarness({
  compact = false,
  selection,
}: {
  readonly compact?: boolean;
  readonly selection?: PreviewSelection;
}) {
  const selectionSource = selection?.source;
  const selectionId = selection?.id;
  const selectionKind = selection?.kind;
  const selectionRealm = selection?.realm;
  const selectionState = selection?.state;
  const selectionDirection = selection?.direction;
  const params = useMemo(() => {
    const base = readParams();
    if (
      selectionSource === undefined ||
      selectionId === undefined ||
      selectionKind === undefined
    )
      return base;
    const route = routePreviewSelection({
      source: selectionSource,
      id: selectionId,
      kind: selectionKind,
    });
    return {
      ...base,
      source: route.source as SourceKind,
      ...(route.groundKey !== undefined
        ? { ground: route.groundKey }
        : route.subjectKey === undefined
          ? { portrait: route.portraitKey }
          : { subject: route.subjectKey }),
    };
  }, [selectionSource, selectionId, selectionKind]);
  const container = useRef<HTMLDivElement | null>(null);
  const [sourceKind, setSourceKind] = useState<SourceKind>(params.source);
  const [subjectKey, setSubjectKey] = useState(params.subject);
  const [portraitKey, setPortraitKey] = useState(params.portrait);
  const [groundKey, setGroundKey] = useState(params.ground);
  // The ground's offsets step on every few seconds, so the owner sees every variant of the set.
  const [groundCycle, setGroundCycle] = useState(0);
  useEffect(() => {
    if (!params.animate) return;
    const timer = setInterval(() => setGroundCycle((c) => c + 1), 1500);
    return () => clearInterval(timer);
  }, [params.animate]);
  const [focusKind, setFocusKind] = useState<
    PreviewSelection["kind"] | undefined
  >(selectionKind);
  const [state, setState] = useState("");
  const [direction, setDirection] = useState("");
  const [ability, setAbility] = useState<string | undefined>();
  const [expression, setExpression] = useState("");
  const [zoom, setZoom] = useState<Zoom>(params.zoom);
  const [companion, setCompanion] = useState(true);
  const [occlusion, setOcclusion] = useState<OcclusionPair>(params.occlusion);
  const [check, setCheck] = useState<CheckState>({ status: "idle" });
  const [frameIndex, setFrameIndex] = useState(0);
  const [frameDurations, setFrameDurations] = useState<readonly number[]>([]);
  const [isPlaying, setIsPlaying] = useState(params.animate);
  const playbackRef = useRef<PlaybackClock | undefined>(undefined);
  if (playbackRef.current === undefined) {
    playbackRef.current = createPlaybackClock([], undefined, () =>
      performance.now(),
    );
    if (params.animate) playbackRef.current.play();
  }
  const playback = playbackRef.current;
  // The struck structure, the effects toggle and the strike in flight. Its
  // state lives in the scene; a change to it redraws the controls.
  const strikeRef = useRef<StrikeScene | undefined>(undefined);
  if (strikeRef.current === undefined) {
    strikeRef.current = createStrikeScene({ now: () => performance.now() });
  }
  const strikeScene = strikeRef.current;
  const [, redrawScene] = useReducer((count: number) => count + 1, 0);
  const [target, setTarget] = useState<StructureArt>("building");
  const syncFrame = useCallback(() => {
    const next = playback.frame();
    setFrameIndex((current) => (current === next ? current : next));
    // A strike whose bolt just ended has resolved: the building burns.
    if (strikeScene.settle()) redrawScene();
  }, [playback, strikeScene]);
  const handle = usePreview(container, {
    ...params,
    animate: !params.check,
    elapsed: playback.elapsed,
    onTick: syncFrame,
  });
  const { preview, source, listing } = handle;
  const building = strikeScene.building();
  const effectsMode = strikeScene.mode();
  const boltAnimation = strikeScene.bolt().animation;
  const striking = strikeScene.striking();

  const strike = useCallback(async () => {
    if (source === undefined || strikeScene.striking()) return;
    const mode = strikeScene.mode();
    let durations: readonly number[] = [];
    try {
      const resolved = await source.resolve({
        source: "canon",
        id: STRIKE_ASSET,
        animation: strikeAnimation(mode),
      });
      if (resolved.kind === "frames")
        durations = clockTiming(resolved.asset).durations;
    } catch {
      // The strike still resolves; it is the picture that is missing.
    }
    strikeScene.strike(durations, mode);
    redrawScene();
  }, [source, strikeScene]);

  useEffect(() => {
    if (
      selectionSource === undefined ||
      selectionId === undefined ||
      selectionKind === undefined
    )
      return;
    const route = routePreviewSelection({
      source: selectionSource,
      id: selectionId,
      kind: selectionKind,
    });
    setSourceKind(selectionSource);
    if (route.groundKey !== undefined) setGroundKey(route.groundKey);
    if (route.subjectKey !== undefined) {
      setFocusKind("sprite");
      setSubjectKey(route.subjectKey);
      setPortraitKey(null);
    }
    if (route.portraitKey !== undefined) {
      setFocusKind("portrait");
      setPortraitKey(route.portraitKey);
      setSubjectKey(null);
    }
  }, [selectionSource, selectionId, selectionKind]);

  const entries = listing?.entries ?? [];
  const sprites =
    focusKind === "portrait"
      ? []
      : entries.filter(
          (entry) => entry.source === sourceKind && entry.kind === "sprite",
        );
  const portraits =
    focusKind === "sprite"
      ? []
      : entries.filter(
          (entry) => entry.source === sourceKind && entry.kind === "portrait",
        );
  // The ground is the chosen tile set, else the first of this source, else canon's: a sprite draft is
  // judged on the published ground when it has none of its own.
  const tileSets = entries.filter(
    (entry) => entry.kind === "tile" && entry.period !== undefined,
  );
  const groundEntry = ((): ListingEntry | undefined => {
    const inSource = tileSets.filter((entry) => entry.source === sourceKind);
    const picked =
      pickIn(inSource, parseKey(groundKey)) ??
      pickIn(
        tileSets.filter((entry) => entry.source === "canon"),
        undefined,
      );
    return tileSets.find((entry) => picked && keyOf(entry) === keyOf(picked));
  })();
  const subjectChoice = pickIn(sprites, parseKey(subjectKey));
  const portraitChoice = pickIn(portraits, parseKey(portraitKey));
  const subjectChosen = subjectChoice && keyOf(subjectChoice);
  const portraitChosen = portraitChoice && keyOf(portraitChoice);
  const subjectEntry = sprites.find((entry) => keyOf(entry) === subjectChosen);
  const portraitEntry = portraits.find(
    (entry) => keyOf(entry) === portraitChosen,
  );

  // The reset is keyed on what the entry is and what it publishes, not on the
  // listing's object identity: every refresh makes new objects, and a refresh
  // that changes nothing must not move the owner's selection.
  const subjectEntryKey = entryKey(subjectEntry);
  const subjectKeys = JSON.stringify(subjectEntry?.animations ?? []);
  const heldKey = useRef({ state, direction, ability });
  heldKey.current = { state, direction, ability };
  const subjectSeen = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the entry's key and its published keys are what the reset follows
  useEffect(() => {
    const held = heldKey.current;
    const next = spriteKeyAfterListing(subjectEntry, subjectSeen.current, {
      state: held.state,
      direction: held.direction,
      ...(held.ability === undefined ? {} : { ability: held.ability }),
    });
    subjectSeen.current = subjectEntryKey;
    setState(selectionState ?? next?.state ?? "");
    setDirection(selectionDirection ?? next?.direction ?? "");
    setAbility(next?.ability);
  }, [subjectEntryKey, subjectKeys, selectionState, selectionDirection]);

  const portraitEntryKey = entryKey(portraitEntry);
  const portraitExpressions = JSON.stringify(portraitEntry?.expressions ?? []);
  const heldExpression = useRef(expression);
  heldExpression.current = expression;
  const portraitSeen = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the entry's key and its published expressions are what the reset follows
  useEffect(() => {
    setExpression(
      expressionAfterListing(
        portraitEntry,
        portraitSeen.current,
        heldExpression.current,
      ),
    );
    portraitSeen.current = portraitEntryKey;
  }, [portraitEntryKey, portraitExpressions]);

  const currentAnimation = {
    state,
    direction,
    ...(ability === undefined ? {} : { ability }),
  };
  const missingSpriteKey = animationKeyMessage(subjectEntry, currentAnimation);
  const missingExpression = expressionKeyMessage(portraitEntry, expression);
  const availableAbilities = abilitiesForKey(subjectEntry, state, direction);
  const hasUnspecifiedAbility = subjectEntry?.animations.some(
    (key) =>
      key.state === state &&
      key.direction === direction &&
      key.ability === undefined,
  );
  const abilityOptions = [
    ...(hasUnspecifiedAbility ? [""] : []),
    ...availableAbilities,
  ];
  const frameControls = frameDurations.map((duration, frame) => ({
    duration,
    frame,
    key: `frame-${frame}-${duration}`,
  }));

  // The entry is followed by its key and what it publishes, not by object
  // identity, so a listing refresh that changes nothing does not restart playback.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let cancelled = false;
    playback.configure([], undefined);
    setFrameDurations([]);
    setFrameIndex(0);
    preview?.tick(0);

    if (source === undefined) return;

    const request =
      subjectEntry !== undefined && missingSpriteKey === undefined
        ? {
            source: subjectEntry.source,
            id: subjectEntry.id,
            state,
            direction,
            ...(ability === undefined ? {} : { ability }),
          }
        : portraitEntry !== undefined && missingExpression === undefined
          ? {
              source: portraitEntry.source,
              id: portraitEntry.id,
              expression,
            }
          : undefined;
    if (request === undefined) return;

    // The clip is followed, not just resolved once: a new revision can change
    // its timing while every key name stays the same.
    const stop = followClipTiming({
      source,
      request,
      playback,
      onTiming: (durations, frame, playing) => {
        if (cancelled) return;
        setFrameDurations(durations);
        setFrameIndex(frame);
        setIsPlaying(playing);
        preview?.tick(playback.elapsed());
      },
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, [
    source,
    preview,
    subjectEntryKey,
    subjectKeys,
    portraitEntryKey,
    portraitExpressions,
    state,
    direction,
    ability,
    expression,
    missingSpriteKey,
    missingExpression,
    playback,
  ]);

  useEffect(() => {
    if (params.check || preview === undefined || listing === undefined) return;
    void preview.setItems(
      harnessItems({
        subject: harnessSubject(
          parseKey(subjectChosen ?? null),
          selectionSource === undefined || selectionId === undefined
            ? undefined
            : {
                source: selectionSource,
                id: selectionId,
                ...(selectionRealm === undefined
                  ? {}
                  : { realm: selectionRealm }),
              },
        ),
        portrait: parseKey(portraitChosen ?? null),
        state,
        direction,
        ability,
        expression,
        animations: subjectEntry?.animations ?? [],
        expressions: portraitEntry?.expressions ?? [],
        companion,
        occlusion,
        ...(groundEntry?.period === undefined
          ? {}
          : {
              ground: {
                selection: { source: groundEntry.source, id: groundEntry.id },
                period: groundEntry.period,
              },
            }),
        groundCycle,
        structure: { art: target, state: building },
        bolt: {
          animation: boltAnimation,
          elapsedMs: strikeScene.bolt().elapsedMs,
        },
      }),
    );
  }, [
    params.check,
    preview,
    listing,
    subjectChosen,
    portraitChosen,
    subjectEntry,
    portraitEntry,
    selectionSource,
    selectionId,
    selectionRealm,
    state,
    direction,
    ability,
    expression,
    companion,
    occlusion,
    groundEntry,
    groundCycle,
    target,
    building,
    boltAnimation,
    strikeScene,
  ]);

  useEffect(() => {
    preview?.setZoom(zoom);
  }, [preview, zoom]);

  useEffect(() => {
    if (
      !params.check ||
      handle.status !== "ready" ||
      preview === undefined ||
      source === undefined ||
      listing === undefined
    ) {
      return;
    }
    const cancelled = { current: false };
    const running: CheckState = { status: "running" };
    window.__studioCheck = running;
    setCheck(running);
    runChecks({ preview, source, listing, cancelled }).then(
      (result) => {
        if (cancelled.current) return;
        window.__studioCheck = result;
        setCheck(result);
      },
      (error: unknown) => {
        if (cancelled.current) return;
        const failed: CheckState = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        window.__studioCheck = failed;
        setCheck(failed);
      },
    );
    return () => {
      cancelled.current = true;
    };
  }, [params.check, handle.status, preview, source, listing]);

  const problems = [...(listing?.problems ?? []), ...handle.problems];

  return (
    <section
      className={
        compact ? "preview-harness preview-compact" : "preview-harness"
      }
      style={{ padding: compact ? 0 : 12 }}
    >
      {!compact && <h1 style={{ fontSize: 16 }}>Panthea Studio preview</h1>}
      <p>
        {handle.status === "failed"
          ? `Renderer failed: ${handle.failure}`
          : `Renderer: ${handle.backend ?? "starting"}${params.forceWebGL ? " (WebGL2 forced)" : ""}`}
      </p>
      {!params.check && (
        <section className="preview-controls" aria-label="Preview controls">
          <span className="preview-controls-title">Preview controls</span>
          {!compact && (
            <div className="preview-selectors">
              <label>
                Source{" "}
                <select
                  value={sourceKind}
                  onChange={(event) => {
                    setSourceKind(event.target.value as SourceKind);
                    setSubjectKey(null);
                    setPortraitKey(null);
                  }}
                >
                  {SOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {kind === "draft" ? "draft (not approved)" : kind}
                    </option>
                  ))}
                </select>
              </label>
              {focusKind !== "portrait" && (
                <label>
                  Sprite{" "}
                  <select
                    value={subjectChosen ?? ""}
                    onChange={(event) => setSubjectKey(event.target.value)}
                  >
                    {sprites.length === 0 && (
                      <option value="">none (placeholder)</option>
                    )}
                    {sprites.map((entry) => (
                      <option key={keyOf(entry)} value={keyOf(entry)}>
                        {describe(entry)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {focusKind !== "sprite" && (
                <label>
                  Portrait{" "}
                  <select
                    value={portraitChosen ?? ""}
                    onChange={(event) => setPortraitKey(event.target.value)}
                  >
                    {portraits.length === 0 && <option value="">none</option>}
                    {portraits.map((entry) => (
                      <option key={keyOf(entry)} value={keyOf(entry)}>
                        {describe(entry)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="preview-selectors preview-key-selectors">
            {focusKind !== "portrait" && subjectEntry?.kind === "sprite" && (
              <>
                <label>
                  State{" "}
                  <select
                    value={state}
                    onChange={(event) => {
                      const next = event.target.value;
                      const first = firstAnimationForState(subjectEntry, next);
                      setState(next);
                      setDirection(first?.direction ?? "");
                      setAbility(first?.ability);
                    }}
                  >
                    {statesForEntry(subjectEntry).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Direction{" "}
                  <select
                    value={direction}
                    onChange={(event) => {
                      const next = event.target.value;
                      const first = subjectEntry.animations.find(
                        (key) => key.state === state && key.direction === next,
                      );
                      setDirection(next);
                      setAbility(first?.ability);
                    }}
                  >
                    {directionsForState(subjectEntry, state).map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </label>
                {abilityOptions.length > 0 && (
                  <label>
                    Ability{" "}
                    <select
                      value={ability ?? ""}
                      onChange={(event) =>
                        setAbility(event.target.value || undefined)
                      }
                    >
                      {abilityOptions.map((value) => (
                        <option key={value || "none"} value={value}>
                          {value || "no ability"}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </>
            )}
            {focusKind !== "sprite" && portraitEntry?.kind === "portrait" && (
              <label>
                Expression{" "}
                <select
                  value={expression}
                  onChange={(event) => setExpression(event.target.value)}
                >
                  {portraitEntry.expressions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {selection?.supersededBy !== undefined && (
            <p className="preview-key-message" role="status">
              This record was replaced by {selection.supersededBy}; the preview
              shows only the current canon revision, so nothing is drawn for
              this one.
            </p>
          )}
          {(missingSpriteKey !== undefined ||
            missingExpression !== undefined) && (
            <p className="preview-key-message" role="status">
              not in this asset
            </p>
          )}

          <fieldset className="preview-transport">
            <legend>Playback</legend>
            <button
              type="button"
              onClick={() => {
                playback.toggle();
                setIsPlaying(playback.playing());
              }}
            >
              {isPlaying ? "Pause" : "Play"}
            </button>
            <button
              type="button"
              disabled={frameDurations.length === 0}
              onClick={() => {
                playback.step();
                setIsPlaying(false);
                setFrameIndex(playback.frame());
                preview?.tick(playback.elapsed());
              }}
            >
              Step
            </button>
            <span aria-live="polite">
              {frameDurations.length === 0
                ? "No frames"
                : `Frame ${frameIndex + 1} of ${frameDurations.length}`}
            </span>
            <fieldset className="preview-zoom">
              <legend>Zoom</legend>
              {ZOOMS.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={compact ? "compact-zoom" : "zoom"}
                    checked={zoom === value}
                    onChange={() => setZoom(value)}
                  />
                  {value}×
                </label>
              ))}
            </fieldset>
          </fieldset>
          {frameDurations.length > 0 && (
            <fieldset className="preview-frame-strip">
              <legend>Frames</legend>
              {frameControls.map(({ duration, frame, key }) => (
                <button
                  type="button"
                  key={key}
                  className={frameIndex === frame ? "is-current" : undefined}
                  aria-label={`Frame ${frame + 1}, ${duration} milliseconds`}
                  aria-pressed={frameIndex === frame}
                  onClick={() => {
                    playback.scrub(frame);
                    setIsPlaying(false);
                    setFrameIndex(playback.frame());
                    preview?.tick(playback.elapsed());
                  }}
                >
                  {frame + 1}
                </button>
              ))}
            </fieldset>
          )}
          <fieldset className="preview-scene">
            <legend>Scene</legend>
            <label>
              Structure{" "}
              <select
                value={target}
                onChange={(event) =>
                  setTarget(event.target.value as StructureArt)
                }
              >
                <option value="building">Greek house</option>
                <option value="tree">Old Oak</option>
              </select>
            </label>
            <label>
              Building state{" "}
              <select
                value={building}
                onChange={(event) => {
                  strikeScene.setBuilding(event.target.value as BuildingState);
                  redrawScene();
                }}
              >
                {BUILDING_STATES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Effects{" "}
              <select
                value={effectsMode}
                onChange={(event) => {
                  strikeScene.setMode(event.target.value as EffectsMode);
                  redrawScene();
                }}
              >
                {EFFECTS_MODES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={source === undefined || striking}
              onClick={() => void strike()}
            >
              Strike
            </button>
          </fieldset>
          {!compact && (
            <div className="preview-more-controls">
              <label>
                <select
                  aria-label="Occlusion"
                  value={occlusion}
                  onChange={(event) =>
                    setOcclusion(event.target.value as OcclusionPair)
                  }
                >
                  <option value="subject-front">subject in front</option>
                  <option value="structure-front">structure in front</option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={companion}
                  onChange={(event) => setCompanion(event.target.checked)}
                />
                seated companion
              </label>
            </div>
          )}
        </section>
      )}

      <div
        ref={container}
        id="preview"
        style={{
          background: "#171817",
          imageRendering: "pixelated",
        }}
      />

      <section>
        <h2 style={{ fontSize: 14 }}>Problems ({problems.length})</h2>
        <ul id="problems">
          {problems.map((problem) => (
            <li key={`${problem.scope}|${problem.message}`}>
              {problem.scope}: {problem.message}
            </li>
          ))}
        </ul>
      </section>

      {params.check && (
        <section>
          <h2 style={{ fontSize: 14 }}>Check: {check.status}</h2>
          <pre id="check-result">{JSON.stringify(check, null, 2)}</pre>
        </section>
      )}
    </section>
  );
}
