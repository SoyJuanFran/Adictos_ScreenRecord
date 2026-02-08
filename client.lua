local isRecording = false
local currentRecordingId = nil

-- NUI Callbacks ---------------------------------------------------------------

RegisterNUICallback('recordingStarted', function(data, cb)
    if Config.Debug then
        print('[ScreenRecord] Recording started -- ID: ' .. tostring(data.recordingId))
    end
    cb('ok')
end)

RegisterNUICallback('uploadComplete', function(data, cb)
    if Config.Debug then
        print('[ScreenRecord] Upload complete -- ID: ' .. tostring(data.recordingId) .. ' -- URL: ' .. tostring(data.videoUrl))
    end

    isRecording = false
    currentRecordingId = nil

    TriggerServerEvent('Adictos_ScreenRecord:UploadComplete', data.recordingId, data.videoUrl or '', data.fileSize or 0, data.duration or 0)
    cb('ok')
end)

RegisterNUICallback('recordingError', function(data, cb)
    print('[ScreenRecord] ^1ERROR^0 -- ID: ' .. tostring(data.recordingId) .. ' -- ' .. tostring(data.error))
    isRecording = false
    currentRecordingId = nil
    TriggerServerEvent('Adictos_ScreenRecord:VideoError', data.recordingId, data.error or 'Unknown error')
    cb('ok')
end)

-- Server events ---------------------------------------------------------------

RegisterNetEvent('Adictos_ScreenRecord:StartRecording')
AddEventHandler('Adictos_ScreenRecord:StartRecording', function(recordingId, duration, uploadInfo)
    if isRecording then
        if Config.Debug then
            print('[ScreenRecord] Already recording, ignoring request')
        end
        TriggerServerEvent('Adictos_ScreenRecord:VideoError', recordingId, 'Already recording')
        return
    end

    isRecording = true
    currentRecordingId = recordingId

    SendNUIMessage({
        action       = 'START_RECORDING',
        recordingId  = recordingId,
        duration     = duration or Config.DefaultDuration,
        width        = Config.Resolution.width,
        height       = Config.Resolution.height,
        fps          = Config.FPS,
        maxDuration  = Config.MaxDuration,
        uploadInfo   = uploadInfo,
    })

    if Config.Debug then
        print('[ScreenRecord] START_RECORDING sent to NUI -- ID: ' .. tostring(recordingId) .. ' -- Duration: ' .. tostring(duration) .. 'ms')
    end
end)

RegisterNetEvent('Adictos_ScreenRecord:StopRecording')
AddEventHandler('Adictos_ScreenRecord:StopRecording', function()
    if not isRecording then return end
    SendNUIMessage({ action = 'STOP_RECORDING' })
    if Config.Debug then
        print('[ScreenRecord] STOP_RECORDING sent to NUI')
    end
end)

-- =============================================================================
--  SPECTATE — Live view system
-- =============================================================================

local isBeingSpectated = false
local isSpectating = false -- true cuando SOMOS el admin viendo a alguien

-- NUI sends us each captured frame (JPEG data URL)
RegisterNUICallback('spectateFrame', function(data, cb)
    if isBeingSpectated and data.frame then
        TriggerServerEvent('Adictos_ScreenRecord:SpectateFrame', data.frame)
    end
    cb('ok')
end)

RegisterNUICallback('spectateStarted', function(data, cb)
    if Config.Debug then
        print('[ScreenRecord] Spectate capture started on this client')
    end
    cb('ok')
end)

RegisterNUICallback('spectateError', function(data, cb)
    print('[ScreenRecord] ^1Spectate ERROR^0: ' .. tostring(data.error))
    isBeingSpectated = false
    TriggerServerEvent('Adictos_ScreenRecord:SpectateError', data.error or 'Unknown')
    cb('ok')
end)

-- Server tells this client to start streaming frames
RegisterNetEvent('Adictos_ScreenRecord:StartSpectateCapture')
AddEventHandler('Adictos_ScreenRecord:StartSpectateCapture', function(opts)
    isBeingSpectated = true
    SendNUIMessage({
        action  = 'START_SPECTATE_CAPTURE',
        width   = (opts and opts.width)   or Config.Spectate.Resolution.width,
        height  = (opts and opts.height)  or Config.Spectate.Resolution.height,
        fps     = (opts and opts.fps)     or Config.Spectate.FPS,
        quality = (opts and opts.quality)  or Config.Spectate.Quality,
    })
    if Config.Debug then
        print('[ScreenRecord] START_SPECTATE_CAPTURE sent to NUI')
    end
end)

-- Server tells this client to stop streaming frames
RegisterNetEvent('Adictos_ScreenRecord:StopSpectateCapture')
AddEventHandler('Adictos_ScreenRecord:StopSpectateCapture', function()
    isBeingSpectated = false
    SendNUIMessage({ action = 'STOP_SPECTATE_CAPTURE' })
    if Config.Debug then
        print('[ScreenRecord] STOP_SPECTATE_CAPTURE sent to NUI')
    end
end)

-- Server sends us a frame to display (we are the viewer/admin)
RegisterNetEvent('Adictos_ScreenRecord:SpectateViewFrame')
AddEventHandler('Adictos_ScreenRecord:SpectateViewFrame', function(frameData)
    SendNUIMessage({
        action = 'SPECTATE_FRAME',
        frame  = frameData,
    })
end)

-- Server tells us to open the viewer overlay
RegisterNetEvent('Adictos_ScreenRecord:ShowSpectateViewer')
AddEventHandler('Adictos_ScreenRecord:ShowSpectateViewer', function(info)
    isSpectating = true
    SendNUIMessage({
        action = 'SHOW_SPECTATE_VIEWER',
        info   = info or '',
    })
    if Config.Debug then
        print('[ScreenRecord] Spectate viewer opened')
    end
end)

-- Server tells us to close the viewer overlay
RegisterNetEvent('Adictos_ScreenRecord:HideSpectateViewer')
AddEventHandler('Adictos_ScreenRecord:HideSpectateViewer', function()
    isSpectating = false
    SendNUIMessage({ action = 'HIDE_SPECTATE_VIEWER' })
    if Config.Debug then
        print('[ScreenRecord] Spectate viewer closed')
    end
end)

-- Cleanup on resource stop ----------------------------------------------------

-- Cerrar spectate con comando + keybind (DELETE por defecto)
RegisterCommand('stopspectate', function()
    if isSpectating then
        isSpectating = false
        SendNUIMessage({ action = 'HIDE_SPECTATE_VIEWER' })
        TriggerServerEvent('Adictos_ScreenRecord:RequestStopSpectate')
        if Config.Debug then
            print('[ScreenRecord] Spectate cerrado por tecla')
        end
    end
end, false)

RegisterKeyMapping('stopspectate', 'Cerrar Spectate', 'keyboard', 'DELETE')

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then return end
    if isRecording then
        SendNUIMessage({ action = 'CLEANUP' })
        isRecording = false
        currentRecordingId = nil
    end
    if isBeingSpectated then
        SendNUIMessage({ action = 'STOP_SPECTATE_CAPTURE' })
        isBeingSpectated = false
    end
    SendNUIMessage({ action = 'HIDE_SPECTATE_VIEWER' })
end)
