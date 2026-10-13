# studio-render: does the render engine design hold on the real machine?

Status: probe, 2026-10-12, one machine, one session. Evidence for U7 of `docs/plans/2026-10-12-001-feat-retro-render-pipeline-plan.md` (R5, R8, R2; X02). Nothing here is product code. Renders, staging copies and raw logs live under the gitignored `scratch/`; no kit file, texture or image is committed.

**Short answer.** EEVEE renders from a sidecar-style launch, and a Zeus slot (16 frames × colour, part-ID, depth at 4×) takes 5–6 s end to end with the same pixels every time. SIGTERM and SIGKILL stop Blender within 0.1 s; **SIGINT does not cancel it**. Staging can be observed independently, and Blender itself does not fail on a texture read outside staging, so the static closure check has to be the gate. **Memory did not finish: sd-server's first generation took memory pressure to critical on this machine, and the run was stopped there.** The animation library has a closed seated loop that misses the preregistered height proxy. A forced no-GPU state crashes Blender before any script runs, so exit code 10 cannot be produced that way.

## Preregistration

The pass criteria are in [`criteria.json`](criteria.json) and were written and hashed before any measurement run.

| | |
| --- | --- |
| File | `tools/probes/studio-render/criteria.json` |
| sha256 | `fb7dc62fcaa95d2c6951359985b17121b75f16dc556fa0f21fd9001f4376a5a5` |
| Size | 15704 bytes |
| Hashed at | 2026-10-12T22:26:14Z (2026-10-12 15:26 local) |

Only tooling checks ran before this point (a `sandbox-exec` plus `cat` trial and a `log show` query, to learn what an independent observation could see). No Blender run, no `sd-server` run and no measurement of any criterion had happened.

