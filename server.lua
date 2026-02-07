--[[
    server.lua
    Manages recording state and exposes exports for other resources.
    The actual video is uploaded to Discord directly from the client NUI,
    so the server never touches binary data -- it only receives the final URL.

    Usage from another resource:

        exports['Adictos_ScreenRecord']:recordPlayerScreen(source, duration, function(success, url)
            if success then
                print('Video uploaded: ' .. url)
            else
                print('Error: ' .. tostring(url))
            end
        end, 'Reason for recording')

    Fire-and-forget (no callback):

        exports['Adictos_ScreenRecord']:recordPlayerScreen(source, 10000)
]]

local activeRecordings = {}
local recordingCounter = 0

local function generateRecordingId()
    recordingCounter = recordingCounter + 1
    return 'rec_' .. GetGameTimer() .. '_' .. recordingCounter
end

-- Client finished uploading to Discord and sent us the URL --------------------

RegisterNetEvent('Adictos_ScreenRecord:UploadComplete')
AddEventHandler('Adictos_ScreenRecord:UploadComplete', function(recordingId, videoUrl, fileSize, duration)
    local src = source
    local recording = activeRecordings[recordingId]
    if not recording then return end

    if recording.src ~= src then
        print('[ScreenRecord] ^1ERROR^0: source mismatch on UploadComplete')
        return
    end

    if recording.completed then return end
    recording.completed = true

    local playerName = GetPlayerName(src) or 'Unknown'
    local success = videoUrl and videoUrl ~= ''

    if success then
        if Config.Debug then
            print('[ScreenRecord] ^2Upload complete^0 -- Player: ' .. playerName .. ' -- URL: ' .. tostring(videoUrl) .. ' -- Size: ' .. string.format('%.1f KB', (fileSize or 0) / 1024))
        end
    else
        print('[ScreenRecord] ^3WARN^0: upload finished but no URL returned for ' .. playerName)
    end

    if recording.callback then
        recording.callback(success, success and videoUrl or 'Upload completed without URL')
    end

    activeRecordings[recordingId] = nil
end)

-- Client reported an error ----------------------------------------------------

RegisterNetEvent('Adictos_ScreenRecord:VideoError')
AddEventHandler('Adictos_ScreenRecord:VideoError', function(recordingId, errorMsg)
    local src = source
    local recording = activeRecordings[recordingId]
    if not recording then return end
    if recording.src ~= src then return end
    if recording.completed then return end
    recording.completed = true

    print('[ScreenRecord] ^1Client error^0 -- ID: ' .. tostring(recordingId) .. ' -- ' .. tostring(errorMsg))

    if recording.callback then
        recording.callback(false, errorMsg)
    end

    activeRecordings[recordingId] = nil
end)

-- Main export: recordPlayerScreen ---------------------------------------------
--   src      (number)   - server ID of the player to record
--   duration (number)   - length in ms (clamped to Config.MaxDuration)
--   callback (function) - function(success, urlOrError) (optional)
--   reason   (string)   - shown in the Discord embed (optional)

local function recordPlayerScreen(src, duration, callback, reason)
    if not src or src <= 0 then
        if callback then callback(false, 'Invalid source') end
        return
    end

    if not GetPlayerName(src) then
        if callback then callback(false, 'Player not found') end
        return
    end

    for _, rec in pairs(activeRecordings) do
        if rec.src == src then
            if callback then callback(false, 'Player is already being recorded') end
            return
        end
    end

    duration = duration or Config.DefaultDuration
    if duration > Config.MaxDuration then duration = Config.MaxDuration end
    if duration < 1000 then duration = 1000 end

    local recordingId = generateRecordingId()
    local playerName = GetPlayerName(src) or 'Unknown'

    activeRecordings[recordingId] = {
        src = src,
        callback = callback,
        reason = reason or 'Anticheat',
        startTime = GetGameTimer(),
        duration = duration,
        completed = false,
    }

    local uploadInfo = {
        webhook        = Config.DiscordWebhook,
        webhookUsername = Config.WebhookUsername,
        webhookAvatar  = (Config.WebhookAvatar and Config.WebhookAvatar ~= '') and Config.WebhookAvatar or nil,
        embedColor     = Config.EmbedColor,
        playerName     = playerName,
        playerId       = src,
        reason         = reason or 'Anticheat',
    }

    TriggerClientEvent('Adictos_ScreenRecord:StartRecording', src, recordingId, duration, uploadInfo)

    if Config.Debug then
        print('[ScreenRecord] recordPlayerScreen() -- Player: ' .. playerName .. ' (ID: ' .. src .. ') -- Duration: ' .. duration .. 'ms -- RecordingID: ' .. recordingId)
    end

    -- Safety timeout: recording duration + 60s upload margin
    local timeoutMs = duration + 60000
    SetTimeout(timeoutMs, function()
        local rec = activeRecordings[recordingId]
        if rec and not rec.completed then
            rec.completed = true
            print('[ScreenRecord] ^3TIMEOUT^0 -- Recording ' .. recordingId .. ' did not respond in ' .. tostring(timeoutMs / 1000) .. 's')
            if rec.callback then
                rec.callback(false, 'Timeout: no response from client')
            end
            activeRecordings[recordingId] = nil
        end
    end)

    return recordingId
