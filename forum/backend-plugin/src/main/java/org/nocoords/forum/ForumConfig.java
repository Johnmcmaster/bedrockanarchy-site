package org.nocoords.forum;

import java.nio.file.Path;

/**
 * Runtime settings, filled in from config.yml (plugin mode) or
 * nocoords.properties (standalone mode).
 *
 * @param bind          address to listen on, e.g. 0.0.0.0
 * @param port          TCP port for the API
 * @param adminKey      key required on DELETE; empty disables removal entirely
 * @param allowedOrigin CORS origin allowed to call the API ("*" or one origin)
 * @param powDifficulty leading zero bits required of a proof of work
 * @param proxyIpHeader header carrying the real client IP when behind a
 *                      reverse proxy (e.g. "CF-Connecting-IP" on Cloudflare);
 *                      empty means use the socket address
 * @param dataFile      where the JSON data file lives
 */
public record ForumConfig(
    String bind,
    int port,
    String adminKey,
    String allowedOrigin,
    int powDifficulty,
    String proxyIpHeader,
    Path dataFile) {}
