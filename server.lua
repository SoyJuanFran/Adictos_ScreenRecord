-- ESX Integration
ESX = exports['es_extended']:getSharedObject()

local STAFF_GROUPS = { ['admin'] = true, ['superadmin'] = true }

local function isStaff(src)
    if src == 0 then return true end -- consola
    local xPlayer = ESX.GetPlayerFromId(src)
    return xPlayer and STAFF_GROUPS[xPlayer.getGroup()] or false
end

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

-- =============================================================================
--  SPECTATE — Live view system
-- =============================================================================

local activeSpectates = {} -- [adminSrc] = { target = targetSrc }

-- Client (target) sends a captured frame
RegisterNetEvent('Adictos_ScreenRecord:SpectateFrame')
AddEventHandler('Adictos_ScreenRecord:SpectateFrame', function(frameData)
    local targetSrc = source
    for adminSrc, spec in pairs(activeSpectates) do
        if spec.target == targetSrc then
            -- Use latent event for large payloads (~10-20 KB per frame)
            TriggerLatentClientEvent('Adictos_ScreenRecord:SpectateViewFrame', adminSrc, 256000, frameData)
        end
    end
end)

-- Client (target) reported an error
RegisterNetEvent('Adictos_ScreenRecord:SpectateError')
AddEventHandler('Adictos_ScreenRecord:SpectateError', function(errorMsg)
    local targetSrc = source
    for adminSrc, spec in pairs(activeSpectates) do
        if spec.target == targetSrc then
            TriggerClientEvent('Adictos_ScreenRecord:HideSpectateViewer', adminSrc)
            TriggerClientEvent('chat:addMessage', adminSrc, {
                args = { '^1[ScreenRecord]', 'Spectate error: ' .. tostring(errorMsg) }
            })
            activeSpectates[adminSrc] = nil
        end
    end
end)

--- Start spectating a player's screen
--- @param adminSrc number Server ID of the admin who will watch
--- @param targetSrc number Server ID of the player to watch
--- @return boolean success
local function spectatePlayer(adminSrc, targetSrc)
    if not adminSrc or adminSrc <= 0 then return false end
    if not targetSrc or targetSrc <= 0 then return false end
    if adminSrc == targetSrc then return false end
    if not GetPlayerName(targetSrc) then return false end
    if not GetPlayerName(adminSrc) then return false end

    -- Stop any existing spectate by this admin
    stopSpectating(adminSrc)

    activeSpectates[adminSrc] = { target = targetSrc }

    local targetName = GetPlayerName(targetSrc) or 'Unknown'
    local infoText = 'Viendo a: ' .. targetName .. ' (ID: ' .. targetSrc .. ')'

    -- Tell target to start capturing frames
    TriggerClientEvent('Adictos_ScreenRecord:StartSpectateCapture', targetSrc, {
        width   = Config.Spectate.Resolution.width,
        height  = Config.Spectate.Resolution.height,
        fps     = Config.Spectate.FPS,
        quality = Config.Spectate.Quality,
    })

    -- Tell admin to open the viewer
    TriggerClientEvent('Adictos_ScreenRecord:ShowSpectateViewer', adminSrc, infoText)

    if Config.Debug then
        print('[ScreenRecord] ^5Spectate^0 -- Admin: ' .. (GetPlayerName(adminSrc) or adminSrc) .. ' watching ' .. targetName .. ' (ID: ' .. targetSrc .. ')')
    end

    return true
end

--- Stop spectating
--- @param adminSrc number Server ID of the admin
function stopSpectating(adminSrc)
    local spec = activeSpectates[adminSrc]
    if not spec then return false end

    local targetSrc = spec.target
    activeSpectates[adminSrc] = nil

    -- Check if anyone else is still spectating this target
    local otherWatching = false
    for _, s in pairs(activeSpectates) do
        if s.target == targetSrc then otherWatching = true; break end
    end

    -- Only stop capture if no one else is watching
    if not otherWatching and GetPlayerName(targetSrc) then
        TriggerClientEvent('Adictos_ScreenRecord:StopSpectateCapture', targetSrc)
    end

    TriggerClientEvent('Adictos_ScreenRecord:HideSpectateViewer', adminSrc)

    if Config.Debug then
        print('[ScreenRecord] ^5Spectate stopped^0 -- Admin: ' .. (GetPlayerName(adminSrc) or adminSrc))
    end

    return true
end

exports('spectatePlayer', spectatePlayer)
exports('stopSpectating', stopSpectating)

-- Client requests to stop spectating (Escape/Delete key)
RegisterNetEvent('Adictos_ScreenRecord:RequestStopSpectate')
AddEventHandler('Adictos_ScreenRecord:RequestStopSpectate', function()
    local src = source
    if activeSpectates[src] then
        stopSpectating(src)
    end
end)

-- Clean up spectate on player disconnect
AddEventHandler('playerDropped', function(reason)
    local src = source

    -- If the admin disconnects, clean up their spectate
    if activeSpectates[src] then
        stopSpectating(src)
    end

    -- If the target disconnects, notify all admins watching them
    for adminSrc, spec in pairs(activeSpectates) do
        if spec.target == src then
            TriggerClientEvent('Adictos_ScreenRecord:HideSpectateViewer', adminSrc)
            TriggerClientEvent('chat:addMessage', adminSrc, {
                args = { '^3[ScreenRecord]', 'Player disconnected, spectate ended.' }
            })
            activeSpectates[adminSrc] = nil
        end
    end
end)

-- Console command: record <id> [seconds] [reason] -----------------------------