end

exports('recordPlayerScreen', recordPlayerScreen)

-- Stop an active recording ----------------------------------------------------

local function stopPlayerRecording(src)
    for recordingId, rec in pairs(activeRecordings) do
        if rec.src == src then
            TriggerClientEvent('Adictos_ScreenRecord:StopRecording', src)
            if Config.Debug then
                print('[ScreenRecord] stopPlayerRecording() -- ID: ' .. recordingId)
            end
            return true
        end
    end
    return false
end

exports('stopPlayerRecording', stopPlayerRecording)

-- Check if a player is currently being recorded -------------------------------

local function isPlayerBeingRecorded(src)
    for _, rec in pairs(activeRecordings) do
        if rec.src == src then return true end
    end
    return false
end

exports('isPlayerBeingRecorded', isPlayerBeingRecorded)

-- Cleanup on player disconnect ------------------------------------------------

AddEventHandler('playerDropped', function(reason)
    local src = source
    for recordingId, rec in pairs(activeRecordings) do
        if rec.src == src then
            print('[ScreenRecord] ^3Player disconnected^0 during recording -- ID: ' .. recordingId)
            if rec.callback then
                rec.callback(false, 'Player disconnected: ' .. tostring(reason))
            end
            activeRecordings[recordingId] = nil
        end
    end
end)

-- Console command: record <id> [seconds] [reason] -----------------------------

RegisterCommand('record', function(source, args, rawCommand)
    if source ~= 0 then
        TriggerClientEvent('chat:addMessage', source, { args = { '^1[ScreenRecord]', 'This command can only be used from the server console.' } })
        return
    end

    local targetId = tonumber(args[1])
    local durationSec = tonumber(args[2]) or 10
    local duration = durationSec * 1000

    if not targetId then
        print('[ScreenRecord] ^3Usage:^0 record <player_id> [duration_sec] [reason]')
        print('[ScreenRecord] ^3Example:^0 record 5 20 Suspicious activity')
        print('[ScreenRecord] ^3Default duration:^0 10s | ^3Max:^0 ' .. (Config.MaxDuration / 1000) .. 's')
        return
    end

    if not GetPlayerName(targetId) then
        print('[ScreenRecord] ^1ERROR^0: Player ID ' .. targetId .. ' not found')
        return
    end

    local reason = 'Manual recording (console)'
    if args[3] then
        local parts = {}
        for i = 3, #args do
            table.insert(parts, args[i])
        end
        reason = table.concat(parts, ' ')
    end

    if duration > Config.MaxDuration then
        print('[ScreenRecord] ^3NOTE^0: Duration clamped to maximum (' .. (Config.MaxDuration / 1000) .. 's)')
        duration = Config.MaxDuration
    end

    print('[ScreenRecord] ^2Recording^0 ^5' .. GetPlayerName(targetId) .. '^0 (ID: ' .. targetId .. ') -- ' .. (duration / 1000) .. 's -- Reason: ' .. reason)

    recordPlayerScreen(targetId, duration, function(success, urlOrError)
        if success then
            print('[ScreenRecord] ^2OK^0 -- Video of ^5' .. (GetPlayerName(targetId) or targetId) .. '^0 uploaded: ' .. tostring(urlOrError))
        else
            print('[ScreenRecord] ^1FAIL^0 -- ' .. tostring(urlOrError))
        end
    end, reason)
end, true)

print('[ScreenRecord] ^2Resource loaded^0 -- Direct NUI-to-Discord upload')
print('[ScreenRecord] ^3Console command:^0 record <id> [duration_sec] [reason]')
