package com.hugefiletransfer.backend.upload;

import com.hugefiletransfer.backend.config.AppProperties;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

@Service
public class AssemblyService {

    private final ChunkStagingService chunkStagingService;
    private final Path completedDir;

    public AssemblyService(ChunkStagingService chunkStagingService, AppProperties appProperties) throws IOException {
        this.chunkStagingService = chunkStagingService;
        this.completedDir = Path.of(appProperties.completedDir());
        Files.createDirectories(completedDir);
    }

    public Path completedFileFor(String uploadId) {
        return completedDir.resolve(uploadId);
    }

    /** Verifies the staged file's whole-file SHA-256 against the Manifest checksum, then renames it into place. */
    public AssemblyResult assemble(String uploadId, String expectedSha256Hex) throws IOException {
        Path stagingFile = chunkStagingService.stagingFileFor(uploadId);
        String actualSha256Hex = sha256Hex(stagingFile);

        if (!actualSha256Hex.equalsIgnoreCase(expectedSha256Hex.trim())) {
            chunkStagingService.deleteStagingFile(uploadId);
            return new AssemblyResult(false, actualSha256Hex);
        }

        Files.move(stagingFile, completedFileFor(uploadId), StandardCopyOption.REPLACE_EXISTING);
        return new AssemblyResult(true, actualSha256Hex);
    }

    private static String sha256Hex(Path file) throws IOException {
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
        byte[] buffer = new byte[64 * 1024];
        try (InputStream in = Files.newInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) != -1) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) {
            hex.append(String.format("%02x", b));
        }
        return hex.toString();
    }

    public record AssemblyResult(boolean checksumMatched, String actualSha256Hex) {
    }
}
