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
 * @param siteDir       folder of static site files to serve on every path
 *                      outside /api, or null to serve the API only
 */
public record ForumConfig(
    String bind,
    int port,
    String adminKey,
    String allowedOrigin,
    int powDifficulty,
    String proxyIpHeader,
    Path dataFile,
    Path siteDir) {

  /**
   * An explicit setting wins; otherwise the conventional folder is served if
   * it exists, and with neither the server is API-only.
   */
  public static Path resolveSiteDir(String configured, Path conventional) {
    if (configured != null && !configured.isBlank()) {
      return Path.of(configured.trim());
    }
    if (conventional != null && java.nio.file.Files.isDirectory(conventional)) {
      return conventional;
    }
    return null;
  }
}
