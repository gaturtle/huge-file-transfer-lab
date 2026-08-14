package com.hugefiletransfer.backend.upload;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public class UploadSessionRepository {

    private final JdbcTemplate jdbcTemplate;

    public UploadSessionRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    private static final RowMapper<UploadSession> ROW_MAPPER = (rs, rowNum) -> {
        int chunkCount = rs.getInt("chunk_count");
        return new UploadSession(
                rs.getString("upload_id"),
                rs.getString("filename"),
                rs.getLong("total_size"),
                rs.getString("checksum"),
                chunkCount,
                UploadState.valueOf(rs.getString("state")),
                ReceivedChunks.fromBytes(rs.getBytes("received_chunks"), chunkCount),
                rs.getLong("last_activity_at")
        );
    };

    public void insert(UploadSession session) {
        jdbcTemplate.update("""
                INSERT INTO upload_sessions
                    (upload_id, filename, total_size, checksum, chunk_count, state, received_chunks, last_activity_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                session.uploadId(), session.filename(), session.totalSize(), session.checksum(),
                session.chunkCount(), session.state().name(), session.receivedChunks().toBytes(),
                session.lastActivityAt());
    }

    public Optional<UploadSession> findById(String uploadId) {
        List<UploadSession> results = jdbcTemplate.query(
                "SELECT * FROM upload_sessions WHERE upload_id = ?", ROW_MAPPER, uploadId);
        return results.stream().findFirst();
    }

    public void markChunkReceived(String uploadId, ReceivedChunks receivedChunks, long lastActivityAt) {
        jdbcTemplate.update(
                "UPDATE upload_sessions SET received_chunks = ?, last_activity_at = ? WHERE upload_id = ?",
                receivedChunks.toBytes(), lastActivityAt, uploadId);
    }

    public void updateState(String uploadId, UploadState state) {
        jdbcTemplate.update("UPDATE upload_sessions SET state = ? WHERE upload_id = ?", state.name(), uploadId);
    }

    public List<UploadSession> findExpirable(UploadState state, long olderThanEpochMillis) {
        return jdbcTemplate.query(
                "SELECT * FROM upload_sessions WHERE state = ? AND last_activity_at < ?",
                ROW_MAPPER, state.name(), olderThanEpochMillis);
    }

    public List<UploadSession> findTerminalOlderThan(long epochMillis) {
        return jdbcTemplate.query(
                "SELECT * FROM upload_sessions WHERE state = ? AND last_activity_at < ?",
                ROW_MAPPER, UploadState.FAILED.name(), epochMillis);
    }

    public void delete(String uploadId) {
        jdbcTemplate.update("DELETE FROM upload_sessions WHERE upload_id = ?", uploadId);
    }
}
