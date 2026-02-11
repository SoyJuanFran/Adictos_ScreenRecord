Config = {}

-- Default recording duration in milliseconds
Config.DefaultDuration = 10000

-- Maximum allowed duration in milliseconds
Config.MaxDuration = 30000

-- Capture resolution
Config.Resolution = {
    width  = 1280,
    height = 720,
}

-- Capture framerate (higher = larger file size)
Config.FPS = 24

-- Discord webhook URL where videos are uploaded as attachments
Config.DiscordWebhook = ''

-- Bot username shown in Discord
Config.WebhookUsername = 'Screen Recorder'

-- Bot avatar URL (leave empty for default)
Config.WebhookAvatar = ''

-- Embed color (decimal) -- 16711680 = red, 3447003 = blue
Config.EmbedColor = 16711680

-- Spectate (live view) settings
Config.Spectate = {
    Resolution = {
        width  = 480,
        height = 270,
    },
    FPS     = 10,
    Quality = 0.20,
}

-- Print debug messages to console
Config.Debug = false

