package com.hugefiletransfer.backend.upload;

import java.util.ArrayList;
import java.util.List;

/** A bit per chunk index, backed by the same byte layout persisted in the received_chunks BLOB column. */
public final class ReceivedChunks {

    private final byte[] bits;
    private final int chunkCount;

    private ReceivedChunks(byte[] bits, int chunkCount) {
        this.bits = bits;
        this.chunkCount = chunkCount;
    }

    public static ReceivedChunks empty(int chunkCount) {
        return new ReceivedChunks(new byte[byteLength(chunkCount)], chunkCount);
    }

    public static ReceivedChunks fromBytes(byte[] bits, int chunkCount) {
        return new ReceivedChunks(bits, chunkCount);
    }

    private static int byteLength(int chunkCount) {
        return (chunkCount + 7) / 8;
    }

    public boolean isReceived(int index) {
        int byteIndex = index / 8;
        int bitOffset = index % 8;
        return (bits[byteIndex] & (1 << bitOffset)) != 0;
    }

    public void markReceived(int index) {
        int byteIndex = index / 8;
        int bitOffset = index % 8;
        bits[byteIndex] |= (byte) (1 << bitOffset);
    }

    public boolean allReceived() {
        for (int i = 0; i < chunkCount; i++) {
            if (!isReceived(i)) {
                return false;
            }
        }
        return true;
    }

    public List<Integer> receivedIndices() {
        List<Integer> indices = new ArrayList<>();
        for (int i = 0; i < chunkCount; i++) {
            if (isReceived(i)) {
                indices.add(i);
            }
        }
        return indices;
    }

    public byte[] toBytes() {
        return bits;
    }
}
