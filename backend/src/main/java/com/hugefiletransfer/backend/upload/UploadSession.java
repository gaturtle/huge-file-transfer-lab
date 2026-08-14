package com.hugefiletransfer.backend.upload;

public record UploadSession(
        String uploadId,
        String filename,
        long totalSize,
        String checksum,
        int chunkCount,
        UploadState state,
        ReceivedChunks receivedChunks,
        long lastActivityAt
) {
}
