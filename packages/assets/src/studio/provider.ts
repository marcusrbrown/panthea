// The selected local image profile, as data: pins and settings copied from the
// Unit 1 probe (tools/probes/art-local-2/components.json and the
// z-image-turbo-nolora arm). Z-Image-Turbo without a LoRA is the draft
// generator. Paths are relative to a configured artifact root; nothing here
// downloads, probes the network or names a hosted fallback.

import type { ProviderDescriptor } from "@panthea/contracts";

export const PROVIDER = {
  id: "sd-server-z-image-turbo",
  medium: "image",
  hosting: "local",
} as const satisfies ProviderDescriptor;

interface Artifact {
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface SelectedProfile {
  readonly runtime: {
    readonly id: string;
    readonly commit: string;
    readonly license: string;
    readonly archive: Artifact & { readonly file: string };
    readonly binary: { readonly path: string; readonly sha256: string };
  };
  readonly components: readonly (Artifact & {
    readonly role: string;
    readonly id: string;
    readonly file: string;
    readonly license: string;
  })[];
  readonly serverFlags: readonly string[];
  readonly sampling: {
    readonly sampleMethod: string;
    readonly sampleSteps: number;
    readonly txtCfg: number;
  };
  /** Masked edits sample with classifier-free guidance and a distilled guidance, as the probe's CLI runs measured; plain generation keeps `sampling.txtCfg`. */
  readonly edit: {
    readonly txtCfg: number;
    readonly distilledGuidance: number;
  };
  readonly negativePrompt: string;
  /** Generation sizes the probe measured; each is the native cell times `generationScale`. */
  readonly measuredCells: readonly { readonly w: number; readonly h: number }[];
  readonly generationScale: number;
}

export const SELECTED_PROFILE: SelectedProfile = {
  runtime: {
    id: "sd-cpp-master-929-3f8527a",
    commit: "3f8527a46c54ecf4cb4ed6003da8e8982283c73c",
    license: "MIT",
    archive: {
      file: "bin/sd-release.zip",
      sizeBytes: 35049086,
      sha256:
        "1c8ee6c8e413e3335b1223bbc657ea5d86dae1819f8426a98b84c265587eb192",
    },
    binary: {
      path: "bin/release/sd-server",
      sha256:
        "37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae",
    },
  },
  components: [
    {
      role: "diffusion-model",
      id: "z_image_turbo-Q3_K",
      file: "models/z_image_turbo-Q3_K.gguf",
      sizeBytes: 3143559104,
      sha256:
        "4b44bdaa7814f20d7cf144e3939bd93aa32f50660204dd0c2aea5c5376232980",
      license: "Apache-2.0",
    },
    {
      role: "text-encoder",
      id: "Qwen3-4B-Instruct-2507-Q4_K_M",
      file: "models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf",
      sizeBytes: 2497281120,
      sha256:
        "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597",
      license: "Apache-2.0",
    },
    {
      role: "vae",
      id: "z-image-ae",
      file: "models/ae.safetensors",
      sizeBytes: 335304388,
      sha256:
        "afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38",
      license: "Apache-2.0",
    },
  ],
  serverFlags: ["--offload-to-cpu", "--diffusion-fa"],
  sampling: { sampleMethod: "euler", sampleSteps: 8, txtCfg: 1 },
  edit: { txtCfg: 7, distilledGuidance: 1 },
  negativePrompt:
    "blurry, antialiased, smooth gradients, photograph, 3d render, text, watermark",
  measuredCells: [
    { w: 512, h: 640 },
    { w: 768, h: 768 },
  ],
  generationScale: 8,
};
