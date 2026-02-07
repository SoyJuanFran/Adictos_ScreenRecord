# Adictos_ScreenRecord

A FiveM resource that records a player's screen server-side and uploads the resulting video to a Discord webhook. Designed for anticheat evidence, admin review, or any situation where you need a clip of what a player is doing.

## Installation

1. Copy `Adictos_ScreenRecord` into your resources folder.
2. Open `config.lua` and set `Config.DiscordWebhook` to your webhook URL.
3. Add `ensure Adictos_ScreenRecord` to your `server.cfg`.

## Configuration

All settings are in `config.lua`:

| Option | Default | Description |
|---|---|---|
| `DefaultDuration` | `10000` | Default recording length in ms |
| `MaxDuration` | `30000` | Maximum allowed recording length in ms |
| `Resolution.width` | `1280` | Capture width in pixels |
| `Resolution.height` | `720` | Capture height in pixels |
| `FPS` | `24` | Capture framerate |
| `DiscordWebhook` | `''` | Discord webhook URL for uploads |
| `WebhookUsername` | `'Screen Recorder'` | Bot name shown in Discord |
| `WebhookAvatar` | `''` | Bot avatar URL (optional) |
| `EmbedColor` | `16711680` | Embed color in decimal |
| `Debug` | `false` | Print debug messages to console |

Higher FPS and resolution produce larger files. Discord has a 25 MB upload limit per file, so keep recordings short or reduce quality if needed.

## Usage from other resources

Record a player and get the Discord URL back:

```lua
exports['Adictos_ScreenRecord']:recordPlayerScreen(source, 10000, function(success, urlOrError)
    if success then
        print('Video URL: ' .. urlOrError)
    else
        print('Recording failed: ' .. urlOrError)
    end
end, 'Reason for the recording')
```

Fire-and-forget (no callback):

```lua
exports['Adictos_ScreenRecord']:recordPlayerScreen(source, 10000)
```

Stop an active recording early:

```lua
exports['Adictos_ScreenRecord']:stopPlayerRecording(source)
```

Check if a player is currently being recorded:

```lua
local recording = exports['Adictos_ScreenRecord']:isPlayerBeingRecorded(source)
```

## Console command

```
/record <player_id> [duration_seconds] [reason]
```

Example:

```
/record 5 20 Suspected cheating
```



## License

LGPL-3.0
