package com.hugefiletransfer.backend.upload;

import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Service
public class UploadService {

    private final UploadSessionRepository repository;
    private final ChunkStagingService chunkStagingService;
    private final AssemblyService assemblyService;

    /**
     * Chunk PUTs arrive 3-4 at a time in parallel (issue #3); the received-chunks bitset
     * read-modify-write must be serialized per session or concurrent PUTs can race and
     * lose each other's bit flips. Different sessions still proceed independently.
     */
    private final ConcurrentHashMap<String, Object> sessionLocks = new ConcurrentHashMap<>();

    private Object lockFor(String uploadId) {
        return sessionLocks.computeIfAbsent(uploadId, id -> new Object());
    }

    public UploadService(UploadSessionRepository repository,
                          ChunkStagingService chunkStagingService,
                          AssemblyService assemblyService) {
        this.repository = repository;
        this.chunkStagingService = chunkStagingService;
        this.assemblyService = assemblyService;
    }

    public CreateUploadResponse createUpload(ManifestRequest manifest) {
        String uploadId = UUID.randomUUID().toString();
        int chunkCount = ChunkConstants.chunkCountFor(manifest.totalSize());
        long now = System.currentTimeMillis();

        try {
            chunkStagingService.preallocate(uploadId, manifest.totalSize());
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }

        UploadSession session = new UploadSession(
                uploadId, manifest.filename(), manifest.totalSize(), manifest.checksum(),
                chunkCount, UploadState.UPLOADING, ReceivedChunks.empty(chunkCount), now);
        repository.insert(session);

        return new CreateUploadResponse(uploadId, ChunkConstants.CHUNK_SIZE, chunkCount);
    }

    public UploadSession getSession(String uploadId) {
        return repository.findById(uploadId).orElseThrow(() -> new UploadNotFoundException(uploadId));
    }

    public UploadStatusResponse getStatus(String uploadId) {
        UploadSession session = getSession(uploadId);
        return new UploadStatusResponse(session.state(), session.chunkCount(), session.receivedChunks().receivedIndices());
    }

    public void putChunk(String uploadId, int index, byte[] chunkBytes, String crc32cHex) {
        UploadSession session = getSession(uploadId);
        if (session.state() != UploadState.UPLOADING) {
            throw new SessionStateConflictException(
                    "Upload session " + uploadId + " is " + session.state() + ", not accepting chunks");
        }
        if (index < 0 || index >= session.chunkCount()) {
            throw new InvalidChunkException("Chunk index " + index + " out of range [0, " + session.chunkCount() + ")");
        }

        // Writing chunk bytes to disjoint offsets is safe to parallelize; only the
        // shared bitset read-modify-write below needs serializing per session.
        try {
            chunkStagingService.writeChunk(uploadId, index, session.totalSize(), chunkBytes, crc32cHex);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }

        synchronized (lockFor(uploadId)) {
            ReceivedChunks receivedChunks = getSession(uploadId).receivedChunks();
            receivedChunks.markReceived(index);
            repository.markChunkReceived(uploadId, receivedChunks, System.currentTimeMillis());
        }
    }

    public UploadStatusResponse complete(String uploadId) {
        UploadSession session = getSession(uploadId);
        if (session.state() != UploadState.UPLOADING) {
            throw new SessionStateConflictException(
                    "Upload session " + uploadId + " is " + session.state() + ", cannot complete");
        }
        if (!session.receivedChunks().allReceived()) {
            List<Integer> received = session.receivedChunks().receivedIndices();
            throw new SessionStateConflictException(
                    "Upload session " + uploadId + " has only received " + received.size()
                            + " of " + session.chunkCount() + " chunks");
        }

        repository.updateState(uploadId, UploadState.ASSEMBLING);

        AssemblyService.AssemblyResult result;
        try {
            result = assemblyService.assemble(uploadId, session.checksum());
        } catch (IOException e) {
            repository.updateState(uploadId, UploadState.FAILED);
            throw new UncheckedIOException(e);
        }

        UploadState finalState = result.checksumMatched() ? UploadState.COMPLETE : UploadState.FAILED;
        repository.updateState(uploadId, finalState);

        return new UploadStatusResponse(finalState, session.chunkCount(), session.receivedChunks().receivedIndices());
    }
}
