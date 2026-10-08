import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createDomHost, decodePng } from "../renderer/browser";
import { createGpuBackend } from "../renderer/gpu";
import {
  createPreview,
  type Preview,
  type RenderBackend,
  type Zoom,
} from "../renderer/preview";
import { createDevBridgeSource } from "../source/client";
import type { AssetProblem, AssetSource, Listing } from "../source/port";
import { HARNESS_CAMERA } from "./layout";

export interface PreviewParams {
  readonly forceWebGL: boolean;
  readonly animate: boolean;
  readonly zoom: Zoom;
}

export type PreviewStatus = "starting" | "ready" | "failed";

export interface PreviewHandle {
  readonly preview: Preview | undefined;
  readonly source: AssetSource | undefined;
  readonly status: PreviewStatus;
  readonly failure: string | undefined;
  readonly backend: string | undefined;
  readonly problems: readonly AssetProblem[];
  readonly listing: Listing | undefined;
}

export interface StudioDebug {
  readonly backend: () => string | undefined;
  readonly stats: () => { sprites: number; textures: number } | undefined;
  readonly renders: () => number;
  readonly preview: Preview;
}

declare global {
  interface Window {
    __studio?: StudioDebug;
  }
}

export function usePreview(
  container: RefObject<HTMLDivElement | null>,
  params: PreviewParams,
): PreviewHandle {
  const [status, setStatus] = useState<PreviewStatus>("starting");
  const [failure, setFailure] = useState<string>();
  const [backend, setBackend] = useState<string>();
  const [problems, setProblems] = useState<readonly AssetProblem[]>([]);
  const [listing, setListing] = useState<Listing>();
  const [live, setLive] = useState<{ preview: Preview; source: AssetSource }>();
  const initial = useRef(params);

  const addProblem = useCallback((problem: AssetProblem) => {
    setProblems((current) => [...current, problem]);
  }, []);

  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    const options = initial.current;
    const source = createDevBridgeSource();
    let latest: RenderBackend | undefined;
    let renders = 0;
    let frame = 0;
    let disposed = false;

    const preview = createPreview({
      source,
      host: createDomHost(element),
      createBackend: (canvas) => {
        latest = createGpuBackend(canvas, { forceWebGL: options.forceWebGL });
        return latest;
      },
      decode: decodePng,
      devicePixelRatio: () => window.devicePixelRatio,
      zoom: options.zoom,
      camera: HARNESS_CAMERA,
      handlers: {
        onStarted() {
          const name = latest?.name;
          console.info(`[studio] renderer backend: ${name}`);
          setBackend(name);
          setStatus("ready");
        },
        onFailure(message) {
          console.error(`[studio] renderer failed: ${message}`);
          setFailure(message);
          setStatus("failed");
        },
        onProblem: addProblem,
        onRender() {
          renders += 1;
        },
      },
    });

    const list = () =>
      source.list().then(
        (next) => {
          if (!disposed) setListing(next);
        },
        (error: unknown) => {
          addProblem({
            scope: "listing",
            message: error instanceof Error ? error.message : String(error),
          });
        },
      );
    void list();
    const unsubscribe = source.subscribe((change) => {
      if (change.listing) void list();
    });

    const start = performance.now();
    const loop = () => {
      preview.tick(performance.now() - start);
      frame = requestAnimationFrame(loop);
    };
    if (options.animate) frame = requestAnimationFrame(loop);

    window.__studio = {
      backend: () => preview.backendName(),
      stats: () => latest?.layer.stats,
      renders: () => renders,
      preview,
    };
    setLive({ preview, source });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      unsubscribe();
      preview.dispose();
      if (window.__studio?.preview === preview) delete window.__studio;
      setLive(undefined);
    };
  }, [container, addProblem]);

  return {
    preview: live?.preview,
    source: live?.source,
    status,
    failure,
    backend,
    problems,
    listing,
  };
}
