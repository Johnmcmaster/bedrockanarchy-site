package org.nocoords.forum;

import cn.nukkit.plugin.PluginBase;
import java.io.File;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.logging.Logger;

/*
 * Nukkit-family entry point (Nukkit, PowerNukkit, PNX — Bedrock servers with
 * Java plugins). Same lifecycle shim as the Bukkit one; the HTTP server runs
 * on its own threads and never touches the tick loop.
 *
 * Configuration is a plain properties file in the plugin's data folder
 * (config.properties), written with defaults on first run. Only classes that
 * exist identically across Nukkit forks are referenced — logging goes through
 * java.util.logging to stay off fork-specific APIs.
 */
public final class NoCoordsNukkitPlugin extends PluginBase {

  private final Logger logger = Logger.getLogger("NoCoordsForum");
  private ForumServer server;

  @Override
  public void onEnable() {
    try {
      File dataFolder = getDataFolder();
      dataFolder.mkdirs();
      Path configFile = new File(dataFolder, "config.properties").toPath();
      if (!Files.exists(configFile)) {
        try (OutputStream out = Files.newOutputStream(configFile)) {
          out.write(
              String.join(
                      "\n",
                      "# NoCoords forum backend.",
                      "port=8321",
                      "bind=0.0.0.0",
                      "# Required for post removal; empty disables it.",
                      "admin-key=",
                      "# Lock to your site origin when live, e.g. https://nocoords.org",
                      "allowed-origin=*",
                      "pow-difficulty=16",
                      "# Behind Cloudflare set CF-Connecting-IP (used once, never stored).",
                      "proxy-ip-header=",
                      "")
                  .getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
      }
      Properties props = new Properties();
      try (InputStream in = Files.newInputStream(configFile)) {
        props.load(in);
      }
      ForumConfig config =
          new ForumConfig(
              props.getProperty("bind", "0.0.0.0"),
              Integer.parseInt(props.getProperty("port", "8321").trim()),
              props.getProperty("admin-key", "").trim(),
              props.getProperty("allowed-origin", "*").trim(),
              Integer.parseInt(props.getProperty("pow-difficulty", "16").trim()),
              props.getProperty("proxy-ip-header", "").trim(),
              new File(dataFolder, "data.json").toPath());
      server = new ForumServer(config, logger);
      server.start();
      logger.info("Forum API listening on " + config.bind() + ":" + config.port());
      if (config.adminKey().isEmpty()) {
        logger.info("No admin-key set: post removal is disabled until you configure one.");
      }
    } catch (Exception e) {
      logger.severe("Forum backend failed to start: " + e.getMessage());
      server = null;
    }
  }

  @Override
  public void onDisable() {
    if (server != null) {
      server.stop();
      server = null;
    }
  }
}
