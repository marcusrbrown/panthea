import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArmConfig } from "./cli";
import { loadManifest } from "./stage";

const root = join(import.meta.dir, "..");
const manifest = loadManifest(join(root, "components.json"));
const files = readdirSync(join(root, "arms")).filter((f) =>
  f.endsWith(".json"),
);
const load = (file: string) =>
  parseArmConfig(JSON.parse(readFileSync(join(root, "arms", file), "utf8")));

describe("arm configs", () => {
  test("every arm has a full and a smoke config", () => {
    for (const arm of Object.keys(manifest.arms)) {
      expect(files).toContain(`${arm}.json`);
      expect(files).toContain(`${arm}.smoke.json`);
    }
    // Plus the Z-Image no-LoRA smoke and full configs: the approved Civitai
    // LoRA needs an authenticated download, so the base model is measured on
    // its own as the no-LoRA fallback arm.
    expect(files).toContain("z-image-turbo-nolora.smoke.json");
    expect(files).toContain("z-image-turbo-nolora.json");
    expect(files).toHaveLength(Object.keys(manifest.arms).length * 2 + 2);
  });

  for (const file of files) {
    const smoke = file.endsWith(".smoke.json");
    const noLora = file.includes("-nolora.");
    test(`${file}: parses, binds loopback and pins manifest components`, () => {
      const config = load(file);
      const configArm = file.replace(/(\.smoke)?\.json$/, "");
      const armName = configArm.replace(/-nolora$/, "");
      expect(config.arm).toBe(configArm);
      const cmd = config.server.cmd;
      expect(cmd[cmd.indexOf("--listen-ip") + 1]).toBe("127.0.0.1");
      expect(config.server.baseUrl).toStartWith("http://127.0.0.1:");
      expect(config.server.binary?.declared?.sha256).toMatch(/^[0-9a-f]{64}$/);

      const pinned = (manifest.arms[armName]?.components ?? []).filter(
        (c) => !noLora || c.role !== "lora",
      );
      expect(
        config.components.map((c) => [c.role, c.path, c.declared?.sha256]),
      ).toEqual(pinned.map((c) => [c.role, c.file, c.sha256]));
      // Every model file the server loads is one of the verified components.
      for (const flag of ["--model", "--diffusion-model", "--llm", "--vae"]) {
        const at = cmd.indexOf(flag);
        if (at >= 0) {
          expect(config.components.map((c) => c.path)).toContain(cmd[at + 1]);
        }
      }
      if (noLora) expect(config.lora).toBeNull();
      else expect(config.lora).not.toBeNull();
    });

    test(`${file}: ${smoke ? "one bounded cell, no warmup, one sample" : "plan matrix with cancel probe"}`, () => {
      const config = load(file);
      if (smoke) {
        expect(config.cells).toHaveLength(1);
        expect(config.warmupCount).toBe(0);
        expect(config.sampleCount).toBe(1);
        expect(config.cancelProbe ?? null).toBeNull();
      } else {
        expect(config.cells.map((c) => `${c.width}x${c.height}`)).toEqual([
          "512x640",
          "768x768",
        ]);
        expect(config.sampleCount).toBe(3);
        expect(config.cancelProbe).not.toBeNull();
      }
      expect(config.timeoutMs).toBeGreaterThan(0);
    });
  }

  test("the arms use the base/non-distilled components and no substitutes", () => {
    const flux = load("flux2-klein-base-4b.smoke.json");
    expect(flux.components.map((c) => c.id)).toContain(
      "flux-2-klein-base-4b-Q4_0",
    );
    const diffusion = flux.components.find((c) => c.role === "diffusion-model");
    expect(diffusion?.path).toContain("klein-base-4b");
    expect(flux.server.cmd.join(" ")).not.toMatch(/distill/i);
    expect(load("sdxl-pixel-art-xl.smoke.json").lora?.multiplier).toBe(1.2);
    expect(load("flux2-klein-base-4b.smoke.json").lora?.multiplier).toBe(1.0);
    expect(load("z-image-turbo.smoke.json").lora?.multiplier).toBe(1.0);
  });

  // Measured, not root-caused: with the default (auto -> "immediately" for
  // the unquantised SDXL checkpoint) the SDXL LoRA cell aborted
  // (SIGABRT in LoraModel::apply); with at_runtime the same cell completed.
  // Keep both configs on the measured setting.
  test("SDXL smoke and full configs use the measured --lora-apply-mode at_runtime", () => {
    for (const file of [
      "sdxl-pixel-art-xl.smoke.json",
      "sdxl-pixel-art-xl.json",
    ]) {
      const cmd = load(file).server.cmd;
      expect(cmd.filter((a) => a === "--lora-apply-mode")).toHaveLength(1);
      expect(cmd[cmd.indexOf("--lora-apply-mode") + 1]).toBe("at_runtime");
    }
  });

  test("the Z-Image no-LoRA full config fulfils the fallback matrix with no LoRA at all", () => {
    const full = load("z-image-turbo-nolora.json");
    const smoke = load("z-image-turbo-nolora.smoke.json");
    const lora = load("z-image-turbo.json");
    // Full plan matrix: both sizes, warmup 1, 3 samples, restart cancellation.
    expect(full.cells.map((c) => `${c.width}x${c.height}`)).toEqual([
      "512x640",
      "768x768",
    ]);
    expect([full.warmupCount, full.sampleCount]).toEqual([1, 3]);
    expect(full.cancelProbe).toEqual(lora.cancelProbe);
    expect(full.cancelProbe).not.toBeNull();
    expect(full.idle).toEqual(lora.idle);
    // Same measured settings as the smoke and the LoRA arm.
    expect([
      full.seed,
      full.prompt,
      full.negativePrompt,
      full.sampleParams,
    ]).toEqual([
      smoke.seed,
      smoke.prompt,
      smoke.negativePrompt,
      smoke.sampleParams,
    ]);
    expect(full.server.cmd).toEqual(smoke.server.cmd);
    expect(full.server.baseUrl).toBe(smoke.server.baseUrl);
    expect([full.timeoutMs, full.server.maxLifetimeMs]).toEqual([
      smoke.timeoutMs,
      smoke.server.maxLifetimeMs,
    ]);
    // Provenance: the LoRA arm's pinned components minus the LoRA, nothing else.
    expect(full.components).toEqual(smoke.components);
    expect(full.components.map((c) => c.role)).toEqual([
      "diffusion-model",
      "text-encoder",
      "vae",
    ]);
    expect(full.lora).toBeNull();
    expect(full.stagingGuidance).toBe(smoke.stagingGuidance);
  });

  test("the blocked Z-Image LoRA arm keeps its Civitai LoRA and is not substituted", () => {
    const full = load("z-image-turbo.json");
    expect(full.lora?.id).toBe("civitai-2454660-pixel-art-style-z-image-turbo");
    expect(full.components.map((c) => c.role)).toContain("lora");
  });

  // Smoke timings extrapolate the FLUX full matrix (16 generations at
  // 512x640 + 768x768, LoRA ~437 s and control ~289 s per 512x640 sample) to
  // over two hours, past the old 2 h server lifetime. The per-generation
  // timeout is unchanged; only the server lifetime is raised.
  test("full configs keep the per-cell 30 min timeout and bound the server lifetime", () => {
    const fullFiles = files.filter((f) => !f.endsWith(".smoke.json"));
    for (const file of fullFiles) {
      const config = load(file);
      expect(config.timeoutMs).toBe(1_800_000);
      expect(config.server.maxLifetimeMs).toBeGreaterThanOrEqual(
        config.timeoutMs,
      );
      const expected =
        file === "flux2-klein-base-4b.json" ? 14_400_000 : 7_200_000;
      expect(config.server.maxLifetimeMs).toBe(expected);
    }
  });

  test("seed and prompt are identical between a smoke and full config", () => {
    for (const arm of Object.keys(manifest.arms)) {
      const a = load(`${arm}.smoke.json`);
      const b = load(`${arm}.json`);
      expect([a.seed, a.prompt, a.sampleParams]).toEqual([
        b.seed,
        b.prompt,
        b.sampleParams,
      ]);
    }
  });
});
