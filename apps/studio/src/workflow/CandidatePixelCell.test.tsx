import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CandidatePixelCell, pngDataUrl } from "./CandidatePixelCell";

describe("CandidatePixelCell", () => {
  test("uses the existing data-image CSP for raw PNG bytes", () => {
    expect(pngDataUrl(new Uint8Array([137, 80, 78, 71]))).toBe(
      "data:image/png;base64,iVBORw==",
    );
  });

  test("shows a clear loading state while candidate pixels arrive", () => {
    const html = renderToStaticMarkup(
      createElement(CandidatePixelCell, {
        candidateId: "candidate-1",
        image: { status: "loading" },
      }),
    );

    expect(html).toContain('role="status"');
    expect(html).toContain("Loading candidate pixels");
  });

  test("shows loaded pixels at an integer size with nearest-neighbour filtering", () => {
    const html = renderToStaticMarkup(
      createElement(CandidatePixelCell, {
        candidateId: "candidate-1",
        image: {
          status: "loaded",
          url: "data:image/png;base64,iVBORw==",
          width: 64,
          height: 80,
        },
      }),
    );

    expect(html).toContain('src="data:image/png;base64,iVBORw=="');
    expect(html).toContain('width="128"');
    expect(html).toContain('height="160"');
    expect(html).toContain("image-rendering:pixelated");
    expect(html).toContain('class="candidate-pixels candidate-pixels-stacked"');
    expect(html.indexOf("<figcaption>")).toBeGreaterThan(html.indexOf("<img"));
  });

  test("shows a per-cell error instead of a broken image", () => {
    const html = renderToStaticMarkup(
      createElement(CandidatePixelCell, {
        candidateId: "candidate-1",
        image: {
          status: "failed",
          reason: "Candidate pixels are unavailable.",
        },
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Candidate pixels are unavailable.");
    expect(html).not.toContain("<img");
  });
});
