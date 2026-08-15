# Mission: The Huge File Transfer Lab's architecture

## Why
You built (with agent help) a hand-rolled chunked, resumable file transfer system on a resource-constrained server. You want to internalize the *pattern* — not just have working code — so you can recognize when a future project needs it and design/implement it yourself, in a different stack if needed.

## Success looks like
- Can explain, from memory, why chunking + per-chunk checksums + a resumable session model beats "just upload the whole file" for large transfers on weak hardware.
- Can sketch the state machine of an Upload Session (states, transitions, what triggers each) on a whiteboard without looking it up.
- Can justify the CRC32C-per-chunk / SHA-256-whole-file split by threat model and CPU cost, not just recite it.
- Can explain how HTTP Range requests give resumable/parallel *download* almost for free, once chunked upload already exists.
- Can walk through the actual deployment shape (2 containers, nginx as TLS-terminating reverse proxy, CI builds/pushes, server only pulls) and say why each piece is there.
- Could apply this pattern to a *new* project (different language/framework) without re-deriving it from scratch.

## Constraints
- Multi-session, self-paced — no deadline.
- Interleave engineering concepts (protocol design, checksums, resumability, memory bounds) with the concrete stack used here (Spring Boot, React + shadcn, Docker/nginx deployment) rather than teaching either track in isolation.
- Ground every lesson in this repo's actual code/ADRs/docs where possible — this is a real system that was actually built and deployed, not a toy example.

## Out of scope
- Deep Spring Boot or React fundamentals unrelated to the transfer pattern itself.
- tus.io / S3 multipart-upload API specifics as protocols to *adopt* — this project deliberately avoided them (ADR 0001); they're worth knowing *about* for comparison, not implementing.
- Multi-user/auth/production-hardening concerns — this system is explicitly single-user.
