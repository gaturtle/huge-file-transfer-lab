package com.hugefiletransfer.backend.upload;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class SchemaInitializer {

    private final JdbcTemplate jdbcTemplate;

    public SchemaInitializer(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @PostConstruct
    public void init() {
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS upload_sessions (
                upload_id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                total_size INTEGER NOT NULL,
                checksum TEXT NOT NULL,
                chunk_count INTEGER NOT NULL,
                state TEXT NOT NULL,
                received_chunks BLOB NOT NULL,
                last_activity_at INTEGER NOT NULL
            )
            """);
        jdbcTemplate.execute("""
            CREATE INDEX IF NOT EXISTS idx_upload_sessions_state_activity
                ON upload_sessions (state, last_activity_at)
            """);
    }
}
