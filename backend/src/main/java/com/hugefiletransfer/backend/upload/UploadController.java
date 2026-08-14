package com.hugefiletransfer.backend.upload;

import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/uploads")
public class UploadController {

    private final UploadService uploadService;

    public UploadController(UploadService uploadService) {
        this.uploadService = uploadService;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public CreateUploadResponse create(@RequestBody ManifestRequest manifest) {
        return uploadService.createUpload(manifest);
    }

    @GetMapping("/{id}")
    public UploadStatusResponse status(@PathVariable("id") String uploadId) {
        return uploadService.getStatus(uploadId);
    }

    @PutMapping(value = "/{id}/chunks/{index}", consumes = MediaType.APPLICATION_OCTET_STREAM_VALUE)
    public void putChunk(@PathVariable("id") String uploadId,
                          @PathVariable("index") int index,
                          @RequestHeader(value = "X-Chunk-Checksum", required = false) String crc32cHex,
                          @RequestBody byte[] chunkBytes) {
        uploadService.putChunk(uploadId, index, chunkBytes, crc32cHex);
    }

    @PostMapping("/{id}/complete")
    public UploadStatusResponse complete(@PathVariable("id") String uploadId) {
        return uploadService.complete(uploadId);
    }
}
