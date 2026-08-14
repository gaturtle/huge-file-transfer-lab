package com.hugefiletransfer.backend.upload;

/** Chunk failed exact-size or CRC32C validation; maps to 422. */
public class InvalidChunkException extends RuntimeException {
    public InvalidChunkException(String message) {
        super(message);
    }
}
