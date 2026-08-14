package com.hugefiletransfer.backend.upload;

public record CreateUploadResponse(String uploadId, int chunkSize, int chunkCount) {
}
