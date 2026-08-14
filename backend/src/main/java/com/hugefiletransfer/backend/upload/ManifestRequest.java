package com.hugefiletransfer.backend.upload;

public record ManifestRequest(String filename, long totalSize, String checksum) {
}
