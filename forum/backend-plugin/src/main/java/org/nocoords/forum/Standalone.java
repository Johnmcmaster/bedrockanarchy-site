package org.nocoords.forum;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.logging.Logger;

/*
 * Standalone mode: `java -jar nocoords-backend.jar [config.properties]`.
 *
 * The same jar that loads as a Bukkit plugin also runs as its own process, for
 * hosts that are not Bukkit-family (Bedrock Dedicated Server, PocketMine) or
 * for keeping the forum off the game server entirely. Settings come from
 * nocoords.properties in the working directory (or the path given as the first
 * argument); every key is optional.
 */
public final class Standalone {

  private Standalone() {}

  public static void main(String[] args) throws IOException {
    Logger logger = Logger.getLogger("nocoords");

    Properties props = new Properties();
    Path propsFile = Path.of(args.length > 0 ? args[0] : "nocoords.properties");
    if (Files.exists(propsFile)) {
      try (InputStream in = Files.newInputStream(propsFile)) {
        props.load(in);
      }
    }

    ForumConfig config =
        new ForumConfig(
            props.getProperty("bind", "0.0.0.0"),
            Integer.parseInt(props.getProperty("port", "8321")),
            props.getProperty("admin-key", ""),
            props.getProperty("allowed-origin", "*"),
            Integer.parseInt(props.getProperty("pow-difficulty", "16")),
            props.getProperty("proxy-ip-header", ""),
            Path.of(props.getProperty("data-file", "nocoords-data.json")));

    ForumServer server = new ForumServer(config, logger);
    server.start();
    logger.info("NoCoords forum API listening on " + config.bind() + ":" + config.port());
    if (config.adminKey().isEmpty()) {
      logger.info("No admin-key set: post removal is disabled until you configure one.");
    }

    Runtime.getRuntime().addShutdownHook(new Thread(server::stop, "nocoords-shutdown"));
  }
}
