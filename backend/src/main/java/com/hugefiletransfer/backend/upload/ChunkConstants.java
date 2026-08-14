package com.hugefiletransfer.backend.upload;

public final class ChunkConstants {

    public static final int CHUNK_SIZE = 8 * 1024 * 1024;

    private ChunkConstants() {
    }

    public static int chunkCountFor(long totalSize) {
        if (totalSize <= 0) {
            return 0;
        }
        return (int) ((totalSize + CHUNK_SIZE - 1) / CHUNK_SIZE);
    }

    public static long offsetFor(int index) {
        return (long) index * CHUNK_SIZE;
    }

    public static int expectedSizeFor(int index, long totalSize) {
        long remaining = totalSize - offsetFor(index);
        return (int) Math.min(CHUNK_SIZE, remaining);
    }
}
