package com.hugefiletransfer.backend.upload;

public class UploadNotFoundException extends RuntimeException {
    public UploadNotFoundException(String uploadId) {
        super("No upload session with id " + uploadId);
    }
}
