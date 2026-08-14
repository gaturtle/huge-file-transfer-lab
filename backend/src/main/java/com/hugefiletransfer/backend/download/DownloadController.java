package com.hugefiletransfer.backend.download;

import com.hugefiletransfer.backend.upload.AssemblyService;
import com.hugefiletransfer.backend.upload.SessionStateConflictException;
import com.hugefiletransfer.backend.upload.UploadService;
import com.hugefiletransfer.backend.upload.UploadSession;
import com.hugefiletransfer.backend.upload.UploadState;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.support.ResourceRegion;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRange;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;

@RestController
@RequestMapping("/uploads")
public class DownloadController {

    private final UploadService uploadService;
    private final AssemblyService assemblyService;

    public DownloadController(UploadService uploadService, AssemblyService assemblyService) {
        this.uploadService = uploadService;
        this.assemblyService = assemblyService;
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<ResourceRegion> download(@PathVariable("id") String uploadId, HttpHeaders requestHeaders) {
        UploadSession session = uploadService.getSession(uploadId);
        if (session.state() != UploadState.COMPLETE) {
            throw new SessionStateConflictException(
                    "Upload session " + uploadId + " is " + session.state() + ", not available for download");
        }

        String etag = "\"" + session.checksum() + "\"";
        FileSystemResource resource = new FileSystemResource(assemblyService.completedFileFor(uploadId));
        long contentLength;
        try {
            contentLength = resource.contentLength();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }

        // If-Range must match the whole-file SHA-256 ETag, not a filesystem timestamp, to be honored.
        String ifRange = requestHeaders.getFirst(HttpHeaders.IF_RANGE);
        boolean ifRangeMismatch = ifRange != null && !ifRange.equals(etag);

        List<HttpRange> ranges = requestHeaders.getRange();
        boolean serveFull = ranges.isEmpty() || ifRangeMismatch;

        ResourceRegion region;
        HttpStatus status;
        if (serveFull) {
            region = new ResourceRegion(resource, 0, contentLength);
            status = HttpStatus.OK;
        } else {
            region = ranges.get(0).toResourceRegion(resource);
            status = HttpStatus.PARTIAL_CONTENT;
        }

        return ResponseEntity.status(status)
                .header(HttpHeaders.ETAG, etag)
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(region);
    }
}
