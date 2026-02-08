;(function (root) {
    'use strict';

    var SEGMENT_ID        = 0x18538067;
    var INFO_ID           = 0x1549A966;
    var TIMECODE_SCALE_ID = 0x2AD7B1;
    var DURATION_ID       = 0x4489;

    function decodeVarInt(bytes, pos) {
        if (pos >= bytes.length) return null;
        var first = bytes[pos];
        if (first === 0) return null;

        var width = 1;
        var mask = 0x80;
        while (width <= 8 && (first & mask) === 0) {
            width++;
            mask >>>= 1;
        }
        if (width > 8) return null;

        var val = first & (mask - 1);
        for (var i = 1; i < width; i++) {
            if (pos + i >= bytes.length) return null;
            val = val * 256 + bytes[pos + i];
        }
        return { value: val, length: width };
    }

    function encodeVarInt(value) {
        var width = 1;
        var limit = 0x80;
        while (value >= limit - 1 && width < 8) {
            width++;
            limit *= 0x80;
        }

        var out = new Uint8Array(width);
        var marker = 1 << (8 - width);
        for (var i = width - 1; i >= 0; i--) {
            out[i] = value & 0xff;
            value = Math.floor(value / 256);
        }
        out[0] |= marker;
        return out;
    }

    function readElementId(bytes, pos) {
        if (pos >= bytes.length) return null;
        var first = bytes[pos];
        if (first === 0) return null;

        var width = 1;
        var mask = 0x80;
        while (width <= 4 && (first & mask) === 0) {
            width++;
            mask >>>= 1;
        }
        if (width > 4) return null;

        var id = 0;
        for (var i = 0; i < width; i++) {
            if (pos + i >= bytes.length) return null;
            id = id * 256 + bytes[pos + i];
        }
        return { id: id, length: width };
    }

    function encodeElementId(id) {
        var bytes = [];
        var tmp = id;
        while (tmp > 0) {
            bytes.unshift(tmp & 0xff);
            tmp = Math.floor(tmp / 256);
        }
        return new Uint8Array(bytes);
    }

    function float64ToBytes(val) {
        var buf = new ArrayBuffer(8);
        new DataView(buf).setFloat64(0, val, false);
        return new Uint8Array(buf);
    }

    function encodeUint(val) {
        if (val === 0) return new Uint8Array([0]);
        var parts = [];
        var tmp = val;
        while (tmp > 0) {
            parts.unshift(tmp & 0xff);
            tmp = Math.floor(tmp / 256);
        }
        return new Uint8Array(parts);
    }

    function concatArrays(arrays) {
        var total = 0;
        for (var i = 0; i < arrays.length; i++) total += arrays[i].length;
        var result = new Uint8Array(total);
        var offset = 0;
        for (var j = 0; j < arrays.length; j++) {
            result.set(arrays[j], offset);
            offset += arrays[j].length;
        }
        return result;
    }

    function scanElement(bytes, pos) {
        var eid = readElementId(bytes, pos);
        if (!eid) return null;
        var sizeInfo = decodeVarInt(bytes, pos + eid.length);
        if (!sizeInfo) return null;
        var headerLen = eid.length + sizeInfo.length;
        return {
            id: eid.id,
            dataStart: pos + headerLen,
            dataLen: sizeInfo.value,
            headerLen: headerLen,
            totalLen: headerLen + sizeInfo.value,
        };
    }

    function rebuildInfoPayload(infoBody, durationMs) {
        var children = [];
        var cursor = 0;
        var hasTimecodeScale = false;

        while (cursor < infoBody.length) {
            var el = scanElement(infoBody, cursor);
            if (!el) break;

            if (el.id === DURATION_ID) {
                cursor += el.totalLen;
                continue;
            }

            if (el.id === TIMECODE_SCALE_ID) {
                hasTimecodeScale = true;
                var tsIdBytes = encodeElementId(TIMECODE_SCALE_ID);
                var tsValBytes = encodeUint(1000000);
                var tsSizeBytes = encodeVarInt(tsValBytes.length);
                children.push(concatArrays([tsIdBytes, tsSizeBytes, tsValBytes]));
                cursor += el.totalLen;
                continue;
            }

            children.push(infoBody.slice(cursor, cursor + el.totalLen));
            cursor += el.totalLen;
        }

        if (!hasTimecodeScale) {
            var tsIdBytes2 = encodeElementId(TIMECODE_SCALE_ID);
            var tsValBytes2 = encodeUint(1000000);
            var tsSizeBytes2 = encodeVarInt(tsValBytes2.length);
            children.push(concatArrays([tsIdBytes2, tsSizeBytes2, tsValBytes2]));
        }

        var durIdBytes = encodeElementId(DURATION_ID);
        var durValBytes = float64ToBytes(durationMs);
        var durSizeBytes = encodeVarInt(durValBytes.length);
        children.push(concatArrays([durIdBytes, durSizeBytes, durValBytes]));

        return concatArrays(children);
    }

    function patchDuration(raw, durationMs, logger) {
        if (!logger) logger = function () {};

        var ebmlHeader = scanElement(raw, 0);
        if (!ebmlHeader) { logger('No EBML header found'); return raw; }

        var segStart = ebmlHeader.totalLen;
        var segEl = scanElement(raw, segStart);
        if (!segEl || segEl.id !== SEGMENT_ID) {
            logger('Segment element not found at expected position');
            return raw;
        }

        var segBodyStart = segEl.dataStart;
        var segBodyEnd   = segEl.dataStart + segEl.dataLen;

        var infoPos = null;
        var infoEl  = null;
        var cursor  = segBodyStart;
        while (cursor < segBodyEnd) {
            var el = scanElement(raw, cursor);
            if (!el) break;
            if (el.id === INFO_ID) {
                infoPos = cursor;
                infoEl = el;
                break;
            }
            cursor += el.totalLen;
        }

        if (!infoEl) { logger('Info element not found inside Segment'); return raw; }

        var origInfoBody = raw.slice(infoEl.dataStart, infoEl.dataStart + infoEl.dataLen);
        var newInfoBody = rebuildInfoPayload(origInfoBody, durationMs);

        var infoIdBytes   = encodeElementId(INFO_ID);
        var infoSizeBytes = encodeVarInt(newInfoBody.length);
        var newInfoElement = concatArrays([infoIdBytes, infoSizeBytes, newInfoBody]);

        var beforeInfo = raw.slice(segBodyStart, infoPos);
        var afterInfo  = raw.slice(infoEl.dataStart + infoEl.dataLen, segBodyEnd);

        var newSegBody = concatArrays([beforeInfo, newInfoElement, afterInfo]);

        var segIdBytes   = encodeElementId(SEGMENT_ID);
        var segSizeBytes = encodeVarInt(newSegBody.length);
        var newSegElement = concatArrays([segIdBytes, segSizeBytes, newSegBody]);

        var ebmlPart   = raw.slice(0, ebmlHeader.totalLen);
        var trailing   = raw.slice(segStart + segEl.totalLen);
        var result     = concatArrays([ebmlPart, newSegElement, trailing]);

        logger('Duration patched to ' + durationMs + ' ms');
        return result;
    }

    function adictosFixDuration(blob, durationMs, callbackOrOpts, opts) {
        if (typeof callbackOrOpts === 'object' && typeof callbackOrOpts !== 'function') {
            opts = callbackOrOpts;
            callbackOrOpts = undefined;
        }

        var logFn = null;
        if (opts && opts.logger === false) {
            logFn = function () {};
        } else if (opts && typeof opts.logger === 'function') {
            logFn = opts.logger;
        } else {
            logFn = function (msg) { console.log('[WebmDurationPatch] ' + msg); };
        }

        function run(resolve) {
            var reader = new FileReader();
            reader.onloadend = function () {
                try {
                    var raw = new Uint8Array(reader.result);
                    var patched = patchDuration(raw, durationMs, logFn);
                    if (patched !== raw) {
                        resolve(new Blob([patched.buffer], { type: blob.type || 'video/webm' }));
                    } else {
                        resolve(blob);
                    }
                } catch (err) {
                    logFn('Patch error: ' + err.message);
                    resolve(blob);
                }
            };
            reader.onerror = function () {
                logFn('FileReader error');
                resolve(blob);
            };
            reader.readAsArrayBuffer(blob);
        }

        if (typeof callbackOrOpts === 'function') {
            run(callbackOrOpts);
            return;
        }

        return new Promise(run);
    }

    adictosFixDuration.default = adictosFixDuration;

    root.ysFixWebmDuration = adictosFixDuration;

})(typeof window !== 'undefined' ? window : this);
