---
title: Incomplete PNGs pass hash and header checks
date: 2026-10-04
category: integration-issues
module: assets
problem_type: integration_issue
component: tooling
severity: medium
symptoms:
  - "A hash-consistent 29-byte PNG enters the canon registry"
  - "Loading and content validation accept a blob with no image data"
root_cause: missing_validation
resolution_type: code_fix
tags: [png, sha256, crc, idat, adam7, asset-registry, fallback]
---

# Incomplete PNGs pass hash and header checks

## Problem

The registry accepted a 29-byte PNG header as an approved image. This broke the U07 fallback and U08 content-validation foundation.

## Symptoms

A sprite atlas was truncated to 29 bytes. Its manifest and blob map used the hash of those truncated bytes.

Publication succeeded, loading reported no problem, resolution returned `canon`, and the content validator returned `ok: true`. The file contained neither a complete header chunk nor image data.

## What Didn't Work

Hash and dimension checks accepted the file. A matching hash establishes byte identity, not a valid image. Tampering tests with an unchanged declared hash failed too early to expose this defect.

## Solution

Use the shared `checkBlob` boundary for publication, selection, loading, and content validation:

1. Compare the bytes with the declared SHA-256 hash.
2. Parse every PNG chunk and its CRC checksum.
3. Require legal header fields, palette placement, consecutive image-data chunks, and a final end chunk.
4. Compare the dimensions with the declared atlas.
5. Inflate the image data with an output limit equal to the expected scanline size.
6. Require the exact output size and row filter values from 0 through 4.

The expected size includes Adam7, the PNG interlacing layout. The host registry uses `node:zlib`; the PNG parser remains free of platform imports.

```ts
const expected = inflatedLength(png);
const raw = inflateSync(Buffer.concat(png.idat), {
  maxOutputLength: expected,
});
```

The registry returns `corrupt-blob` on failure. These checks do not decode pixels, inspect palette indices, or certify art quality.

## Why This Works

The shared boundary rejects malformed bytes before publication writes files or changes the selected revision. Loading excludes a corrupt entry but retains healthy entries, so resolution uses the placeholder for the bad entry.

## Prevention

Test malformed blobs whose declared hashes match their bytes. Assert that failed publication preserves the selected index and that loading retains healthy entries.

The regressions cover the truncated header, short image data, oversized inflated data, and an invalid row filter. Valid RGB, indexed, 16-bit grayscale, and interlaced images still pass. All seven golden vectors (six placeholders and one encoder vector) remain unchanged.

## Related Issues

- [Registry implementation](../../../packages/assets/src/registry.ts)
- [Registry regressions](../../../packages/assets/src/registry.test.ts)
- [Content-validator regression](../../../tools/content/src/assets.test.ts)
- [Asset registry and lifecycle decision](../../decisions/0009-asset-registry-lifecycle-and-uris.md)
- [Asset foundation and fix, PR #120](https://github.com/marcusrbrown/panthea/pull/120)
