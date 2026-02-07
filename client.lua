--[[
    client.lua
    Receives recording orders from the server and drives the NUI WebGL recorder.
    The NUI uploads the video directly to Discord; only the resulting URL is
    sent back through FiveM net events (keeps payload minimal).
]]

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

-- Cleanup on resource stop ----------------------------------------------------

AddEventHandler('onResourceStop', function(resourceName)
    if resourceName ~= GetCurrentResourceName() then return end
    if isRecording then
        SendNUIMessage({ action = 'CLEANUP' })
        isRecording = false
        currentRecordingId = nil
    end
end)
