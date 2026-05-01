import hashlib
import json
import secrets
from pathlib import Path

import yaml
from endstone import ColorFormat, GameMode, Player
from endstone.command import Command, CommandExecutor, CommandSender
from endstone.event import (
    BlockBreakEvent,
    BlockPlaceEvent,
    PlayerChatEvent,
    PlayerDropItemEvent,
    PlayerInteractActorEvent,
    PlayerInteractEvent,
    PlayerJoinEvent,
    PlayerMoveEvent,
    PlayerPickupItemEvent,
    PlayerQuitEvent,
    event_handler,
)
from endstone.plugin import Plugin


def plugin_metadata(filename):
    def decorator(cls):
        with (Path(__file__).parent / filename).open("r") as file:
            data = yaml.safe_load(file)
        for key, value in data.items():
            setattr(cls, key, value)
        return cls

    return decorator


def hash_password(password: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()


@plugin_metadata("plugin.yml")
class SimpleAuthPlugin(Plugin):
    def on_enable(self) -> None:
        self.data_folder.mkdir(parents=True, exist_ok=True)
        self._accounts_file = self.data_folder / "accounts.json"
        self._accounts = self._load_accounts()
        self._pending: dict[str, dict] = {}
        self._last_join_loc: dict[str, tuple] = {}

        self.register_events(self)
        self.register_command("login", LoginExecutor(self))
        self.register_command("register", RegisterExecutor(self))
        self.register_command("changepass", ChangePassExecutor(self))
        self.register_command("unregister", UnregisterExecutor(self))

        self.logger.info(f"SimpleAuth enabled. {len(self._accounts)} registered accounts.")

    def on_disable(self) -> None:
        self._save_accounts()

    def _load_accounts(self) -> dict:
        if self._accounts_file.exists():
            try:
                with self._accounts_file.open("r") as f:
                    return json.load(f)
            except Exception as e:
                self.logger.error(f"Failed to load accounts: {e}")
        return {}

    def _save_accounts(self) -> None:
        try:
            with self._accounts_file.open("w") as f:
                json.dump(self._accounts, f, indent=2)
        except Exception as e:
            self.logger.error(f"Failed to save accounts: {e}")

    def register_command(self, name: str, executor: CommandExecutor) -> None:
        cmd = self.get_command(name)
        if cmd is not None:
            cmd.executor = executor

    def is_pending(self, name: str) -> bool:
        return name in self._pending

    def authenticate(self, player: Player) -> None:
        info = self._pending.pop(player.name, None)
        if info is None:
            return
        # Restore game mode and inventory state
        try:
            player.game_mode = info.get("game_mode", GameMode.SURVIVAL)
        except Exception:
            pass
        loc = self._last_join_loc.pop(player.name, None)
        if loc is not None:
            try:
                player.teleport(loc)
            except Exception:
                pass
        player.send_message(f"{ColorFormat.GREEN}Authenticated successfully.")

    def freeze(self, player: Player) -> None:
        # Save current game mode, force spectator (can't interact, can't take damage)
        try:
            current_mode = player.game_mode
        except Exception:
            current_mode = GameMode.SURVIVAL
        self._pending[player.name] = {"game_mode": current_mode}
        self._last_join_loc[player.name] = player.location
        try:
            player.game_mode = GameMode.SPECTATOR
        except Exception as e:
            self.logger.warning(f"Could not set spectator mode for {player.name}: {e}")

    def prompt(self, player: Player) -> None:
        if player.name in self._accounts:
            player.send_message(
                f"{ColorFormat.YELLOW}Type {ColorFormat.AQUA}/login <password>{ColorFormat.YELLOW} to authenticate."
            )
        else:
            player.send_message(
                f"{ColorFormat.YELLOW}Type {ColorFormat.AQUA}/register <password> <password>{ColorFormat.YELLOW} to create an account."
            )
        player.send_message(
            f"{ColorFormat.GRAY}You cannot move, chat, or interact until authenticated."
        )

    # --- Event handlers ---

    @event_handler()
    def on_player_join(self, event: PlayerJoinEvent) -> None:
        player = event.player
        # OPs bypass auth (they have admin access via console anyway)
        if player.is_op:
            return
        self.freeze(player)
        # Delay the prompt slightly so the join message renders first
        self.server.scheduler.run_task(self, lambda: self.prompt(player), delay=10)

    @event_handler()
    def on_player_quit(self, event: PlayerQuitEvent) -> None:
        self._pending.pop(event.player.name, None)
        self._last_join_loc.pop(event.player.name, None)

    @event_handler()
    def on_player_chat(self, event: PlayerChatEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()
            event.player.send_message(
                f"{ColorFormat.RED}Authenticate first: /login or /register"
            )

    @event_handler()
    def on_player_move(self, event: PlayerMoveEvent) -> None:
        # Spectator teleports through walls; just suppress horizontal drift
        if not self.is_pending(event.player.name):
            return
        anchor = self._last_join_loc.get(event.player.name)
        if anchor is None:
            return
        # Only re-anchor if they wandered too far
        try:
            dx = event.to_location.x - anchor.x
            dz = event.to_location.z - anchor.z
            if (dx * dx + dz * dz) > 100:
                event.player.teleport(anchor)
        except Exception:
            pass

    @event_handler()
    def on_block_break(self, event: BlockBreakEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()

    @event_handler()
    def on_block_place(self, event: BlockPlaceEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()

    @event_handler()
    def on_player_interact(self, event: PlayerInteractEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()

    @event_handler()
    def on_player_interact_actor(self, event: PlayerInteractActorEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()

    @event_handler()
    def on_player_drop_item(self, event: PlayerDropItemEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()

    @event_handler()
    def on_player_pickup(self, event: PlayerPickupItemEvent) -> None:
        if self.is_pending(event.player.name):
            event.cancel()


class LoginExecutor(CommandExecutor):
    def __init__(self, plugin: SimpleAuthPlugin):
        super().__init__()
        self.plugin = plugin

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("Only players can use this command.")
            return True
        player = sender
        if not self.plugin.is_pending(player.name):
            player.send_message(f"{ColorFormat.YELLOW}You are already authenticated.")
            return True
        if len(args) < 1:
            player.send_message(f"{ColorFormat.RED}Usage: /login <password>")
            return True
        password = args[0]
        record = self.plugin._accounts.get(player.name)
        if record is None:
            player.send_message(
                f"{ColorFormat.RED}Account not registered. Use /register <password> <password>."
            )
            return True
        if hash_password(password, record["salt"]) != record["hash"]:
            player.send_message(f"{ColorFormat.RED}Wrong password.")
            return True
        self.plugin.authenticate(player)
        return True


class RegisterExecutor(CommandExecutor):
    def __init__(self, plugin: SimpleAuthPlugin):
        super().__init__()
        self.plugin = plugin

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("Only players can use this command.")
            return True
        player = sender
        if not self.plugin.is_pending(player.name):
            player.send_message(f"{ColorFormat.YELLOW}You are already authenticated.")
            return True
        if player.name in self.plugin._accounts:
            player.send_message(
                f"{ColorFormat.RED}Already registered. Use /login <password>."
            )
            return True
        if len(args) < 2:
            player.send_message(
                f"{ColorFormat.RED}Usage: /register <password> <password> (twice to confirm)"
            )
            return True
        password, confirm = args[0], args[1]
        if password != confirm:
            player.send_message(f"{ColorFormat.RED}Passwords do not match.")
            return True
        if len(password) < 4:
            player.send_message(f"{ColorFormat.RED}Password must be at least 4 characters.")
            return True
        salt = secrets.token_hex(8)
        self.plugin._accounts[player.name] = {
            "salt": salt,
            "hash": hash_password(password, salt),
        }
        self.plugin._save_accounts()
        self.plugin.authenticate(player)
        player.send_message(f"{ColorFormat.GREEN}Account registered. Save your password!")
        return True


class ChangePassExecutor(CommandExecutor):
    def __init__(self, plugin: SimpleAuthPlugin):
        super().__init__()
        self.plugin = plugin

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if not isinstance(sender, Player):
            sender.send_error_message("Only players can use this command.")
            return True
        player = sender
        if self.plugin.is_pending(player.name):
            player.send_message(f"{ColorFormat.RED}Authenticate first.")
            return True
        if len(args) < 2:
            player.send_message(f"{ColorFormat.RED}Usage: /changepass <old> <new>")
            return True
        old, new = args[0], args[1]
        record = self.plugin._accounts.get(player.name)
        if record is None or hash_password(old, record["salt"]) != record["hash"]:
            player.send_message(f"{ColorFormat.RED}Wrong current password.")
            return True
        if len(new) < 4:
            player.send_message(f"{ColorFormat.RED}Password must be at least 4 characters.")
            return True
        salt = secrets.token_hex(8)
        self.plugin._accounts[player.name] = {
            "salt": salt,
            "hash": hash_password(new, salt),
        }
        self.plugin._save_accounts()
        player.send_message(f"{ColorFormat.GREEN}Password changed.")
        return True


class UnregisterExecutor(CommandExecutor):
    def __init__(self, plugin: SimpleAuthPlugin):
        super().__init__()
        self.plugin = plugin

    def on_command(self, sender: CommandSender, command: Command, args: list[str]) -> bool:
        if len(args) < 1:
            sender.send_error_message("Usage: /unregister <player>")
            return True
        target = args[0]
        if target not in self.plugin._accounts:
            sender.send_error_message(f"No account for {target}.")
            return True
        del self.plugin._accounts[target]
        self.plugin._save_accounts()
        sender.send_message(f"{ColorFormat.GREEN}Unregistered {target}.")
        return True
