import type { ModelEndpointStatus, Realm } from "@panthea/contracts";
import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  type CanonProblem,
  type CanonSource,
  createCanonClient,
  createTauriCanonSource,
} from "./assets/canon";
import {
  type ConnectedFrame,
  type ConnectionError,
  createTauriTransport,
  type ModelSettingsTransport,
  presentEvent,
  subscribe,
  type Transport,
} from "./connection";
import {
  browserEffectsStorage,
  browserMatchMedia,
  createEffectsSetting,
  type EffectsStorage,
  type MatchMedia,
} from "./effects";
import { previewView } from "./fixtures";
import {
  createObserver,
  followedPlace,
  type ObserverTarget,
  type ObserverView,
} from "./observer";
import { createReceiptEmitter } from "./receipts";
import { createRecovery } from "./recovery";
import { drawableEvents, receiptDrawnEvents } from "./renderer/presentation";
import { rebuildAfterDeviceLoss } from "./renderer/recovery";
import { SceneHost } from "./renderer/SceneHost";
import {
  createWorldRendererFactory,
  type RendererFactory,
} from "./renderer/scene";
import { createWorldStore, type WorldViewModel } from "./store";
import {
  browserDismissalStorage,
  createSummaryDismissal,
  type DismissalStorage,
  dismissSummary,
  isSummaryDismissed,
} from "./summary";
import { ClientSurface } from "./ui/surface";

export interface ClientDependencies {
  readonly transport?: Transport & ModelSettingsTransport;
  readonly subscribe?: (
    onFrame: (connected: ConnectedFrame) => void,
    onError: (error: ConnectionError) => void,
  ) => Promise<void>;
  readonly presentEvent?: (eventId: string, sessionId: string) => Promise<void>;
  /**
   * Where canon art comes from: the verified registry and its atlases. By
   * default the shell's two canon commands; with no shell (browser dev) or in
   * fixture mode, none, and every actor draws as its placeholder.
   */
  readonly canon?: CanonSource;
  readonly rendererFactory?: RendererFactory;
  readonly initialView?: WorldViewModel;
  readonly fixture?: boolean;
  /** Where a dismissed catch-up summary is remembered; defaults to the browser's localStorage. */
  readonly summaryStorage?: DismissalStorage;
  /** Where the effects setting is remembered; defaults to the browser's localStorage. */
  readonly effectsStorage?: EffectsStorage;
  /** Seeds the effects setting from the reduced-motion preference; defaults to the browser's matchMedia. */
  readonly matchMedia?: MatchMedia;
}

