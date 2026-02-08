;(function () {
    'use strict';

    var TAG = '[AdictosRecorder]';

    var settings = {
        width: 1280,
        height: 720,
        fps: 24,
        maxDuration: 30000,
    };

    var QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    var QUAD_UVS   = new Float32Array([ 0,  0, 1,  0,  0, 1, 1, 1]);

    var VS_SOURCE =
        'attribute vec2 aPos;' +
        'attribute vec2 aUV;' +
        'varying vec2 vUV;' +
        'void main(){' +
        '  gl_Position=vec4(aPos,0.0,1.0);' +
        '  vUV=aUV;' +
        '}';

    var FS_SOURCE =
        'varying mediump vec2 vUV;' +
        'uniform sampler2D uTex;' +
        'void main(){' +
        '  gl_FragColor=texture2D(uTex,vUV);' +
        '}';

    function compileShader(gl, kind, source) {
        var s = gl.createShader(kind);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error(TAG, 'Shader compile:', gl.getShaderInfoLog(s));
        }
        return s;
    }

    function buildPipeline(gl) {
        var vs = compileShader(gl, gl.VERTEX_SHADER, VS_SOURCE);
        var fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SOURCE);

        var prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            console.error(TAG, 'Program link:', gl.getProgramInfoLog(prog));
        }

        var aPos = gl.getAttribLocation(prog, 'aPos');
        var aUV  = gl.getAttribLocation(prog, 'aUV');

        var posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);

        var uvBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
        gl.bufferData(gl.ARRAY_BUFFER, QUAD_UVS, gl.STATIC_DRAW);

        return { prog: prog, aPos: aPos, aUV: aUV, posBuf: posBuf, uvBuf: uvBuf };
    }

    function hookGameTexture(gl) {
        var tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0,
            gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([0, 0, 0, 255])
        );
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);

        // FiveM NUI texture-hook handshake:
        // specific WRAP_T param sequence tells the runtime to bind the game
        // render output into this texture object
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return tex;
    }

    function initCapture(canvas) {
        var gl = canvas.getContext('webgl', {
            antialias: false,
            depth: false,
            stencil: false,
            alpha: false,
            preserveDrawingBuffer: true,
            failIfMajorPerformanceCaveat: false,
        });
        if (!gl) return null;

        var pipe = buildPipeline(gl);
        var tex  = hookGameTexture(gl);

        gl.useProgram(pipe.prog);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.uniform1i(gl.getUniformLocation(pipe.prog, 'uTex'), 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, pipe.posBuf);
        gl.vertexAttribPointer(pipe.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(pipe.aPos);

        gl.bindBuffer(gl.ARRAY_BUFFER, pipe.uvBuf);
        gl.vertexAttribPointer(pipe.aUV, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(pipe.aUV);

        gl.viewport(0, 0, canvas.width, canvas.height);

        var interval = 1000 / settings.fps;
        var tickHandle = null;

        function draw() {
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            tickHandle = setTimeout(draw, interval);
        }

        draw();

        return {
            destroy: function () {
                if (tickHandle !== null) {
                    clearTimeout(tickHandle);
                    tickHandle = null;
                }
            },
        };
    }

    function pickMimeType() {
        var candidates = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm',
        ];
        for (var i = 0; i < candidates.length; i++) {
            if (MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
        }
        return 'video/webm';
    }

    function buildFilename(playerId) {
        var now = new Date();
        var stamp = now.getFullYear().toString()
            + pad2(now.getMonth() + 1) + pad2(now.getDate())
            + '_' + pad2(now.getHours()) + pad2(now.getMinutes()) + pad2(now.getSeconds());
        return 'ev_' + (playerId || 'x') + '_' + stamp + '.webm';
    }

    function pad2(n) { return n < 10 ? '0' + n : '' + n; }

    function sendDiscordWebhook(blob, info) {
        var wh = info.webhook;
        if (!wh) return Promise.reject(new Error('Webhook URL missing'));

        var payload = {
            username: info.webhookUsername || 'Adictos Recorder',
            embeds: [{
                title: 'Evidencia de grabación',
                color: info.embedColor || 0xFF0000,
                fields: [
                    { name: 'Jugador', value: (info.playerName || 'Desconocido') + ' (ID: ' + (info.playerId || '?') + ')', inline: true },
                    { name: 'Duración', value: Math.round((info.duration || 0) / 1000) + 's', inline: true },
                    { name: 'Tamaño', value: (blob.size / 1024).toFixed(1) + ' KB', inline: true },
                    { name: 'Motivo', value: info.reason || 'Anticheat', inline: false },
                ],
                footer: { text: 'Adictos ScreenRecord' },
                timestamp: new Date().toISOString(),
            }],
        };

        if (info.webhookAvatar) payload.avatar_url = info.webhookAvatar;

        var fd = new FormData();
        fd.append('payload_json', JSON.stringify(payload));
        fd.append('files[0]', blob, buildFilename(info.playerId));

        return fetch(wh, { method: 'POST', body: fd }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (t) {
                    throw new Error('Discord ' + res.status + ': ' + t);
                });
            }
            return res.json();
        }).then(function (json) {
            if (json.attachments && json.attachments.length > 0) {
                return json.attachments[0].url || json.attachments[0].proxy_url || null;
            }
            return null;
        });
    }

    var capture     = null;
    var recorder    = null;
    var stopTimer   = null;
    var recId       = null;
    var recInfo     = null;

    function teardownCapture() {
        if (capture) { capture.destroy(); capture = null; }
    }

    function resetAll() {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        if (recorder && recorder.state === 'recording') {
            try { recorder.stop(); } catch (_) {}
        }
        recorder = null;
        teardownCapture();
        recId   = null;
        recInfo = null;
    }

    function beginRecording(id, duration, uploadInfo) {
        resetAll();

        var canvas = document.getElementById('gameCanvas');
        canvas.width  = settings.width;
        canvas.height = settings.height;

        capture = initCapture(canvas);
        if (!capture) {
            notifyLua('recordingError', { recordingId: id, error: 'WebGL context unavailable' });
            return;
        }

        recId   = id;
        recInfo = uploadInfo || {};

        var stream    = canvas.captureStream(settings.fps);
        var mime      = pickMimeType();
        var chunks    = [];
        var t0        = Date.now();

        recorder = new MediaRecorder(stream, { mimeType: mime });

        recorder.ondataavailable = function (ev) {
            if (ev.data && ev.data.size > 0) chunks.push(ev.data);
        };

        recorder.onstop = function () {
            var elapsed = Date.now() - t0;
            var raw = new Blob(chunks, { type: 'video/webm' });

            processAndUpload(raw, elapsed);
        };

        recorder.onerror = function (ev) {
            console.error(TAG, 'MediaRecorder error', ev);
            notifyLua('recordingError', { recordingId: recId, error: 'Recorder error' });
            resetAll();
        };

        recorder.start(1000);
        console.log(TAG, 'Recording started — id=' + id + '  dur=' + duration + 'ms');

        var safeDur = Math.min(duration || settings.maxDuration, settings.maxDuration);
        stopTimer = setTimeout(endRecording, safeDur);

        notifyLua('recordingStarted', { recordingId: id });
    }

    function processAndUpload(raw, elapsed) {
        var savedId   = recId;
        var savedInfo = recInfo;

        var fixPromise;
        if (typeof ysFixWebmDuration === 'function' && raw.size > 0) {
            try {
                fixPromise = ysFixWebmDuration(raw, elapsed, { logger: false });
            } catch (_) {
                fixPromise = Promise.resolve(raw);
            }
        } else {
            fixPromise = Promise.resolve(raw);
        }

        fixPromise.then(function (blob) {
            if (!blob || blob.size === 0) {
                notifyLua('recordingError', { recordingId: savedId, error: 'Empty video' });
                teardownCapture();
                return;
            }

            var MAX_SIZE = 24 * 1024 * 1024;
            if (blob.size > MAX_SIZE) {
                notifyLua('recordingError', {
                    recordingId: savedId,
                    error: 'File too large: ' + (blob.size / 1048576).toFixed(1) + ' MB',
                });
                teardownCapture();
                return;
            }

            var merged = {};
            for (var k in savedInfo) merged[k] = savedInfo[k];
            merged.duration = elapsed;

            console.log(TAG, 'Uploading — ' + (blob.size / 1024).toFixed(1) + ' KB');

            sendDiscordWebhook(blob, merged).then(function (url) {
                console.log(TAG, 'Upload OK — url=' + (url || '(none)'));
                notifyLua('uploadComplete', {
                    recordingId: savedId,
                    videoUrl: url || '',
                    fileSize: blob.size,
                    duration: elapsed,
                });
            }).catch(function (err) {
                console.error(TAG, 'Upload failed:', err);
                notifyLua('recordingError', {
                    recordingId: savedId,
                    error: 'Upload failed: ' + (err.message || err),
                });
            }).then(function () {
                teardownCapture();
            });
        });
    }

    function endRecording() {
        if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
        if (recorder && recorder.state === 'recording') {
            recorder.stop();
            console.log(TAG, 'Recording stopped — id=' + recId);
        }
    }

    // =========================================================================
    //  SPECTATE — live frame streaming to an admin
    // =========================================================================

    var spectateCapture   = null;
    var spectateInterval  = null;
    var spectateCanvas    = null;
    var spectateSending   = false;

    var spectateSettings = {
        width:   640,
        height:  360,
        fps:     3,
        quality: 0.35,
    };

    function startSpectateCapture(opts) {
        stopSpectateCapture();

        if (opts.width)   spectateSettings.width   = opts.width;
        if (opts.height)  spectateSettings.height  = opts.height;
        if (opts.fps)     spectateSettings.fps     = opts.fps;
        if (opts.quality) spectateSettings.quality  = opts.quality;

        spectateCanvas = document.getElementById('gameCanvas');
        spectateCanvas.width  = spectateSettings.width;
        spectateCanvas.height = spectateSettings.height;

        spectateCapture = initCapture(spectateCanvas);
        if (!spectateCapture) {
            console.error(TAG, 'Spectate: WebGL context failed');
            notifyLua('spectateError', { error: 'WebGL context unavailable' });
            return;
        }

        console.log(TAG, 'Spectate capture started — ' +
            spectateSettings.width + 'x' + spectateSettings.height +
            ' @' + spectateSettings.fps + 'fps q=' + spectateSettings.quality);

        var frameDelay = 1000 / spectateSettings.fps;

        spectateInterval = setInterval(function () {
            if (spectateSending) return;
            spectateSending = true;

            try {
                var dataUrl = spectateCanvas.toDataURL('image/jpeg', spectateSettings.quality);
                notifyLua('spectateFrame', { frame: dataUrl });
            } catch (err) {
                console.error(TAG, 'Spectate frame error:', err);
            }
            spectateSending = false;
        }, frameDelay);

        notifyLua('spectateStarted', {});
    }

    function stopSpectateCapture() {
        if (spectateInterval) {
            clearInterval(spectateInterval);
            spectateInterval = null;
        }
        if (spectateCapture) {
            spectateCapture.destroy();
            spectateCapture = null;
        }
        spectateCanvas = null;
        spectateSending = false;
    }

    // =========================================================================
    //  SPECTATE VIEWER — admin side: display received frames
    // =========================================================================

    var viewerVisible = false;

    function showViewer() {
        var overlay = document.getElementById('spectateOverlay');
        var img     = document.getElementById('spectateView');
        if (!overlay || !img) return;
        overlay.style.display = 'flex';
        viewerVisible = true;
    }

    function hideViewer() {
        var overlay = document.getElementById('spectateOverlay');
        if (overlay) overlay.style.display = 'none';
        viewerVisible = false;
    }

    function displayFrame(dataUrl) {
        var img = document.getElementById('spectateView');
        if (img && viewerVisible) img.src = dataUrl;
    }

    function updateViewerInfo(text) {
        var el = document.getElementById('spectateInfo');
        if (el) el.textContent = text;
    }

    // =========================================================================
    //  NUI <-> Lua communication
    // =========================================================================

    var RESOURCE = (typeof GetParentResourceName === 'function')
        ? GetParentResourceName()
        : 'Adictos_ScreenRecord';

    function notifyLua(action, payload) {
        fetch('https://' + RESOURCE + '/' + action, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {}),
        }).catch(function (e) {
            console.error(TAG, 'NUI callback error:', e);
        });
    }

    window.addEventListener('message', function (ev) {
        var msg = ev.data;
        if (!msg || !msg.action) return;

        switch (msg.action) {
            // --- Recording ---
            case 'START_RECORDING':
                if (msg.width)       settings.width       = msg.width;
                if (msg.height)      settings.height      = msg.height;
                if (msg.fps)         settings.fps         = msg.fps;
                if (msg.maxDuration) settings.maxDuration  = msg.maxDuration;
                beginRecording(msg.recordingId, msg.duration, msg.uploadInfo);
                break;
            case 'STOP_RECORDING':
                endRecording();
                break;
            case 'CLEANUP':
                resetAll();
                stopSpectateCapture();
                hideViewer();
                break;

            // --- Spectate: target side (capture frames) ---
            case 'START_SPECTATE_CAPTURE':
                startSpectateCapture(msg);
                break;
            case 'STOP_SPECTATE_CAPTURE':
                stopSpectateCapture();
                break;

            // --- Spectate: viewer side (admin watching) ---
            case 'SHOW_SPECTATE_VIEWER':
                updateViewerInfo(msg.info || '');
                showViewer();
                break;
            case 'HIDE_SPECTATE_VIEWER':
                hideViewer();
                break;
            case 'SPECTATE_FRAME':
                displayFrame(msg.frame);
                break;
        }
    });

})();