**Integrity note.** After the hash was recorded, a Biome `--write` run reformatted `criteria.json` (whitespace only; 16070 bytes). The original bytes were rebuilt from the file-edit backup plus the one recorded wording edit and checked against the recorded hash (identical, 15704 bytes). `biome.json` now excludes the file so the formatter cannot touch it again. The hash was re-checked after the last edit to this directory; see [Final check](#final-check).

## Environment

| | |
| --- | --- |
| Host | Apple M1 Pro (MacBookPro18,3), 16 GiB, macOS 15.7.9 |
| Bun | 1.4.3 |
| Blender | 5.2.2 LTS, build hash `d13f752e3b9c`, build date 2026-09-15 (`/Applications/Blender.app`, arm64 only) |
| GPU, as Blender reports it | backend METAL, renderer "Metal API", vendor Apple M1 Pro, version 1.2 |
| Kits | read from `<main-checkout>/tools/probes/retro-render/models/` and `.../blender-sprite/models/`; staged copies only under `scratch/staging/` |
| `sd-server` | `<main-checkout>/tools/probes/art-local-2/bin/release/sd-server`, sha256 `37fa5c1dfa673262abdf8ba0b9294144c7d666dbec40e688a1596d975fe57cae` (equals `SELECTED_PROFILE.runtime.binary.sha256`), started with the profile's three components and `serverFlags` |
| Host state | busy before any probe load: memory pressure level 1–2 and 11–12 GB of swap in use at the start of each memory phase |

## Method

- `blender/probe_render.py` (GPL-3.0-or-later header on line 1, the only file here that imports `bpy`) runs inside Blender. Its `slot` mode imports the retro-render probe's `render_retro.py`, restricts item `zeus-tall` to one clip and one facing (`dataclasses.replace` on the item) and calls `render_retro.main()` unchanged. Nothing was copied. Other modes: `gpu` (renders one 8×8 EEVEE frame; exit 0, or 10 if that raises), `terminal`, `clips`, `read`, `version`. Exit codes: 0 ok, 10 no GPU context, 11 version or build mismatch, 12 input error; a Python exception exits 1.
- `src/*.ts` (Bun, MIT) is the driver. `src/proc.ts` spawns with the same shape as `launch` in `packages/assets/src/studio/runtime.ts`: `spawn(binary, argv, { detached: true, shell: false, stdio: ['ignore','pipe','pipe'], env })`, checks through `ps` that the child's pgid equals its pid and differs from the supervisor's, and uses `stopGroup`'s "gone" test (child closed and no process left in the pgid). `src/sampler.ts` takes the clock and the command runner as parameters (5 unit tests on a fake clock, in `src/sampler.test.ts`).
- The slot: item `zeus-tall`, 112×96 cell rendered at 448×384 (4×), clip `walk16`, facing `south`, 16 frames, three passes per frame (48 renders).
- Commands (from the repo root; run the long ones detached and poll `scratch/results/*.json`):

```text
bun tools/probes/studio-render/src/run.ts stage              # copy only the kit files the recipe imports into scratch/staging
bun tools/probes/studio-render/src/run.ts env                # smallest env that renders (a)
bun tools/probes/studio-render/src/run.ts render <name> [--unstaged] [--depth16] [--clip c] [--extra-clip id:action:frames:loop]
bun tools/probes/studio-render/src/run.ts compare <runA> <runB> <resultName>   # decoded-pixel comparison (d, k)
bun tools/probes/studio-render/src/run.ts controls|formats|heights|png-control|clips|pin|gpu|cancel|terminal-control
bun tools/probes/studio-render/src/run.ts memory-control|memory|memory-loaded
bun tools/probes/studio-render/src/run.ts observe [staged|sanity|planted-texture|planted-buffer|unstaged|all]
```

## Results

Run counts are per criterion; nothing is generalised past them.

| | Criterion | Verdict | Numbers |
| --- | --- | --- | --- |
| a | EEVEE from a sidecar-style launch, no terminal | **pass** | Exit 0 and every expected PNG decoded in each of 8 complete walk16 slot renders (48 PNGs each; 64 for the run with the extra 16-bit depth files), and in the idle and seated runs. An **empty env object** was enough (the env search stopped at step 0). Engine `BLENDER_EEVEE`, Metal. In the child: stdin, stdout and stderr not ttys, opening `/dev/tty` fails ("Device not configured"), pgid = pid = sid. Control: through `script` the same checks report ttys and an openable `/dev/tty` |
| b | Cancel: SIGINT, SIGTERM, SIGKILL to the group mid-render | **fail** (SIGINT) / pass (SIGTERM, SIGKILL) | Bound 12000 ms (`termGraceMs` 2000 + `killMs` 10000). SIGTERM 91, 81, 68 ms; SIGKILL 78, 68, 78 ms; no survivor in any of 9 trials. **SIGINT: 2314, 2149, 2220 ms and exit 0, because the render ignored it and finished** (all 16 colour frames, `probe-done.json` written). Preregistered rule: sentinel absent after every cancelled trial, so SIGINT fails |
| c | Peak memory | **stop condition reached** | See [Memory](#c-memory). Preregistered phases never critical; the added loaded-server phase reached **critical** with sd-server alone |
| d | Same-machine repeatability | **pass** | 2 separate processes: 48 of 48 frames pixel-identical (colour, part-ID, depth). PNG files are **not** byte-identical (0 of 48) |
| e | Forced no-GPU context | **finding: forced, not mappable** | Denying the GPU user clients makes Blender die by SIGSEGV about 0.4 s in, before any script line runs. Not exit 10 |
| f | Depth PNG precision, bytes per slot | informational | Depth written as 8-bit RGBA, which `decodePng` reads. A 16-bit grey depth PNG is refused by `decodePng`. 539,813 B on disk and 33,030,144 B decoded per 16-frame slot |
| g | Binary pin | **pass** | sha256 of the Mach-O below, hashed in 165, 132 and 133 ms; version `5.2.2 LTS`, build `d13f752e3b9c` |
| h | Staging isolation, observed independently | **pass** (within stated limits) | Staged render under a kernel-enforced read deny with a narrow allow list: exit 0, 48 frames, 0 kit or data-file reads outside staging. Planted texture, planted buffer, an unstaged kit root and a planted file under a repo `models/` directory were each caught (see the log-loss limit) |
| i | Seated clip | **fail on the height proxy**; loop closes | `Sitting_Idle_Loop` exists and imports, first-to-last pose displacement 0.0 m. Mean figure height 53.80 px against idle's 59.76 px = **0.900**, above the 0.85 limit |
| j | Cold start to first frame | informational | See [Cold start](#j-cold-start) |
| k | Texture skip is output-neutral | **pass** | Staged (no textures) against unstaged kit root (textures present): 48 of 48 frames pixel-identical. 1 pair |

### Positive controls

| Claim | Control | Outcome |
| --- | --- | --- |
| a: "no terminal" is not a constant | same checks under `script` (pty) | ttys true, `/dev/tty` opens, as expected |
| b: harness sees survivors | shell group that ignores TERM | alive after the 2000 ms grace (2 members), gone 45 ms after SIGKILL |
| c: reader sees real growth | driver holds a 256 MiB block | `footprint` rose 254 MiB; `proc_pid_rusage` agreed (268.7 MiB current, 270.3 MiB lifetime max) |
| c: sampler peak and critical flag | fake-clock unit tests | peak between readings recorded; level 4 flagged and reacted to on the tick |
| d, k: comparison can fail | frame 0 vs 1, colour vs part-ID, one channel byte flipped, frame vs itself | different (6759 px), different (16063 px), different (1 px), identical (0) |
| e: distinct code | same script, no forcing; and a missing `--models` | exit 0; exit 12 |
| f: refusal is about the format | `decodePng` on an 8-bit RGBA PNG from the repo's encoder | accepted |
| g: pin check can fail | a copy of the Mach-O with one byte changed; wrong expected build; wrong expected version | different sha256; exit 11; exit 11 |
| h: observation sees a read | read of a file outside the allow list from inside the sandboxed Blender | denied, path in the kernel log |
| h: planted texture | glTF `images[].uri` pointing outside staging | path in the log as a denied read; the render still exited 0 with 48 frames |
| h: planted buffer | glTF `buffers[].uri` pointing outside staging | path in the log; import failed, exit 12 |
| h: kit root | the unstaged kit root under the same profile | refused: the first kit read was denied, exit 12 |
| h: repo `models/` | dummy file under `tools/probes/retro-render/models/` of this repo, narrow profile; then the same profile plus the old whole-directory allow | denied and logged; then readable ("read ok") |
| i: closure measure can fail | `Walk_Loop`, `Idle_Loop`, and first-to-mid of `Walk_Loop` | 0.0 m (closed), 0.0043 m (non-zero, under 0.02), 0.68 m (over 0.02) |

### a) Launch and environment

`runToCompletion` in `src/blender.ts` launches Blender with `["--background","--factory-startup","--python-exit-code","1","--python",<script>,"--",...]`. The env search starts with `{}` and adds `HOME`, `TMPDIR`, `PATH`, `LANG`, `LC_ALL` one at a time; the first attempt passed, so no env key is needed. Blender sets its own in-process variables (`OCIO`, `MATERIALX_SEARCH_PATH`, …), which are not inherited. Without `TMPDIR` Blender uses `/private/tmp`.

### b) Cancel

| Signal | Trial | Frames at signal | Latency to group gone | Exit | Leftovers |
| --- | --- | --- | --- | --- | --- |
| SIGINT | 1, 2, 3 | 3 of 16 | 2314, 2149, 2220 ms | code 0 | none; render completed, 52 files, sentinel present |
| SIGTERM | 1, 2, 3 | 3 of 16 | 91, 81, 68 ms | signal SIGTERM | none; 8 files, sentinel absent |
| SIGKILL | 1, 2, 3 | 3 of 16 | 78, 68, 78 ms | signal SIGKILL | none; 8 files, sentinel absent |

For SIGINT Blender printed "Sent an internal break event. Press ^C again to kill Blender" and carried on; the latency is the rest of the render. No trial left a process in the group or a process naming the output directory 1000 ms after "gone". No zero-length, unparsable or temp-named file in the six cancelled trials; that is three trials per signal on one machine, not a guarantee of no torn file. A first run of this step computed the "signalled mid-render" flag after the exit and so reported it false; the flag was fixed to be taken at signal time and the step rerun. Latencies and outcomes were the same; the first result is kept in `scratch/`.

### c) Memory

Sampling: `footprint -p` (phys_footprint) and `ps` RSS per tracked pid, `kern.memorystatus_vm_pressure_level`, `vm.swapusage` and `vm_stat` per tick, on an injected clock, median tick spacing 251 ms (25 ticks per Blender render). The kernel's own lifetime peak (`proc_pid_rusage`, flavour 4) is read as a check that does not depend on the tick.

| Phase | What ran | Peak summed footprint (tick) | Pressure level seen |
| --- | --- | --- | --- |
| P1 (preregistered) | Blender alone, slot render | 904 MiB (Blender); script-reported lifetime peak 997.5 MiB, `ru_maxrss` 484.8 MiB | max 2 |
| P2 (preregistered) | sd-server started and ready, **no generation**, idle 20 s | 95 MiB (RSS up to 172 MiB); ready after 1008 ms | max 2 |
| P3 (preregistered) | Blender rendering beside that sd-server | 1116 MiB (Blender 1021, sd-server 96); Blender lifetime peak 1029.9 MiB | max 2 |
| Added: loaded server | sd-server, then one 512×640 generation at the profile's settings | 2401 MiB at the last tick; kernel lifetime peak 2660 MiB, generation still running | **4 (critical)** |

Blender's lifetime peak footprint over eight slot-sized runs was 909–1091 MiB (P1 998, P3 1030, the six single-slot runs 909–1091). The tick-sampled Blender peak (904, 1021) sat 9–94 MiB under the kernel's, so ticks can miss spikes.

**P2 and P3 did not measure a loaded server.** sd-server listens after about a second with 95 MiB resident; its weights load at the first generation. The preregistered P2 said "no generation", so P2 and P3 follow the preregistration but do not answer the question as the owner posed it ("live and loaded but idle").

**Added phase, not preregistered.** A first attempt stopped at 3.5 s into the generation because of an extra guard I had added on low free swap (it fired without any pressure change, because macOS grows swap on demand; the guard was removed and that run's partial data is kept in `scratch/`). In the second attempt the baseline level was 1; level 2 appeared at 2.25 s, and **level 4 at 4.0 s**, with sd-server at 2.4 GiB, swap in use at 12.0 GB at the start and 12.7 GB at the last tick (+0.5 GB in the final 250 ms), and Blender not running. The driver killed sd-server's group (stopped in 209 ms) and the level was back at 1 (55% free) afterwards. This is the stop condition in the task: the loaded-server phases (idle after load, Blender beside it) were **not run** and are not worked around.

Interpretation rule from the preregistration: the one-engine-at-a-time decision counts as supported if P3 exceeds 75% of RAM (12 GiB) or reaches level 2. P3's footprint was 1116 MiB (6.8%), so the footprint leg does not support it. The level-2 leg is met but is **confounded**: level 2 was already present before any probe process started. The loaded run is the stronger evidence, and it says only this: on this machine in this state (about 12 GB of swap already in use), sd-server alone reached critical pressure during its first generation, so a measurement of the two together was not possible here. It does not say how a clean 16 GiB machine behaves.

### d) Repeatability and k) texture skip

Run A (`rep-a`) against run B (`rep-b`), separate processes, same argv bar the output directory: 16 of 16 colour, 16 of 16 part-ID and 16 of 16 depth frames pixel-identical when decoded with `decodePng` as stored (RGB under alpha 0 included). A sandboxed run (`obs-staged`) was also pixel-identical to run A. The PNG bytes differ in every file: Blender writes `tEXt` chunks `Date` and `RenderTime`. Same machine, same GPU, same Blender build; nothing is known about other machines.

`rep-unstaged` (kit root in the main checkout, textures present) against `rep-a` (staged, no textures): 48 of 48 pixel-identical. The importer logs "Missing image file" errors for each absent texture and continues.

### e) Forced no-GPU context

| Attempt | Result |
| --- | --- |
| unforced `gpu` mode | exit 0, Metal |
| missing `--models` (slot mode) | exit 12 |
| `--gpu-backend vulkan`, `--gpu-backend opengl` | "Unrecognized GPU backend … expected one of [metal]"; Blender continues on Metal, exit 0. Cannot force |
| sandbox denying `mach-lookup` for `com.apple.MTL*` and `com.apple.gpu*` | exit 0. Cannot force |
| sandbox denying `iokit-open` for the registry class `AGXAcceleratorG13X` | exit 0. Cannot force |
| sandbox denying all `iokit-open` | **SIGSEGV at about 0.4 s, no script output** (2 runs, same result) |
| sandbox denying the user-client classes `AGXDeviceUserClient`, `AGXSharedUserClient`, `AGXCommandQueue`, `AGXDevice` | **SIGSEGV at about 0.4 s, no script output** (1 run) |

The finding is "forced, but not mappable inside the script": Blender dies before the script's first line, so no exit code can be set. That the crash comes before Python is read from the missing `PROBE start` line in the output; its cause was not otherwise diagnosed. The exit-10 path in the script (a raise while creating the context) was never reached by any forcing method, and no claim is made that it works for a real context failure.

### f) Formats and sizes

| Role | File | `decodePng` |
| --- | --- | --- |
| colour | 8-bit RGBA (colour type 6) | accepted |
| part-ID | 8-bit RGBA | accepted |
| depth | 8-bit RGBA | accepted |
| depth, 16-bit grey (colour type 0, depth 16), same Blender, extra render | | refused: `unsupported-png`, "grayscale PNGs are not supported; re-export the image as an 8-bit RGB or RGBA, non-interlaced PNG without a tRNS chunk" |

Distinct non-empty depth levels over the slot: 88 at 8 bits, 1880 at 16 bits (first frame: 75 and 1468). The depth range is 18–22 m, a nominal 15.7 mm per 8-bit step and 0.06 mm per 16-bit step if the mapping were linear; the pass goes through the Standard view transform, so the real step is not uniform and was not measured.

Bytes per 16-frame slot, 8-bit set: 539,813 B on disk (colour 192,372, part-ID 113,389, depth 234,052) and 33,030,144 B decoded RGBA (3 roles × 16 frames × 688,128 B).

### g) Pin

| | |
| --- | --- |
| File | `/Applications/Blender.app/Contents/MacOS/Blender`, 182,900,560 B, arm64 |
| sha256 | `f5c1f2a0c0bca3389ec772d355242b700975ea84e66cbb3f5257a7bce8e5adeb` |
| Hash time (streaming, Bun) | 165, 132, 133 ms (page cache warm); all three agree |
| `bpy.app.version_string`, build hash, date | `5.2.2 LTS`, `d13f752e3b9c`, 2026-09-15 |
| `codesign --verify --deep --strict` on the bundle | passes, 1090 ms |

A hash of the Mach-O covers that one file. The bundle's Python, Frameworks and Resources are not in it; `codesign --verify --deep --strict` passes on this install, and I did not test what it catches.

### h) Staging isolation

Method. `stage` copies only the nine kit files the Zeus recipe imports (male base glTF and `.bin`, three hair glTFs and `.bin` files, the animation library `.glb`; 8.3 MB), with no texture files, into a tree that mirrors the layout `retro_assets.py` expects. The render runs through `sandbox-exec -f <profile>` whose profile is `(allow default)`, `(deny file-read-data)`, then `(allow file-read-data …)` for: `/` (literal), `/System`, `/usr`, `/bin`, `/sbin`, `/Library`, `/private/etc`, `/dev`, the Blender bundle, the staging directory, the run's output directory, and the scratch `home` and `tmp` directories, plus **literal entries for the 15 script and data files the render actually imports or reads** (taken from the render's own `repo_files_loaded` list) and the names-only listing of their three directories. Whole script directories and every `models/` tree are **not** allowed (a unit test of the generated profile checks that no `models` path appears and that nothing under either kit pack directory is allowed). The observation is the kernel's own `Sandbox: <name>(<pid>) deny(1) file-read-data <path>` records, read afterwards with `log show`; it does not depend on the script. A denied read returns "Operation not permitted" and is logged whether or not the script notices.

Result for the staged render (narrow profile): exit 0, 48 of 48 frames, `probe-done.json` present, 257 denied reads by the child's pid over 17 distinct paths, **none a kit file or any file with a data extension** (`.gltf .glb .bin .png .jpg .jpeg .webp .hdr .exr .blend`), none under the kit pack directories in the main checkout. The seventeen, all non-kit:

| Denied path (home abbreviated) | What it is |
| --- | --- |
| `~/.CFUserTextEncoding` | macOS text-encoding preference in the user's home |
| `~/Library/Application Support/Blender/5.2/extensions/.cache/compat.dat` | Blender's per-user extension cache, read despite `--factory-startup` |
| `<repo>/tools/probes` and `<repo>/tools/probes/studio-render` | directory reads of the script directories' parents |
| `<repo>/tools/probes/blender-sprite/__pycache__/*.pyc` (4) | cached bytecode of allowed scripts; Python falls back to the source |
| `/private/tmp/blender_*` (3) | Blender's own temp directories |
| `/private/var/db/eligibilityd/eligibility.plist`, `/private/var/db/timezone/…/{icutz44l.dat,zoneinfo/UTC,zoneinfo/posixrules}` | OS data |
| `/private/var/folders/…/C/org.blenderfoundation.blender/com.apple.metal/{functions.list,libraries.list}` | Metal shader cache |

Denying them changed nothing in the output (pixel-identical to the unsandboxed run, re-checked with the narrow profile).

Controls (narrow profile, rerun after review). The planted texture and buffer live in `scratch/outside/` and are referenced from a staging copy of `Hair_Beard.gltf` (the copy is edited, never a kit file). **Planted texture:** the render still succeeded (exit 0, 48 frames; Blender tolerates a failed texture read) and the denial log showed the texture's path in 3 of the 4 runs (the first run, and two reruns), and only its parent directory in the fourth; see the limits. **Planted buffer:** its path was logged and the import failed with exit 12. **Unstaged kit root:** refused at its first read, a path under `blender-sprite/models/…/UAL1_Standard.glb`, exit 12. **Sandboxed read of a file outside the allow list:** denied and logged. **Kit-like file under a `models/` directory inside this repo** (what a normal checkout, where the main checkout is the repo, looks like): a dummy file at `tools/probes/retro-render/models/planted-control.bin` (created for the run and removed after) was denied and logged under the narrow profile, and was readable when the same profile was given back the old whole-directory allow of `tools/probes/retro-render`.

Limits of this observation:

- Only **denied** reads are logged. Reads inside the allow list (staging, the Blender bundle, the system roots, the script directories, scratch `home` and `tmp`) are allowed and not observed, so the claim covers reads outside those roots.
- `file-read-metadata` (stat, existence probes) is not denied or observed.
- Writes and network are not covered.
- `fs_usage`, `opensnoop` and `dtruss` need root; `sudo` here needs a password (`sudo -n true` fails), so they were not available. `sandbox-exec` is deprecated and this is one OS version. `(trace …)` in a profile produced no output on this OS.
- Kernel log retrieval after the fact can lose messages: in one of the four planted-texture runs the texture's own path was missing from the log while its parent directory was present. A missing line is therefore not proof of no read; the claims above rest on the lines that were seen, and a clean log is read together with the narrow allow list, not instead of it.

### i) Seated clip

`UAL1_Standard.glb` carries 43 actions including `Sitting_Idle_Loop` (frames 0–40), `Sitting_Enter` (0–31.2), `Sitting_Exit`, `Sitting_Talking_Loop` (0–70.4). First-to-last bone-head displacement: `Sitting_Idle_Loop` 0.0 m and `Sitting_Talking_Loop` 0.0 m (closed loops), `Sitting_Enter` and `Sitting_Exit` 0.470 m (not loops, as expected). `Sitting_Idle_Loop` is nearly still: its largest first-to-mid displacement is 0.0144 m (head). Rendered figure height from the script's own mesh extents, south-facing, 4× path: idle 59.76 px mean (6 frames), seated 53.80 px mean (8 frames), a ratio of **0.900**; the preregistered limit is at most 0.85, so this fails the proxy. Whether the pose is acceptable for Zeus is the owner's visual call and is not decided here. In the one frame I looked at, the figure stands in a knees-apart crouch with hands on knees and no seat; no image is committed.

### j) Cold start

No run was a true cold boot; the very first Blender launch of the session (the env step, an 8×8 render) took 5098 ms wall to exit.

| Run (slot render) | Spawn → first script line | Scene build | Spawn → first colour frame on disk | Spawn → last frame | Wall total |
| --- | --- | --- | --- | --- | --- |
| `rep-a` (first slot run) | 1332 ms | 471 ms | 3343 ms | 5524 ms | 5732 ms |
| `rep-b` | 1307 ms | 468 ms | 3356 ms | 5771 ms | 6043 ms |
| `rep-unstaged` | 692 ms | 396 ms | 2638 ms | 4847 ms | 5132 ms |
| `rep-d16` (extra 16-bit render per depth frame) | 742 ms | 370 ms | 2608 ms | 5552 ms | 5834 ms |

Per render after the first, about 49–55 ms mean (first render 141–228 ms); the walk16 slot's 48 renders take about 2.4–2.6 s. Startup overhead (spawn to first script line plus scene build) is about 1.1–1.8 s of a 5–6 s slot.

## Deviations from the preregistration

- **c:** P2 and P3 ran as written but did not load the server's weights; a loaded-server phase was added after seeing that, and it stopped at critical pressure. The P3 interpretation rule's level-2 leg is confounded by the host's baseline.
- **e:** the iokit-based attempts are method (4), "anything else found and recorded"; all attempts are listed above.
- **b:** one harness bug fixed and the step rerun (see b).
- **Integrity:** the formatter incident above.

## Limits

One machine (M1 Pro, 16 GiB), one macOS version, one Blender build, one session. Memory pressure on this host was already at level 1–2 with about 11–12 GB of swap in use before any probe load, so every memory number is "on this machine in this state". Repeatability is two processes. Cancel is three trials per signal. Cross-machine identity, other GPUs, Linux and Windows are not measured. The sandbox observation is of denied reads only. Nothing here exercises the studio sidecar, the queue or abort-by-restart; this probe launched Blender from a Bun driver in the shape of `launch`, not from the sidecar.

## Implications for U7

- **Deadlines.** Blender stopped within 91 ms of SIGTERM and 78 ms of SIGKILL in 3 trials each, far inside `termGraceMs` 2000 ms plus `killMs` 10000 ms. On this evidence it needs no quit deadline of its own beyond the shared bound; `stopGroup` can be reused for it. A per-slot deadline and the no-new-frame watchdog are separate and are not measured here (a slot takes 5–6 s).
- **Signal.** Send SIGTERM, then SIGKILL after the grace, to the group, as `stopGroup` does. Do not send SIGINT: the first one is swallowed ("internal break event") and the render ran to completion with exit 0 in 3 of 3 trials. A terminated Blender exits by signal, not by code, so the runner should read a signal exit after its own abort as aborted, not as failed. The slot sentinel was absent after every TERM and KILL cancel.
- **Memory rule.** Blender alone is small (lifetime peak footprint 0.9–1.1 GiB over eight runs). sd-server alone reached critical pressure on its first generation on this machine, so one engine at a time remains the only rule this probe supports; the combination of a loaded sd-server and Blender was not measured. If U7 wants a runtime guard, the pressure level is cheap to sample (`kern.memorystatus_vm_pressure_level`, tick by tick on an injected clock, as `src/sampler.ts` does) and level 4 is the signal the host reported. Prefer the kernel lifetime peak (`proc_pid_rusage`) over tick sampling for reported peaks.
- **Staging observation.** A kernel-enforced read deny with an allow list plus the Sandbox denial log (`sandbox-exec`, `log show`, no root) is the independent method available; use it in U7's integration test, not in the runtime path (deprecated tool, one OS). Blender tolerates a failed texture read (exit 0, full frame set), so the render's exit status is **not** a closure signal: the static closure check before launch has to be the gate. A bad buffer does fail the import, which the script can map to its input-error code.
- **Frame identity.** Compare decoded pixels. The same render in two processes is pixel-identical but never byte-identical (`Date` and `RenderTime` text chunks), so a per-file sha256 in `done.json` cannot be an identity across re-renders; hash decoded pixels (or strip the text chunks) for anything compared later.
- **Depth.** `decodePng` reads 8-bit RGB and RGBA only and refuses a 16-bit grey depth PNG. 8-bit depth decodes today (88 distinct levels over a walk slot); 16-bit would need decoder work first.
- **No GPU context.** A forced loss of the GPU kills Blender with SIGSEGV before any script runs, so exit 10 is not reachable by forcing; the runner should treat "died by signal before the first script line" as its own case alongside the exit-code table.
- **Startup.** Spawn to first script line is 0.7–1.3 s and scene build about 0.4 s of a 5–6 s slot, so one process per run of render jobs is reasonable and a warm worker would save about 1 s per slot at most.
- **Pin check.** Hashing the Mach-O takes about 0.15 s; the script's version and build assertion exits 11 on a mismatch (tested with a wrong build and a wrong version). A Mach-O hash alone does not cover the bundle.
- **Seated.** A closed seated loop exists but misses the 15% height proxy; U6/U10 decide whether it is usable or seated is a keyed static pose.

## Corrections after review

2026-10-12. Three defects in the probe's own tooling were fixed, each test-first (the new tests failed before the change), and the affected runs repeated. `criteria.json` is unchanged.

- **Frame-set comparison.** `compareRuns` compared only the filenames both runs shared and checked list lengths, so two equal-length sets that only partly overlapped passed. It now requires the full filename set of each role to be equal and reports unmatched files before comparing any pixels. The comparisons for (d) repeatability (`rep-a` against `rep-b`) and (k) texture skip (`rep-a` against `rep-unstaged`) were rerun on the existing renders: for each of colour, part-ID and depth, 16 files matched, none were unmatched on either side, 16 of 16 were pixel-identical. Both verdicts stand. The narrow-profile sandboxed render (`obs-staged`) against `rep-a` was also 16 of 16 per role.
- **Sampler yield.** `sampleLoop` skipped its wait whenever a tick took at least the interval, so a loop that had fallen behind never yielded to the event loop and a child's `close` event could not be handled. It now always awaits (a wait of zero at minimum). The memory runs in (c) were not rerun. The recorded tick spacing shows where the defect could have bitten: gaps between ticks were 249–256 ms in P1 (25 ticks), P2 (80) and the loaded-server generation (17), but in P3 (two processes sampled per tick, 25 ticks) 12 of 24 gaps exceeded 256 ms, up to 302 ms, so several of its ticks overran the 250 ms interval and skipped their yield. P3 still ended when Blender closed, and the critical-pressure stop was read from the pressure level on the tick itself. This is read from the recorded spacing, not re-measured.
- **Sandbox allow list.** The profile allowed the whole `tools/probes/retro-render` and `tools/probes/blender-sprite` directories, `models/` trees included, so in a checkout where the main checkout is the repo, unstaged kit reads would not have been denied or logged. It now allows only the script and data files the render imports (found from the render's `repo_files_loaded`), plus staging, the output directory, the Blender bundle and the system roots; a unit test checks that no `models` path is in the generated profile and that nothing under either kit pack directory is allowed. Criterion (h) was rerun in full: the staged slot, the planted texture (three times), the planted buffer, the unstaged kit root, the sandboxed read, and a new control for a planted file under a `models/` directory in this repo. The results are in (h) above and the verdict stands. One observation changed the limits: in one planted-texture run the kernel log lacked the texture's own path.

## Final check

Re-hashed after the last edit to this directory: `criteria.json` sha256 `fb7dc62fcaa95d2c6951359985b17121b75f16dc556fa0f21fd9001f4376a5a5`, 15704 bytes, equal to the preregistered hash.