export function App({
  dependencies = {},
}: {
  readonly dependencies?: ClientDependencies;
}) {
  const store = useMemo(() => createWorldStore(), []);
  const observer = useMemo(() => createObserver(), []);
  const recovery = useMemo(() => createRecovery(store), [store]);
  const [view, setView] = useState<WorldViewModel | undefined>(
    dependencies.initialView,
  );
  const [observation, setObservation] = useState<ObserverView>({
    kind: "idle",
  });
  const [receiptErrors, setReceiptErrors] = useState<string[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [endpointStatuses, setEndpointStatuses] = useState<
    readonly ModelEndpointStatus[]
  >([]);
  const summaryDismissal = useMemo(
    () =>
      createSummaryDismissal(
        dependencies.summaryStorage ?? browserDismissalStorage(),
      ),
    [dependencies.summaryStorage],
  );
  // Re-renders the surface after an explicit Dismiss; the dismissal itself
  // lives in `summaryDismissal` and its storage.
  const [, setDismissals] = useState(0);
  // The effects setting is presentation only: the renderer reads it when a
  // strike starts, it is never sent anywhere, and changing it restarts nothing.
  const effectsSetting = useMemo(
    () =>
      createEffectsSetting({
        storage: dependencies.effectsStorage ?? browserEffectsStorage(),
        matchMedia: dependencies.matchMedia ?? browserMatchMedia(),
      }),
    [dependencies.effectsStorage, dependencies.matchMedia],
  );
  const [effects, setEffects] = useState(() => effectsSetting.mode());
  useEffect(() => {
    setEffects(effectsSetting.mode());
    return effectsSetting.subscribe(setEffects);
  }, [effectsSetting]);
  const [rendererEpoch, setRendererEpoch] = useState(0);
  const [artProblems, setArtProblems] = useState<readonly string[]>([]);
  const fixtureMode =
    dependencies.fixture ??
    (import.meta.env.DEV &&
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("fixture") === "1");
  // One registry client for the app's life, so the registry and every atlas
  // are fetched once and survive a device-loss remount of the renderer.
  const canon = useMemo(() => {
    const source =
      dependencies.canon ??
      (!fixtureMode && isTauri() ? createTauriCanonSource() : undefined);
    return createCanonClient({
      ...(source === undefined ? {} : { source }),
      onProblem: (problem: CanonProblem) =>
        setArtProblems((problems) => [
          ...problems.slice(-3),
          `${problem.scope}: ${problem.message}`,
        ]),
    });
  }, [dependencies.canon, fixtureMode]);
  const rendererFactory = useMemo(
    () =>
      dependencies.rendererFactory ??
      createWorldRendererFactory({ canon, effects: effectsSetting.mode }),
    [canon, dependencies.rendererFactory, effectsSetting],
  );
  const transport = useMemo(
    () => dependencies.transport ?? createTauriTransport(),
    [dependencies.transport],
  );
  const receiptEmitter = useMemo(
    () =>
      createReceiptEmitter({
        presentEvent:
          dependencies.presentEvent ??
          (fixtureMode
            ? async () => {}
            : (eventId, sessionId) =>
                presentEvent(eventId, sessionId, transport)),
        onError: (error) =>
          setReceiptErrors((errors) => [...errors.slice(-3), error.message]),
      }),
    [dependencies.presentEvent, fixtureMode, transport],
  );
  // Held receipts belong to the emitter that drew them: drop them, and the
  // drain's timer, when it is replaced or the app unmounts. (Disposal leaves the
  // emitter usable, so a development remount that reuses it is unharmed.)
  useEffect(() => () => receiptEmitter.dispose(), [receiptEmitter]);

  const acceptFrame = useCallback(
    (connected: ConnectedFrame) => {
      // Before the frame is drawn, and whether or not it draws anything: a
      // sidecar restart must drop held receipts of the old session even when
      // the viewed realm presents no event to notice it.
      receiptEmitter.observeSession(connected.frame.sessionId);
      store.apply(connected.frame, connected.state);
      setEndpointStatuses(connected.frame.modelEndpoints ?? []);
    },
    [receiptEmitter, store],
  );

  useEffect(() => {
    let mounted = true;
    const apply = (connected: ConnectedFrame) => {
      if (mounted) acceptFrame(connected);
    };
    const onError = (error: ConnectionError) => {
      if (mounted)
        setReceiptErrors((errors) => [...errors.slice(-3), error.message]);
    };
    let startSubscription: (() => void) | undefined;

    if (dependencies.initialView) {
      setView(dependencies.initialView);
    } else if (fixtureMode) {
      const initial = previewView();
      observer.pick({ kind: "actor", id: "wanderer" });
      setView(initial);
      setObservation(observer.update(initial));
    } else {
      const subscribeFrames =
        dependencies.subscribe ??
        ((onFrame, onError) => subscribe(onFrame, onError, transport));
      startSubscription = () => {
        void subscribeFrames(apply, onError);
      };
    }

    const stop = store.onChange((next) => {
      if (mounted) {
        setView(next);
        setObservation(observer.update(next));
      }
    });
    startSubscription?.();
    return () => {
      mounted = false;
      stop();
    };
  }, [
    acceptFrame,
    dependencies.initialView,
    dependencies.subscribe,
    fixtureMode,
    observer,
    store,
    transport,
  ]);

  const onPick = useCallback(
    (target: ObserverTarget) => {
      observer.pick(target);
      if (view) setObservation(observer.update(view));
    },
    [observer, view],
  );

  const dismissedSummary = isSummaryDismissed(view, summaryDismissal);
  const place = followedPlace(observation, view ?? undefined);
  const realm: Realm = place?.realm ?? "mortal";

  const onDrawn = useCallback(
    (eventIds: readonly string[]) => {
      if (!view || !eventIds.length) return;
      const drawn = drawableEvents(view, realm).filter((event) =>
        eventIds.includes(event.id),
      );
      void receiptDrawnEvents(view.sessionId, drawn, receiptEmitter);
    },
    [realm, receiptEmitter, view],
  );

  const onDeviceLost = useCallback(() => {
    rebuildAfterDeviceLoss(
      () => recovery.rebuild(),
      (rebuilt) => {
        setView(rebuilt);
        setObservation(observer.update(rebuilt));
      },
    );
    setRendererEpoch((epoch) => epoch + 1);
  }, [observer, recovery]);

  return (
    <ClientSurface
      view={view}
      observation={observation}
      onPick={onPick}
      onDismissCatchUp={() => {
        dismissSummary(view, summaryDismissal);
        setDismissals((count) => count + 1);
      }}
      dismissedSummary={dismissedSummary}
      receiptErrors={receiptErrors}
      artProblems={artProblems}
      settingsOpen={settingsOpen}
      onOpenSettings={() => setSettingsOpen(true)}
      onCloseSettings={() => setSettingsOpen(false)}
      settingsTransport={transport}
      endpointStatuses={endpointStatuses}
      effects={effects}
      onEffectsChange={effectsSetting.set}
      scene={
        <SceneHost
          key={rendererEpoch}
          view={view}
          realm={realm}
          locationId={place?.locationId}
          rendererFactory={rendererFactory}
          onDrawn={onDrawn}
          onDeviceLost={onDeviceLost}
        />
      }
    />
  );
}
