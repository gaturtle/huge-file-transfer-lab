package com.hugefiletransfer.backend.upload;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReceivedChunksTest {

    @Test
    void startsEmpty() {
        ReceivedChunks chunks = ReceivedChunks.empty(10);
        assertFalse(chunks.allReceived());
        assertEquals(0, chunks.receivedIndices().size());
    }

    @Test
    void marksAndReportsIndividualBits() {
        ReceivedChunks chunks = ReceivedChunks.empty(10);
        chunks.markReceived(3);
        chunks.markReceived(9);
        assertTrue(chunks.isReceived(3));
        assertTrue(chunks.isReceived(9));
        assertFalse(chunks.isReceived(0));
        assertEquals(java.util.List.of(3, 9), chunks.receivedIndices());
    }

    @Test
    void allReceivedOnceEveryIndexMarked() {
        ReceivedChunks chunks = ReceivedChunks.empty(3);
        chunks.markReceived(0);
        chunks.markReceived(1);
        assertFalse(chunks.allReceived());
        chunks.markReceived(2);
        assertTrue(chunks.allReceived());
    }

    @Test
    void roundTripsThroughBytes() {
        ReceivedChunks chunks = ReceivedChunks.empty(20);
        chunks.markReceived(17);
        ReceivedChunks reloaded = ReceivedChunks.fromBytes(chunks.toBytes(), 20);
        assertTrue(reloaded.isReceived(17));
        assertFalse(reloaded.isReceived(16));
    }
}
