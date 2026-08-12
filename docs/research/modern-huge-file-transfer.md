# Survey: modern huge-file transfer techniques

Research for [issue #2](https://github.com/gaturtle/huge-file-transfer-lab/issues/2), "Survey modern huge-file transfer techniques". Feeds the protocol-design ticket that follows this one. Per [ADR 0001](../adr/0001-hand-rolled-upload-protocol.md) we are hand-rolling our own Upload Session / Manifest / chunk / resume protocol rather than adopting tus.io or S3-multipart wholesale — this survey is about which *ideas* from prior art are worth stealing, not about becoming spec-compliant with any of them.

Constraints this survey is filtered through (from `CONTEXT.md`): files up to ~5 GB, single user, Spring Boot + React/shadcn, server is **1 vCPU / 1 GB RAM / 25 GB disk**.

---

## 1. tus.io resumable upload protocol

Source: [tus Resumable Upload Protocol 1.0.x, official spec](https://tus.io/protocols/resumable-upload) (protocol home page, canonical spec text).

- **Core flow**: `POST` creates an upload resource (Creation extension); `HEAD` lets the client ask "what offset are you at?"; `PATCH` sends the next chunk of bytes starting at that offset. (tus.io spec, "Core Protocol" / Creation extension sections)
- **Required headers on (almost) every request**:
  - `Tus-Resumable` — protocol version string, e.g. `1.0.0`. Server returns `412 Precondition Failed` if it doesn't support the requested version. (tus.io spec, Core Protocol)
  - `Upload-Offset` — the byte offset, both client-supplied (on `PATCH`) and server-returned (on `HEAD`).
  - `Upload-Length` — total upload size in bytes, set at creation. (Creation extension)
  - `Upload-Defer-Length: 1` — lets the client create an upload before it knows the final size, deferring `Upload-Length` to a later request. (Creation-With-Upload extension)
  - `Upload-Metadata` — comma-separated `key base64(value)` pairs, carrying arbitrary metadata (e.g. filename) at creation time. (Creation extension)
- **PATCH body contract**: every `PATCH` **must** use `Content-Type: application/offset+octet-stream`; a server that gets anything else must respond `415 Unsupported Media Type`. (tus.io spec, Core Protocol, PATCH section)
- **Status codes used by the spec**: `201 Created` (upload resource created), `204 No Content` (successful `PATCH`/`DELETE`), `409 Conflict` (client's `Upload-Offset` doesn't match the server's recorded offset — the resume-safety mechanism), `412 Precondition Failed` (unsupported `Tus-Resumable` version), and the tus-specific `460 Checksum Mismatch`. (tus.io spec, Core Protocol + Checksum extension)
- **Checksum extension** (optional, advertised via `Tus-Extension: checksum`):
  - `Upload-Checksum: <algorithm> <base64(hash)>` sent by the client on a `PATCH`, checked by the server against the bytes just received.
  - `Tus-Checksum-Algorithm` — server-advertised comma-separated list of algorithms it supports.
  - The spec requires the **server MUST support at least `sha1`**; `md5` and `crc32` are named as other common options. (tus.io spec, Checksum extension)

Takeaway: tus's real contribution isn't the checksum algorithm choice, it's the **offset-based resume contract** — a `HEAD` to ask "where were we", a strict `409` when client and server disagree about offset, and metadata-at-creation-time — all expressed as plain HTTP headers rather than a bespoke JSON envelope.

## 2. S3 multipart upload semantics

Sources: [Amazon S3 multipart upload limits (qfacts.html)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/qfacts.html) and [Uploading and copying objects using multipart upload in Amazon S3 (mpuoverview.html)](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html) — both official AWS User Guide pages.

Numeric limits (qfacts.html, "core specifications" table):

| Item | Value |
|---|---|
| Maximum object size | 48.8 TiB |
| Maximum number of parts per upload | 10,000 |
| Part numbers | 1–10,000 inclusive, need not be consecutive (order is by part number, not upload order) |
| Part size | 5 MiB – 5 GiB; **no minimum on the last part** |
| Max parts returned per `ListParts` call | 1,000 |

Flow (mpuoverview.html, "Multipart upload process"): three-step — `CreateMultipartUpload` (returns an Upload ID) → repeated `UploadPart` (each call takes the Upload ID + a part number, returns an `ETag` for that part) → `CompleteMultipartUpload` (client must submit the full list of part-number/ETag pairs it collected; **not** obtained by re-listing from the server — the docs explicitly warn "Do not use the result of [ListParts] when sending a complete multipart upload request. Instead, maintain your own list.").

ETag behavior: each individually-uploaded part gets its own `ETag` at upload time. After `CompleteMultipartUpload`, "all parts belong to one ETag as a checksum of checksums" — i.e. **the final object's ETag is not an MD5 of the file's bytes**, it's derived from the part ETags, which is a well-known gotcha for anyone trying to use S3 ETags as a plain content hash. (mpuoverview.html, "Parts upload" section)

Sizing guidance: AWS recommends switching to multipart upload once an object reaches **100 MB**, specifically citing "quick recovery from network issues — smaller part size minimizes the impact of restarting a failed upload" and the ability to "upload parts in parallel to improve throughput." (mpuoverview.html, "Using multipart upload provides the following advantages")

Integrity: newer SDKs default to full-object `CRC64NVME`; when using the legacy "composite" checksum mode, each `UploadPart` call can carry a per-part checksum header (`x-amz-checksum-{crc32,crc32c,sha1,sha256,...}`), and `CompleteMultipartUpload` must echo all of them back. A per-object checksum mismatch fails with `BadDigest`. (mpuoverview.html, "Checksums with multipart upload operations")

Takeaway: S3's numbers (5 MiB–5 GiB parts, up to 10,000 of them) are sized for objects vastly larger than our 5 GB ceiling and are irrelevant as *limits* for us, but the **shape** — stable IDs (Upload ID + part number) as the resume key, complete-with-a-manifest-not-a-re-list pattern, and "per-part checksum plus optional whole-object checksum" — maps directly onto our own Upload Id / Manifest / chunk vocabulary.

## 3. HTTP Range requests (RFC 9110 + MDN)

Sources: [RFC 9110 §14, Range Requests](https://www.rfc-editor.org/rfc/rfc9110.html#name-range-requests) (current HTTP semantics RFC, obsoletes the older RFC 7233) and [MDN: HTTP Range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests).

- **`Range` request header** — byte-range spec, e.g. `Range: bytes=0-1023` (first 1024 bytes), `Range: bytes=1024-` (from byte 1024 to EOF), `Range: bytes=-500` (last 500 bytes), and multiple comma-separated ranges in one request. (MDN, "Range header syntax"; consistent with RFC 9110 §14.1's `range-spec` grammar)
- **`Accept-Ranges: bytes`** — server advertises range support; `Accept-Ranges: none` or an absent header means the client shouldn't try. (MDN, "Accept-Ranges")
- **`206 Partial Content`** — success status for a satisfied range request; response carries `Content-Range: bytes <start>-<end>/<total>` and a `Content-Length` equal to the range size, not the full resource size. Multi-range requests get a `multipart/byteranges` body. (RFC 9110 §14.2 semantics for `206`; MDN examples)
- **`416 Range Not Satisfiable`** — returned when the requested range doesn't overlap the resource's actual length. (RFC 9110 §15.5.17; MDN)
- **`If-Range`** — makes the range conditional on a validator (an `ETag` **or** a `Last-Modified` date, never both at once). If the validator still matches, the server sends `206` with just the requested range; if it doesn't, the server sends the full `200 OK` body instead of a stale/mismatched partial. (RFC 9110 §13.1.5; MDN, "If-Range")

Takeaway: `If-Range` is the piece worth internalizing even though we're hand-rolling — it is the standard's answer to "how do you know the file you're resuming a download of hasn't changed underneath you since your last partial fetch," which is exactly the resume-safety problem tus solves on the upload side with `Upload-Offset` + `409`. Our download-resume path should key off something equivalent (our file/session identity, not wall-clock offset alone) for the same reason.

## 4. Parallel / multi-connection transfer strategies

- **HTTP/1.1 per-origin connection cap**: all major browsers cap **concurrent connections per origin at roughly 6** (historically ranging 4–8 depending on browser) for HTTP/1.1. Practical consequence: naively firing off many parallel chunk uploads/range downloads over HTTP/1.1 to the same origin queues after ~6 in flight regardless of how many you "start." ([Browser behaviour in HTTP/1.1 vs HTTP/2 discussion, summarizing standard browser connection-pool behavior](https://mishal.dev/browser-http-behaviour/); cross-checked against the well-documented ~6-per-host browser limit)
- **HTTP/2 multiplexing**: a single TCP connection per origin can carry many concurrent logical streams. RFC 7540 §6.5.2 defines `SETTINGS_MAX_CONCURRENT_STREAMS` and explicitly recommends: **"It is recommended that this value be no smaller than 100, so as to not unnecessarily limit parallelism."** ([RFC 7540, HTTP/2, §6.5.2](https://httpwg.org/specs/rfc7540.html)) — so on HTTP/2 the effective ceiling on simultaneous chunk requests is normally the server's/browser's stream budget (≥100), not a hard connection count, though a single congested TCP connection can still be a throughput bottleneck (head-of-line blocking at the TCP layer — see §6 on HTTP/3).
- **Diminishing returns**: parallelism helps mostly to fill available bandwidth-delay product and to mask per-request round-trip latency; past the point where aggregate in-flight bytes saturate the link (or the server's own CPU/IO), more concurrent chunks add scheduling/memory overhead without more throughput. On a 1 vCPU box, the *server's* ability to concurrently hash-verify, write, and respond to N simultaneous chunk PUTs is the real ceiling, not the browser's connection limit.

Takeaway: the browser-side limit (~6 on HTTP/1.1) is a soft ceiling we'd hit before RFC 7540's ≥100-stream HTTP/2 budget becomes relevant — meaning modest client-side parallelism (a handful of concurrent chunk requests) is the realistic target regardless of which HTTP version we run, and the server's single vCPU is the tighter constraint besides.

## 5. Checksum / integrity strategies

- **SHA-256** (cryptographic, collision-resistant) is what most resumable-upload systems default to for end-to-end integrity (tus's checksum extension supports it as one option; S3's composite-checksum mode lists `SHA256` alongside `CRC32`, `CRC32C`, `SHA1`, `MD5`, and `XXHASH64/3/128`, per the [S3 multipart checksum table](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html)) — but it is comparatively CPU-expensive because it's designed to be, deliberately resisting cheap computation.
- **xxHash** — a non-cryptographic hash "processing at RAM speed limits," explicitly designed for speed and portability rather than collision-resistance against adversaries; ships XXH32, XXH64, and the SIMD-vectorized XXH3/XXH128 variants. Its own docs are explicit that it intentionally avoids relying on brand-specific CPU features (unlike hardware CRC32C) "with intended goal of maximum portability... beyond Intel's realm." ([xxHash README, Cyan4973/xxHash — the reference/official repo](https://github.com/Cyan4973/xxHash/blob/dev/README.md))
- **CRC32C** — when hardware-accelerated via the SSE4.2 `crc32` instruction (available since Intel Nehalem, i.e. essentially all relevant modern x86 CPUs including cloud VM vCPUs), throughput can reach on the order of **20.5 GB/s theoretical** on a 3 GHz core (1.17 cycles per 8 bytes) — an order of magnitude past what a general-purpose cryptographic hash achieves per core. (Cited via the xxHash project's own comparison discussion, [Cyan4973/xxHash issue #62, "Update speed comparisons with crc32"](https://github.com/Cyan4973/xxHash/issues/62), and corroborated by SSE4.2 hardware-CRC32C reference implementations such as [eloj/crc32c](https://github.com/eloj/crc32c))
- S3 itself now defaults new SDK uploads to **CRC64NVME** when no checksum is specified by the caller, explicitly "the recommended option for efficient data integrity verification" per AWS's own current guidance — i.e. even S3 has moved *away* from SHA-family hashes as the default for its own multipart integrity checks, favoring a fast CRC variant. (mpuoverview.html, "Checksums with multipart upload operations")

Cost tradeoff for a 1-vCPU box: SHA-256 is safe against malicious tampering (cryptographic) but burns CPU that this project doesn't have to spare if it's hashing every chunk of a multi-GB file on the same core that's also running Spring Boot's HTTP handling and disk I/O. CRC32C/xxHash are for **accidental corruption detection** (bit flips, truncated transfers, disk errors) — which is the actual threat model for a single-user learning lab with no untrusted uploader — not for defeating a deliberate attacker.

## 6. What's genuinely better than naive fixed-chunking

| Technique | What it buys | Primary source | Relevant to this project? |
|---|---|---|---|
| **Compression-in-flight** (e.g. HTTP `Content-Encoding: gzip`/`br`, or an app-level compress-before-chunk step) | Less bytes over the wire for compressible content | N/A (standard HTTP content-coding, not a "spec" per se) | **Mostly not.** Huge files in a transfer lab are the case content is *already* incompressible (video, archives, disk images) most of the time, and compression is another CPU-bound step competing for the single vCPU. Only worth it if the test corpus is genuinely compressible (e.g. text/log dumps) — not worth building generically. |
| **Delta / resumable-diff transfer (rsync algorithm)** | Re-send only the bytes that changed between two versions of a similar file, via a rolling weak checksum (adler-32-inspired) + strong checksum per block | [Tridgell & Mackerras, "The rsync algorithm," ANU Dept. of CS Technical Report, 1998-11-09](https://rsync.samba.org/tech_report/) — the original paper | **Overkill.** rsync's algorithm earns its complexity when you're re-syncing *similar* files across a slow link (e.g. re-uploading an edited version of the same huge file). This lab is about first-time chunked upload/download of arbitrary files, not incremental re-sync of near-duplicate files — the rolling-checksum machinery would be pure overhead for the stated goal. Worth knowing about, not worth implementing here. |
| **WebRTC data channels** | Peer-to-peer transfer without routing bytes through a server, via SCTP over DTLS | [RFC 8831, "WebRTC Data Channels," IETF, Jan 2021](https://www.rfc-editor.org/rfc/rfc8831.html) (abstract: specifies SCTP-based non-media data transport for the WebRTC framework) | **Not applicable.** This is a single-user, client-to-server transfer to one backend; there's no second peer to connect to and no NAT-traversal problem to solve. Pure overkill — pulls in ICE/STUN/SCTP machinery for zero benefit here. |
| **BitTorrent-style swarm transfer** | Many peers upload/download pieces to/from each other in parallel, so one slow origin server isn't the bottleneck | [BitTorrent BEP 0003, the original protocol spec, bittorrent.org](https://www.bittorrent.org/beps/bep_0003.html) — pieces (typically 32–256 KB) split into blocks (~16 KB) so multiple in-flight requests can pipeline | **Not applicable.** There's exactly one server and one user; there's no swarm to form. The one idea worth borrowing conceptually — piece/block pipelining, i.e. keep several chunk requests in flight rather than one-at-a-time — is already captured under §4's parallelism discussion without needing anything BitTorrent-specific. |
| **HTTP/3 / QUIC** | Eliminates TCP head-of-line blocking (a lost packet only stalls the one QUIC stream it belonged to, not all multiplexed streams sharing a TCP connection), faster connection establishment, connection migration across network changes | [RFC 9114, "HTTP/3," IETF, June 2022](https://www.rfc-editor.org/rfc/rfc9114.html) and [RFC 9000, "QUIC: A UDP-Based Multiplexed and Secure Transport," IETF, May 2021](https://www.rfc-editor.org/rfc/rfc9000.html) | **Not worth it here.** The benefits are real (per-stream loss isolation, migration for mobile clients moving between networks) but require QUIC/UDP support in front of Spring Boot (typically via a reverse proxy like a QUIC-capable load balancer), adding infra complexity disproportionate to a single-user learning box with no mobile/lossy-network requirement in scope. Plain HTTP/1.1 or HTTP/2 over TCP is simpler to reason about and sufficient at this scale. |

---

## Recommendations for this project

These are concrete starting points for the protocol-design ticket, not just a menu.

1. **Chunk size: 8 MiB, fixed, except a shorter final chunk.**
   Reasoning: S3's own floor is 5 MiB and its docs pitch multipart as worthwhile past 100 MB total size (mpuoverview.html) — our files (up to ~5 GB) are squarely in "should be chunked" territory but nowhere near S3's 5 GiB *max* part size, so we don't need to think about their upper bound at all. 8 MiB keeps a ~5 GB file to roughly 640 chunks (a sane number of Upload Session rows / retry units) while keeping any single chunk's memory footprint (read buffer + checksum buffer) comfortably inside the 1 GB RAM budget even with a couple of chunks in flight concurrently. Avoid going much smaller (thousands of chunks means thousands of small writes/HTTP round trips, each with fixed overhead) or much larger (a failed multi-hundred-MB chunk near the end of a slow link wastes more retransmitted work, and holding it in memory pressures the 1 GB ceiling).

2. **Checksum algorithm: CRC32C per chunk, SHA-256 only for the final whole-file check.**
   Reasoning from §5: this is a single-user lab with no untrusted uploader, so the threat model is accidental corruption (truncated request, flaky disk, flipped bit), not a malicious actor deliberately forging chunks — which is exactly the case CRC32C is built for and SHA-256 is overkill for. SSE4.2 hardware CRC32C is effectively free (theoretical ~20 GB/s/core) and won't compete meaningfully with Spring Boot's own request handling on the single vCPU. Reserve one SHA-256 pass for the fully-assembled file as a final end-to-end sanity check (cheap in aggregate — it's one pass over the file, done once, not once per chunk) — this mirrors S3's own shift to defaulting new uploads to CRC64NVME instead of SHA-family hashes (mpuoverview.html) and keeps a strong-hash guarantee where it's cheapest to afford it.

3. **Parallelism: 3–4 concurrent chunk requests from the client, no more.**
   Reasoning from §4: browsers cap HTTP/1.1 connections at ~6 per origin, so anything approaching that ceiling risks starving the browser's other same-origin traffic (e.g. the React app's own asset/API requests) for no throughput gain — and RFC 7540's ≥100-stream HTTP/2 budget is irrelevant here because the *server's* single vCPU (running the same core that verifies checksums, writes chunks to disk, and handles the Spring Boot request thread pool) will bottleneck well before the browser's connection limit does. 3–4 concurrent chunk uploads is enough to hide round-trip latency without meaningfully oversubscribing a 1-vCPU server; measure and adjust once the real implementation exists rather than guessing higher.

4. **Borrow tus.io's header conventions where they cost nothing, even though we're hand-rolling.**
   Specifically worth stealing as *vocabulary*, not as a compliance target:
   - An `Upload-Offset`-style response from a "where am I" check (our Manifest/Upload Session already models this; expose it as a header on a status endpoint the same way tus does via `HEAD`, rather than inventing a differently-shaped JSON field).
   - A strict `409 Conflict` when the client's believed offset doesn't match the server's recorded offset — this is the cheapest possible defense against a client resuming from a stale/wrong position, and tus proves the header-only version of this is enough; no need for a bespoke error body format.
   - `Content-Type: application/offset+octet-stream` (or our own equivalent) on chunk-upload requests, so chunk bodies are unambiguously raw bytes at a known offset, not accidentally interpreted as `multipart/form-data` or JSON.
   Do **not** adopt tus's `Upload-Defer-Length` (we always know total size up front — this app doesn't need to support streaming-uploads-of-unknown-length) or the full extension-negotiation machinery (`Tus-Extension`, `Tus-Version`) — that's protocol-compliance overhead with no payoff for a single, fixed client/server pair we control both ends of.

5. **Everything in §6's table is out of scope for this project**, with one caveat: keep the *idea* of "several chunk requests pipelined at once" (the one generically useful lesson from BitTorrent's piece/block model) — that's already covered by recommendation 3 above and needs no swarm/peer machinery to realize.

6. **Download side: use real HTTP Range requests, not a bespoke download-chunking scheme.**
   Since the browser (and `curl`, and everything else) already speaks `Range`/`Accept-Ranges`/`206`/`416` natively (RFC 9110 §14; MDN), and Spring's `ResourceHttpRequestHandler` / manual `Range` handling can serve them directly from disk, there's no reason to hand-roll a parallel "download manifest" concept — reuse HTTP's own resumable-download primitive there, and use `If-Range` (keyed on the assembled file's ETag or Last-Modified) as the resume-safety check so a resumed download can't silently splice bytes from two different versions of the file.
