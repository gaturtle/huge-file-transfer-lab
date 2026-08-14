package com.hugefiletransfer.backend.upload;

import com.hugefiletransfer.backend.config.AppProperties;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.zip.CRC32C;

@Service
public class ChunkStagingService {

    private final Path stagingDir;

    public ChunkStagingService(AppProperties appProperties) throws IOException {
        this.stagingDir = Path.of(appProperties.stagingDir());
        Files.createDirectories(stagingDir);
    }

    public Path stagingFileFor(String uploadId) {
        return stagingDir.resolve(uploadId + ".part");
    }

    public void preallocate(String uploadId, long totalSize) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(stagingFileFor(uploadId).toFile(), "rw")) {
            raf.setLength(totalSize);
        }
    }

    /**
     * Writes chunkBytes at index's offset after verifying its exact size and CRC32C.
     * Throws InvalidChunkException without writing anything on validation failure.
     */
    public void writeChunk(String uploadId, int index, long totalSize, byte[] chunkBytes, String expectedCrc32cHex)
            throws IOException {
        int expectedSize = ChunkConstants.expectedSizeFor(index, totalSize);
        if (chunkBytes.length != expectedSize) {
            throw new InvalidChunkException(
                    "Chunk " + index + " expected " + expectedSize + " bytes, got " + chunkBytes.length);
        }

        CRC32C crc32c = new CRC32C();
        crc32c.update(chunkBytes);
        String actualCrc32cHex = String.format("%08x", crc32c.getValue());
        if (expectedCrc32cHex == null || !actualCrc32cHex.equalsIgnoreCase(expectedCrc32cHex.trim())) {
            throw new InvalidChunkException(
                    "Chunk " + index + " CRC32C mismatch: expected " + expectedCrc32cHex
                            + ", computed " + actualCrc32cHex);
        }

        long offset = ChunkConstants.offsetFor(index);
        try (RandomAccessFile raf = new RandomAccessFile(stagingFileFor(uploadId).toFile(), "rw")) {
            raf.seek(offset);
            raf.write(chunkBytes);
        }
    }

    public void deleteStagingFile(String uploadId) throws IOException {
        Files.deleteIfExists(stagingFileFor(uploadId));
    }
}