RegisterCommand('record', function(source, args, rawCommand)
    -- Permitir consola y staff ESX (admin/superadmin)
    if source ~= 0 and not isStaff(source) then
        TriggerClientEvent('chat:addMessage', source, { args = { '^1[ScreenRecord]', 'No tienes permisos para usar este comando.' } })
        return
    end

    local targetId = tonumber(args[1])
    local durationSec = tonumber(args[2]) or 10
    local duration = durationSec * 1000

    if not targetId then
        local usage = 'Uso: /record <player_id> [duracion_seg] [motivo]'
        if source == 0 then
            print('[ScreenRecord] ^3' .. usage .. '^0')
        else
            TriggerClientEvent('chat:addMessage', source, { args = { '^3[ScreenRecord]', usage } })
        end
        return
    end

    if not GetPlayerName(targetId) then
        local msg = 'Jugador ID ' .. targetId .. ' no encontrado'
        if source == 0 then
            print('[ScreenRecord] ^1ERROR^0: ' .. msg)
        else
            TriggerClientEvent('chat:addMessage', source, { args = { '^1[ScreenRecord]', msg } })
        end
        return
    end

    local reason = source == 0 and 'Manual recording (console)' or ('Manual recording (' .. (GetPlayerName(source) or source) .. ')')
    if args[3] then
        local parts = {}
        for i = 3, #args do
            table.insert(parts, args[i])
        end
        reason = table.concat(parts, ' ')
    end

    if duration > Config.MaxDuration then
        duration = Config.MaxDuration
    end

    local targetName = GetPlayerName(targetId)
    local msg = 'Grabando a ' .. targetName .. ' (ID: ' .. targetId .. ') — ' .. (duration / 1000) .. 's'
    if source == 0 then
        print('[ScreenRecord] ^2' .. msg .. '^0')
    else
        TriggerClientEvent('chat:addMessage', source, { args = { '^2[ScreenRecord]', msg } })
    end

    recordPlayerScreen(targetId, duration, function(success, urlOrError)
        if success then
            local okMsg = 'Video de ' .. (GetPlayerName(targetId) or targetId) .. ' subido: ' .. tostring(urlOrError)
            if source == 0 then
                print('[ScreenRecord] ^2OK^0 -- ' .. okMsg)
            elseif GetPlayerName(source) then
                TriggerClientEvent('chat:addMessage', source, { args = { '^2[ScreenRecord]', okMsg } })
            end
        else
            local errMsg = 'Error: ' .. tostring(urlOrError)
            if source == 0 then
                print('[ScreenRecord] ^1FAIL^0 -- ' .. errMsg)
            elseif GetPlayerName(source) then
                TriggerClientEvent('chat:addMessage', source, { args = { '^1[ScreenRecord]', errMsg } })
            end
        end
    end, reason)
end, false)

-- Console/admin command: spectate <admin_id> <target_id> ----------------------

RegisterCommand('spectate', function(src, args, rawCommand)
    local adminId  = tonumber(args[1])
    local targetId = tonumber(args[2])

    -- From console
    if src == 0 then
        if not adminId or not targetId then
            print('[ScreenRecord] ^3Usage:^0 spectate <admin_id> <target_id>')
            print('[ScreenRecord] ^3Stop:^0  spectate <admin_id> stop')
            return
        end

        if args[2] == 'stop' then
            if stopSpectating(adminId) then
                print('[ScreenRecord] ^2Spectate stopped^0 for admin ID ' .. adminId)
            else
                print('[ScreenRecord] ^3Admin is not spectating anyone^0')
            end
            return
        end

        if not GetPlayerName(adminId) then
            print('[ScreenRecord] ^1ERROR^0: Admin ID ' .. adminId .. ' not found')
            return
        end
        if not GetPlayerName(targetId) then
            print('[ScreenRecord] ^1ERROR^0: Target ID ' .. targetId .. ' not found')
            return
        end

        if spectatePlayer(adminId, targetId) then
            print('[ScreenRecord] ^2Spectate started^0 -- Admin: ' .. GetPlayerName(adminId) .. ' -> Target: ' .. GetPlayerName(targetId))
        else
            print('[ScreenRecord] ^1Failed to start spectate^0')
        end
        return
    end

    -- From in-game: verificar permisos ESX (admin/superadmin)
    if not isStaff(src) then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1[ScreenRecord]', 'No tienes permisos para usar este comando.' }
        })
        return
    end

    -- Check 'stop' ANTES de tonumber (tonumber('stop') = nil)
    if args[1] == 'stop' then
        if stopSpectating(src) then
            TriggerClientEvent('chat:addMessage', src, {
                args = { '^2[ScreenRecord]', 'Spectate detenido.' }
            })
        else
            TriggerClientEvent('chat:addMessage', src, {
                args = { '^3[ScreenRecord]', 'No estás especteando a nadie.' }
            })
        end
        return
    end

    targetId = tonumber(args[1])
    adminId = src

    if not targetId then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^3[ScreenRecord]', 'Uso: /spectate <player_id>  |  /spectate stop' }
        })
        return
    end

    if not GetPlayerName(targetId) then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1[ScreenRecord]', 'Jugador ID ' .. targetId .. ' no encontrado.' }
        })
        return
    end

    if spectatePlayer(src, targetId) then
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^2[ScreenRecord]', 'Spectate iniciado — Viendo a: ' .. GetPlayerName(targetId) }
        })
    else
        TriggerClientEvent('chat:addMessage', src, {
            args = { '^1[ScreenRecord]', 'No se pudo iniciar el spectate.' }
        })
    end
end, false) -- permisos via ESX groups

if Config.Debug then
    print('[ScreenRecord] ^2Resource loaded^0 -- Direct NUI-to-Discord upload')
    print('[ScreenRecord] ^3Console commands:^0 record <id> [duration] [reason] | spectate <admin_id> <target_id>')
end
