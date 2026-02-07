/*
 * recorder.js
 * WebGL game-frame capture + MediaRecorder + direct Discord upload.
 *
 * The video is uploaded straight to a Discord webhook from the CEF browser
 * using fetch + FormData.  Only the attachment URL is sent back to Lua,
 * which keeps FiveM network events well under the size limit.
 *
 * WebGL texture-hook technique from cfx-game-capture (MIT).
 */

// -- Config (overridden by client.lua via NUI message) ------------------------

let captureConfig = {
    width: 1280,
    height: 720,
    fps: 24,
    maxDuration: 30000,
};

// -- WebGL shaders ------------------------------------------------------------

const vertexShaderSrc = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 textureCoordinate;
    void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        textureCoordinate = a_texcoord;
    }
`;

const fragmentShaderSrc = `
    varying mediump vec2 textureCoordinate;
    uniform sampler2D external_texture;
    void main() {
        gl_FragColor = texture2D(external_texture, textureCoordinate);
    }
`;

function makeShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    const infoLog = gl.getShaderInfoLog(shader);
    if (infoLog) console.error('[ScreenRecord] Shader error:', infoLog);
    return shader;
}

function createTexture(gl) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 255, 255]));

    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

    // Texture-hook sequence required to capture the FiveM render output
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    return tex;
}

function createBuffers(gl) {
    const vertexBuff = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const texBuff = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

    return { vertexBuff, texBuff };
}

function createProgram(gl) {
    const vertexShader = makeShader(gl, gl.VERTEX_SHADER, vertexShaderSrc);
    const fragmentShader = makeShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSrc);
    const program = gl.createProgram();

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.useProgram(program);

    const vloc = gl.getAttribLocation(program, 'a_position');
    const tloc = gl.getAttribLocation(program, 'a_texcoord');

    return { program, vloc, tloc };
}

// -- Game view (WebGL context + render loop) ----------------------------------

function createGameView(canvas) {
    const gl = canvas.getContext('webgl', {
        antialias: false,
        depth: false,
        stencil: false,
        alpha: false,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
    });

    if (!gl) {
        console.error('[ScreenRecord] Failed to create WebGL context');
        return null;
    }

    let renderTimeout = null;
    const frameInterval = 1000 / captureConfig.fps;

    const tex = createTexture(gl);
    const { program, vloc, tloc } = createProgram(gl);
    const { vertexBuff, texBuff } = createBuffers(gl);

    gl.useProgram(program);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(gl.getUniformLocation(program, 'external_texture'), 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuff);
    gl.vertexAttribPointer(vloc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(vloc);

    gl.bindBuffer(gl.ARRAY_BUFFER, texBuff);
    gl.vertexAttribPointer(tloc, 2, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(tloc);

    gl.viewport(0, 0, canvas.width, canvas.height);

    function render() {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        renderTimeout = setTimeout(render, frameInterval);
    }

    render();

    return {
        canvas,
        gl,
        stop: function () {
            if (renderTimeout) {
                clearTimeout(renderTimeout);
                renderTimeout = null;
            }
        },
    };
}

// -- Discord upload -----------------------------------------------------------

async function uploadToDiscord(blob, uploadInfo) {
    const webhook = uploadInfo.webhook;
    if (!webhook) throw new Error('No webhook URL provided');

    const filename = 'evidence_' + (uploadInfo.playerId || 'unknown') + '_' +
        new Date().toISOString().replace(/[:-]/g, '').replace('T', '_').split('.')[0] + '.webm';

    const embedPayload = {
        username: uploadInfo.webhookUsername || 'Screen Recorder',
        embeds: [{
            title: 'Recording Evidence',
            color: uploadInfo.embedColor || 16711680,
            fields: [
                { name: 'Player', value: (uploadInfo.playerName || 'Unknown') + ' (ID: ' + (uploadInfo.playerId || '?') + ')', inline: true },
                { name: 'Duration', value: Math.floor((uploadInfo.duration || 0) / 1000) + 's', inline: true },
                { name: 'Size', value: (blob.size / 1024).toFixed(1) + ' KB', inline: true },
                { name: 'Reason', value: uploadInfo.reason || 'Anticheat', inline: false },
            ],
            footer: { text: 'ScreenRecord' },
            timestamp: new Date().toISOString(),
        }],
    };

    if (uploadInfo.webhookAvatar) {
        embedPayload.avatar_url = uploadInfo.webhookAvatar;
    }

    const formData = new FormData();
    formData.append('payload_json', JSON.stringify(embedPayload));
    formData.append('files[0]', blob, filename);

    const response = await fetch(webhook, {
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error('Discord HTTP ' + response.status + ': ' + errorText);
    }

    const responseData = await response.json();
    let videoUrl = null;
    if (responseData.attachments && responseData.attachments[0]) {
        videoUrl = responseData.attachments[0].url || responseData.attachments[0].proxy_url;
    }

    return videoUrl;
}

// -- Recording state ----------------------------------------------------------

let mediaRecorder = null;
let currentGameView = null;
let autoStopTimer = null;
let currentRecordingId = null;
let currentUploadInfo = null;

function startRecording(recordingId, duration, uploadInfo) {
    cleanupRecording();

    const canvas = document.getElementById('gameCanvas');
    canvas.width = captureConfig.width;
    canvas.height = captureConfig.height;

    currentGameView = createGameView(canvas);
    if (!currentGameView) {
        sendToLua('recordingError', { recordingId: recordingId, error: 'Failed to create WebGL context' });
        return;
    }

    currentRecordingId = recordingId;
    currentUploadInfo = uploadInfo || {};

    const videoStream = canvas.captureStream(captureConfig.fps);
    const startTime = Date.now();
    const videoChunks = [];

    // Prefer VP9, fall back to VP8, then generic webm
    let mimeType = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm;codecs=vp8';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm';
        }
    }

    mediaRecorder = new MediaRecorder(videoStream, { mimeType: mimeType });

    mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) videoChunks.push(e.data);
    };

    mediaRecorder.onstop = async function () {
        const videoDuration = Date.now() - startTime;
        const rawBlob = new Blob(videoChunks, { type: 'video/webm' });

        // Fix webm duration metadata (known MediaRecorder bug)
        let finalBlob = rawBlob;
        if (typeof ysFixWebmDuration === 'function' && rawBlob.size > 0) {
            try {
                finalBlob = await ysFixWebmDuration(rawBlob, videoDuration, { logger: false });
            } catch (e) {
                console.warn('[ScreenRecord] fix-webm-duration failed, using raw blob:', e);
            }
        }

        if (!finalBlob || finalBlob.size === 0) {
            sendToLua('recordingError', { recordingId: currentRecordingId, error: 'Recorded video is empty' });
            cleanupGameView();
            return;
        }

        // Discord file size limit (25 MB, leave 1 MB margin)
        if (finalBlob.size > 24 * 1024 * 1024) {
            sendToLua('recordingError', { recordingId: currentRecordingId, error: 'Video too large: ' + (finalBlob.size / 1024 / 1024).toFixed(1) + ' MB' });
            cleanupGameView();
            return;
        }

        const info = Object.assign({}, currentUploadInfo, { duration: videoDuration });

        try {
            console.log('[ScreenRecord] Uploading to Discord -- ' + (finalBlob.size / 1024).toFixed(1) + ' KB');
            const videoUrl = await uploadToDiscord(finalBlob, info);
            console.log('[ScreenRecord] Upload complete -- URL:', videoUrl);

            sendToLua('uploadComplete', {
                recordingId: currentRecordingId,
                videoUrl: videoUrl || '',
                fileSize: finalBlob.size,
                duration: videoDuration,
            });
        } catch (err) {
            console.error('[ScreenRecord] Discord upload error:', err);
            sendToLua('recordingError', {
                recordingId: currentRecordingId,
                error: 'Discord upload failed: ' + (err.message || err),
            });
        }

        cleanupGameView();
    };

    mediaRecorder.onerror = function (e) {
        console.error('[ScreenRecord] MediaRecorder error:', e);
        sendToLua('recordingError', { recordingId: currentRecordingId, error: 'MediaRecorder error: ' + (e.error || 'unknown') });
        cleanupRecording();
    };

    mediaRecorder.start(1000);
    console.log('[ScreenRecord] Recording started -- ID:', recordingId, '-- Duration:', duration, 'ms');

    const safeDuration = Math.min(duration || captureConfig.maxDuration, captureConfig.maxDuration);
    autoStopTimer = setTimeout(function () {
        stopRecording();
    }, safeDuration);

    sendToLua('recordingStarted', { recordingId: recordingId });
}

function stopRecording() {
    if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        console.log('[ScreenRecord] Recording stopped -- ID:', currentRecordingId);
    }
}

function cleanupGameView() {
    if (currentGameView) {
        currentGameView.stop();
        currentGameView = null;
    }
}

function cleanupRecording() {
    if (autoStopTimer) {
        clearTimeout(autoStopTimer);
        autoStopTimer = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        try { mediaRecorder.stop(); } catch (e) { /* ignore */ }
    }
    mediaRecorder = null;
    cleanupGameView();
    currentRecordingId = null;
    currentUploadInfo = null;
}

// -- NUI <-> Lua communication ------------------------------------------------

const RESOURCE_NAME = window.GetParentResourceName ? window.GetParentResourceName() : 'Adictos_ScreenRecord';

function sendToLua(action, data) {
    fetch('https://' + RESOURCE_NAME + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
    }).catch(function (err) {
        console.error('[ScreenRecord] Error sending to Lua:', err);
    });
}

window.addEventListener('message', function (event) {
    const data = event.data;
    if (!data || !data.action) return;

    switch (data.action) {
        case 'START_RECORDING':
            captureConfig.width = data.width || captureConfig.width;
            captureConfig.height = data.height || captureConfig.height;
            captureConfig.fps = data.fps || captureConfig.fps;
            captureConfig.maxDuration = data.maxDuration || captureConfig.maxDuration;
            startRecording(data.recordingId, data.duration, data.uploadInfo);
            break;

        case 'STOP_RECORDING':
            stopRecording();
            break;

        case 'CLEANUP':
            cleanupRecording();
            break;
    }
});
