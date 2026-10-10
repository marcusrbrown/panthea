import { useEffect, useState } from "react";
import type { StudioHost } from "../host/client";

export function pngDataUrl(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

export type CandidatePixelState =
  | { readonly status: "loading" }
  | {
      readonly status: "loaded";
      readonly url: string;
      readonly width: number;
      readonly height: number;
    }
  | { readonly status: "failed"; readonly reason: string };

export function CandidatePixelCell({
  candidateId,
  image,
  onImageError,
}: {
  readonly candidateId: string;
  readonly image: CandidatePixelState;
  readonly onImageError?: () => void;
}) {
  if (image.status === "loading") {
    return (
      <div className="candidate-pixels candidate-pixels-loading" role="status">
        Loading candidate pixels
      </div>
    );
  }

  if (image.status === "failed") {
    return (
      <div className="candidate-pixels candidate-pixels-failed" role="alert">
        {image.reason}
      </div>
    );
  }

  return (
    <figure className="candidate-pixels candidate-pixels-stacked">
      <img
        src={image.url}
        width={image.width * 2}
        height={image.height * 2}
        alt={`${candidateId}, 1× conformed image, ${image.width} by ${image.height} pixels`}
        style={{ imageRendering: "pixelated" }}
        onError={onImageError}
      />
      <figcaption>
        {image.width} × {image.height} px at 1× · shown at 2×
      </figcaption>
    </figure>
  );
}

export function CandidatePixels({
  host,
  candidateId,
}: {
  readonly host: StudioHost;
  readonly candidateId: string;
}) {
  const [image, setImage] = useState<CandidatePixelState>({
    status: "loading",
  });

  useEffect(() => {
    let active = true;
    setImage({ status: "loading" });

    void (async () => {
      try {
        const candidate = await host.candidateFrames(candidateId);
        const firstFrame = candidate.frames[0];
        if (firstFrame?.index !== 0) {
          throw new Error("Candidate image has no first frame.");
        }
        const bytes = await host.previewBytes({
          candidate: candidateId,
          frame: firstFrame.index,
        });
        if (active)
          setImage({
            status: "loaded",
            url: pngDataUrl(bytes),
            width: candidate.width,
            height: candidate.height,
          });
      } catch {
        if (active) {
          setImage({
            status: "failed",
            reason: "Candidate pixels are unavailable.",
          });
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [candidateId, host]);

  const handleImageError = () => {
    setImage({
      status: "failed",
      reason: "Candidate image could not be read.",
    });
  };

  return (
    <CandidatePixelCell
      candidateId={candidateId}
      image={image}
      onImageError={handleImageError}
    />
  );
}
