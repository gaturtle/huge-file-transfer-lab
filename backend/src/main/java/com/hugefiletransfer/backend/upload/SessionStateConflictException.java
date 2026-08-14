package com.hugefiletransfer.backend.upload;

/** The requested operation isn't valid for the session's current state; maps to 409. */
public class SessionStateConflictException extends RuntimeException {
    public SessionStateConflictException(String message) {
        super(message);
    }
}
