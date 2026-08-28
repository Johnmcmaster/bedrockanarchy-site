package org.nocoords.forum;

import java.io.File;
import org.bukkit.configuration.file.FileConfiguration;
import org.bukkit.plugin.java.JavaPlugin;

/*
 * Bukkit/Spigot/Paper entry point. The plugin is only a lifecycle shim: it
 * reads config.yml, starts the HTTP server on enable, and stops it on disable.
 * All request handling runs on the HTTP server's own thread pool — nothing
 * ever touches the main server thread, so the forum cannot cost tick time.
 */
public final class NoCoordsPlugin extends JavaPlugin {

  private ForumServer server;

  @Override
  public void onEnable() {
    saveDefaultConfig();
    FileConfiguration config = getConfig();
    try {
      ForumConfig forumConfig =
          new ForumConfig(
              config.getString("bind", "0.0.0.0"),
              config.getInt("port", 8321),
              config.getString("admin-key", ""),
              config.getString("allowed-origin", "*"),
              config.getInt("pow-difficulty", 16),
              config.getString("proxy-ip-header", ""),
              new File(getDataFolder(), "data.json").toPath());
      server = new ForumServer(forumConfig, getLogger());
      server.start();
      getLogger()
          .info("Forum API listening on " + forumConfig.bind() + ":" + forumConfig.port());
      if (forumConfig.adminKey().isEmpty()) {
        getLogger().info("No admin-key set: post removal is disabled until you configure one.");
      }
    } catch (Exception e) {
      getLogger().severe("Forum backend failed to start: " + e.getMessage());
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
