package com.hugefiletransfer.backend.upload;

import java.util.List;

public record UploadStatusResponse(UploadState state, int chunkCount, List<Integer> receivedChunks) {
}
