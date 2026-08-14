package com.hugefiletransfer.backend.upload;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ChunkConstantsTest {

    @Test
    void chunkCountForExactMultiple() {
        assertEquals(2, ChunkConstants.chunkCountFor(2L * ChunkConstants.CHUNK_SIZE));
    }

    @Test
    void chunkCountForRemainder() {
        assertEquals(3, ChunkConstants.chunkCountFor(2L * ChunkConstants.CHUNK_SIZE + 1));
    }

    @Test
    void lastChunkIsShort() {
        long totalSize = 2L * ChunkConstants.CHUNK_SIZE + 100;
        assertEquals(ChunkConstants.CHUNK_SIZE, ChunkConstants.expectedSizeFor(0, totalSize));
        assertEquals(ChunkConstants.CHUNK_SIZE, ChunkConstants.expectedSizeFor(1, totalSize));
        assertEquals(100, ChunkConstants.expectedSizeFor(2, totalSize));
    }

    @Test
    void offsetIsIndexTimesChunkSize() {
        assertEquals(0L, ChunkConstants.offsetFor(0));
        assertEquals((long) ChunkConstants.CHUNK_SIZE, ChunkConstants.offsetFor(1));
    }
}
