package com.hugefiletransfer.backend.upload;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.time.Duration;
import java.util.List;

/**
 * Reclaims abandoned UPLOADING sessions after 24h of inactivity, and purges their
 * rows after an additional grace period so a client's next status check can still
 * see why its Upload Id died.
 */
@Component
public class TtlSweepService {

    private static final Logger log = LoggerFactory.getLogger(TtlSweepService.class);

    private static final Duration UPLOADING_TTL = Duration.ofHours(24);
    private static final Duration PURGE_GRACE_PERIOD = Duration.ofHours(1);

    private final UploadSessionRepository repository;
    private final ChunkStagingService chunkStagingService;

    public TtlSweepService(UploadSessionRepository repository, ChunkStagingService chunkStagingService) {
        this.repository = repository;
        this.chunkStagingService = chunkStagingService;
    }

    @Scheduled(fixedDelay = 15, timeUnit = java.util.concurrent.TimeUnit.MINUTES)
    public void sweep() {
        expireAbandonedUploads();
        purgeOldTerminalSessions();
    }

    private void expireAbandonedUploads() {
        long cutoff = System.currentTimeMillis() - UPLOADING_TTL.toMillis();
        List<UploadSession> expired = repository.findExpirable(UploadState.UPLOADING, cutoff);
        for (UploadSession session : expired) {
            try {
                chunkStagingService.deleteStagingFile(session.uploadId());
            } catch (IOException e) {
                log.warn("Failed to delete staging file for expired upload {}", session.uploadId(), e);
            }
            repository.updateState(session.uploadId(), UploadState.FAILED);
            log.info("Expired abandoned upload session {} ({}h inactivity)", session.uploadId(), UPLOADING_TTL.toHours());
        }
    }

    private void purgeOldTerminalSessions() {
        long cutoff = System.currentTimeMillis() - UPLOADING_TTL.toMillis() - PURGE_GRACE_PERIOD.toMillis();
        List<UploadSession> toPurge = repository.findTerminalOlderThan(cutoff);
        for (UploadSession session : toPurge) {
            repository.delete(session.uploadId());
            log.info("Purged terminal upload session {}", session.uploadId());
        }
    }
}
