package com.hugefiletransfer.backend.upload;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class UploadExceptionHandler {

    @ExceptionHandler(UploadNotFoundException.class)
    public ResponseEntity<String> handleNotFound(UploadNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
    }

    @ExceptionHandler(InvalidChunkException.class)
    public ResponseEntity<String> handleInvalidChunk(InvalidChunkException e) {
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(e.getMessage());
    }

    @ExceptionHandler(SessionStateConflictException.class)
    public ResponseEntity<String> handleConflict(SessionStateConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(e.getMessage());
    }
}
