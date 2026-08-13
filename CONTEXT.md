# Huge File Transfer Lab

A learning effort building a hand-rolled, chunked, resumable transfer of huge files (up to ~5GB) between a Spring Boot backend and a React + shadcn frontend, sized to run on a 1 vCPU / 1GB RAM / 25GB disk server.

## Language

**Chunk**:
A fixed-size (except possibly the last) contiguous slice of a file's bytes, the unit the client uploads and the server persists independently. Identified by a sequential index (0, 1, 2, ...) within its Upload Session, never by byte offset — offset is a derived fact (index × chunk size), not how a Chunk is addressed.
_Avoid_: Part, segment, block, piece

**Upload Session**:
The server-side record tracking one in-progress upload of one file: its Upload Id, expected chunk count/size, and which chunks have been received so far. Moves through a lifecycle as chunks arrive and Assembly is attempted: Uploading (accepting chunks) → Assembling (Assembly running) → Complete or Failed. Complete and Failed are both terminal — neither accepts further chunks; a Failed Upload Session cannot be resumed, only replaced by a new one.
_Avoid_: Upload job, transfer

**Upload Id**:
The unique identifier for an Upload Session, generated when the session is created and used by the client on every chunk request and on resume.
_Avoid_: Session id, transfer id (session id is fine informally, but Upload Id is canonical for the field/API name)

**Manifest**:
The client-computed description of a file before upload starts: filename, total size, and the file's overall checksum. Sent to the server to open an Upload Session; chunk size and chunk count are derived by the server from total size, not supplied by the client.
_Avoid_: Metadata, header

**Checksum**:
A hash used to verify a Chunk or the reassembled file was received intact. A chunk checksum covers one Chunk and is checked as it arrives; the file checksum covers the whole reassembled file and is checked once, at Assembly. The two use different algorithms for different purposes — see [ADR 0002](./docs/adr/0002-split-checksum-algorithm.md).
_Avoid_: Hash, digest (checksum is canonical; hash/digest describe the mechanism, not the domain concept)

**Resume**:
The client behavior of asking the server which chunks an existing Upload Session already has, then sending only the missing ones, instead of restarting the file from byte zero.
_Avoid_: Retry, restart

**Assembly**:
The server-side step of concatenating all received chunks of a completed Upload Session, in order, into the final file, then verifying the file checksum before discarding the chunks.
_Avoid_: Merge, finalize (finalize is fine as a verb for triggering assembly; assembly is the canonical noun for the step itself)

**Range Request**:
An HTTP request for a byte range of a file (the `Range` header), the mechanism the download side uses for chunked/resumable/parallel download — distinct from Chunk, which is an upload-side concept the client controls.
_Avoid_: Download chunk (a Range Request is not chunked in advance the way an upload Manifest is; it's requested on demand)
