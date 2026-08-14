package com.hugefiletransfer.backend.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app")
public record AppProperties(String stagingDir, String completedDir) {
}
