# Huge File Transfer Lab — Resources

## Knowledge

### Internal (this repo — primary source for "what we actually did")
- [CONTEXT.md](../CONTEXT.md)
  The domain glossary: Chunk, Upload Session, Upload Id, Manifest, Checksum, Resume, Assembly, Range Request. Use for: exact terminology, first stop before any lesson.
- [ADR 0001 — hand-rolled upload protocol](../docs/adr/0001-hand-rolled-upload-protocol.md)
  Why we didn't adopt tus.io or S3 multipart. Use for: the "why not just use X" conversation.
- [ADR 0002 — split checksum algorithm](../docs/adr/0002-split-checksum-algorithm.md)
  Why CRC32C per-chunk + SHA-256 whole-file, tied to CPU cost and threat model. Use for: checksum-strategy lessons.
- [docs/research/modern-huge-file-transfer.md](../docs/research/modern-huge-file-transfer.md)
  The original survey of modern huge-file transfer techniques (chunk sizing, checksum algorithm speed data, tus.io's offset/409 pattern). Use for: grounding numeric claims (e.g. CRC32C throughput).
- [docs/deploy/deployment-guide.md](../docs/deploy/deployment-guide.md)
  The actual deployment runbook: 2-container shape, nginx TLS termination, GitHub Actions build/push, ufw rules. Use for: deployment lessons.
- Wayfinder map: [Huge File Transfer Learning Lab (issue #1)](https://github.com/gaturtle/huge-file-transfer-lab/issues/1)
  Index of every design decision made, each linking to the ticket with full reasoning. Use for: "why did we decide X over Y" — the discussion is preserved here.
- [backend/](../backend), [frontend/](../frontend), [scripts/loadtest/](../scripts/loadtest), [scripts/e2e/](../scripts/e2e)
  The real, running code and the harnesses that proved it under load. Use for: "show me the actual implementation" moments in a lesson.

### External (primary/high-trust)
- [tus.io — Resumable upload protocol 1.0.x](https://tus.io/protocols/resumable-upload/1-0-x)
  The reference resumable-upload protocol this project deliberately didn't adopt, but borrowed the offset/409 pattern from. Use for: comparing our hand-rolled protocol against an established standard.
- [tus resumable-uploads IETF draft](https://www.ietf.org/archive/id/draft-tus-httpbis-resumable-uploads-protocol-00.html)
  The standardization effort turning tus into an IETF spec. Use for: how the wider industry is converging on this problem.
- [MDN — HTTP range requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Range_requests)
  Canonical explanation of `Range`, `Accept-Ranges`, `Content-Range`, 206/416 status codes. Use for: the download-side lesson — this is the mechanism our Range Request downloads are built on.
- [MDN — Range header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Range) / [Content-Range header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Range)
  Header-level detail for `If-Range` / ETag-based conditional ranges, which is exactly what issue #5 designed.
- [Spring Framework — Range Requests (Reference docs)](https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-range.html) / [ResourceRegion Javadoc](https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/core/io/support/ResourceRegion.html)
  The exact Spring abstraction (`ResourceRegion`, `HttpRange`) the backend uses to serve partial content. Use for: Spring-specific download lesson.
- [MDN — File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) / [FileSystemWritableFileStream](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemWritableFileStream)
  The browser API behind positional, resumable writes to disk during download — and why it's Chromium/Edge-only. Use for: frontend download-lesson.

## Gaps
- No curated resource yet on CRC32C internals (hardware acceleration, SSE4.2 `CRC32` instruction) beyond the numbers already captured in `docs/research/modern-huge-file-transfer.md`. Revisit if a lesson needs to go deeper than "it's fast and hardware-accelerated."
- No community identified yet (see below).

## Wisdom (Communities)
- Not yet sourced. Candidates to evaluate later: r/webdev, r/programming for general reaction; the [tus.io GitHub discussions](https://github.com/tus/tus-resumable-upload-protocol/discussions) if the user wants feedback from people who work on resumable-upload standards specifically.
- No community preference recorded from the user yet — ask before pushing one.
