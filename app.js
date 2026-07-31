(function () {
  'use strict';

  var boot = window.__SPE_BOOTSTRAP__ || {};
  if (typeof boot === 'string') {
    try { boot = JSON.parse(boot); } catch (e) { boot = {}; }
  }

  var state = {
    attemptId: '',
    sessionId: 'sess_' + Math.random().toString(36).slice(2, 10),
    level: (boot.level || 'BEG').toUpperCase(),
    tasks: [],
    taskIndex: 0,
    micPassed: false,
    phase: 'id',
    mediaRecorder: null,
    mediaStream: null,
    chunks: [],
    timerId: null,
    startAt: 0,
    currentBlob: null,
    currentMime: '',
    currentDuration: 0,
    recordingStartedAt: '',
    recordingEndedAt: '',
    rerecordCount: 0,
    maxRerecords: 1,
    uploaded: { 1: false, 2: false },
    submitting: false,
    busy: false,
    micCheckSeconds: 5,
    micRecording: false,
    bridgeToken: '',
    bridgeFrame: null,
    bridgeWindow: null,
    bridgeReady: false,
    bridgeQueue: [],
    rpcSeq: 0,
    rpcPending: {},
    bridgeConnectTimer: null
  };

  function $(id) { return document.getElementById(id); }
  function toast(msg, bad) {
    var t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.toggle('bad', !!bad);
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 5000);
  }
  function hasGas() {
    return typeof google !== 'undefined' && google.script && google.script.run;
  }
  function isoNow() { return new Date().toISOString(); }
  function ua() { return navigator.userAgent || ''; }
  function deviceLabel() {
    var u = ua();
    if (/iPhone|iPad/i.test(u)) return 'iOS Safari/WebKit';
    if (/Android/i.test(u)) return 'Android Chrome';
    if (/Safari/i.test(u) && !/Chrome|CriOS|Edg/i.test(u)) return 'Desktop Safari';
    if (/Chrome|CriOS/i.test(u)) return 'Chrome';
    return 'Browser';
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return pad(Math.floor(sec / 60)) + ':' + pad(sec % 60);
  }
  function setPills(step) {
    document.querySelectorAll('.step-pill').forEach(function (el) {
      var s = el.getAttribute('data-step');
      el.classList.remove('on', 'done');
      var order = ['id', 'mic', 'task1', 'task2', 'done'];
      var cur = order.indexOf(step);
      var mine = order.indexOf(s);
      if (mine === cur) el.classList.add('on');
      else if (mine < cur) el.classList.add('done');
    });
  }
  function show(id) {
    ['stepIdentity', 'stepMic', 'stepTask', 'stepDone'].forEach(function (x) {
      var el = $(x);
      if (el) el.classList.toggle('hidden', x !== id);
    });
  }
  function bridgeErrorMessage_(err) {
    if (!err) return 'Request failed';
    if (typeof err === 'string') return err;
    return err.message || String(err);
  }

  function flushBridgeQueue_() {
    if (!state.bridgeReady || !state.bridgeWindow) return;
    while (state.bridgeQueue.length) {
      state.bridgeWindow.postMessage(state.bridgeQueue.shift(), '*');
    }
  }

  function installRunnerRpcListener_() {
    if (window.__SPE_RPC_LISTENER_INSTALLED__) return;
    window.__SPE_RPC_LISTENER_INSTALLED__ = true;
    window.addEventListener('message', function (ev) {
      var data = ev && ev.data;
      if (!data || (!window.__SPE_TOPLEVEL_RUNNER__ && !window.__SPE_EXTERNAL_FRONTEND__)) return;
      if (!data.token || data.token !== window.__SPE_BRIDGE_TOKEN__) return;

      if (data.type === 'SPE_BRIDGE_READY') {
        state.bridgeWindow = ev.source;
        state.bridgeReady = true;
        if (state.bridgeConnectTimer) clearTimeout(state.bridgeConnectTimer);
        state.bridgeConnectTimer = null;
        if ($('btnStart') && !state.busy) $('btnStart').disabled = false;
        if ($('idStatus') && $('idStatus').textContent === 'Connecting securely…') $('idStatus').textContent = '';
        flushBridgeQueue_();
        return;
      }

      if (data.type !== 'SPE_GAS_RESULT') return;
      if (!state.bridgeWindow || ev.source !== state.bridgeWindow) return;
      var pending = state.rpcPending[data.id];
      if (!pending) return;
      delete state.rpcPending[data.id];
      clearTimeout(pending.timeoutId);
      if (data.ok) pending.onOk && pending.onOk(data.result);
      else pending.onErr && pending.onErr({ message: data.error || 'Request failed' });
    });
  }

  function ensureRunnerBridge_() {
    if (!window.__SPE_TOPLEVEL_RUNNER__ && !window.__SPE_EXTERNAL_FRONTEND__) return false;
    if (state.bridgeFrame) return true;
    var baseUrl = String(boot.webAppUrl || '');
    if (!baseUrl) return false;

    installRunnerRpcListener_();
    state.bridgeToken = window.__SPE_BRIDGE_TOKEN__;
    var sep = baseUrl.indexOf('?') === -1 ? '?' : '&';
    var frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';
    frame.style.border = '0';
    frame.src = baseUrl + sep + 'page=bridge&token=' + encodeURIComponent(state.bridgeToken);
    document.body.appendChild(frame);
    state.bridgeFrame = frame;
    return true;
  }

  function run(fnName, args, onOk, onErr) {
    if (hasGas()) {
      var runner = google.script.run
        .withSuccessHandler(onOk || function () {})
        .withFailureHandler(function (err) {
          onErr && onErr(err || { message: 'Request failed' });
        });
      runner[fnName].apply(runner, args || []);
      return;
    }

    // The visible top-level runner owns the microphone. A hidden Apps Script
    // bridge iframe owns google.script.run and relays only approved student calls.
    if ((window.__SPE_TOPLEVEL_RUNNER__ || window.__SPE_EXTERNAL_FRONTEND__) && ensureRunnerBridge_()) {
      var id = 'rpc_' + (++state.rpcSeq) + '_' + Date.now();
      var timeoutId = setTimeout(function () {
        var pending = state.rpcPending[id];
        if (!pending) return;
        delete state.rpcPending[id];
        pending.onErr && pending.onErr({ message: 'The server took too long to respond. Try again.' });
      }, 180000);
      state.rpcPending[id] = { onOk: onOk, onErr: onErr, timeoutId: timeoutId };
      var message = {
        type: 'SPE_GAS_CALL',
        token: state.bridgeToken,
        id: id,
        fnName: fnName,
        args: args || []
      };
      if (state.bridgeReady && state.bridgeWindow) state.bridgeWindow.postMessage(message, '*');
      else state.bridgeQueue.push(message);
      return;
    }

    onErr && onErr({ message: 'The Talk Today server connection could not start.' });
  }

  function logEvent(event, detail) {
    run('studentLogClientEvent', [{
      event: event,
      attemptId: state.attemptId,
      detail: detail || '',
      clientTimestamp: isoNow(),
      userAgent: ua()
    }]);
  }

  function isIframed() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function updateIframeBanner() {
    // The launcher never asks for microphone access; the top-level runner does.
    var banner = $('iframeBanner');
    if (banner) banner.classList.add('hidden');
  }

  function getUserMedia(constraints) {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      return navigator.mediaDevices.getUserMedia(constraints);
    }
    var legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
    if (legacy) {
      return new Promise(function (resolve, reject) {
        legacy.call(navigator, constraints, resolve, reject);
      });
    }
    return Promise.reject(Object.assign(new Error('No getUserMedia'), { name: 'NotSupportedError' }));
  }

  function preferredMime() {
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/ogg'];
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported) return '';
    for (var i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function stopTracks() {
    try {
      if (state.mediaStream) state.mediaStream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
    state.mediaStream = null;
  }

  function clearTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function base64ToBlob(b64, mime) {
    var bin = atob(b64);
    var len = bin.length;
    var bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'audio/webm' });
  }

  function blobToBase64(blob, cb) {
    var reader = new FileReader();
    reader.onerror = function () { cb(null, new Error('Could not read audio.')); };
    reader.onload = function () {
      var result = reader.result;
      if (typeof result !== 'string' || result.indexOf(',') === -1) {
        cb(null, new Error('Could not prepare audio.'));
        return;
      }
      cb(result.split(',')[1], null);
    };
    reader.readAsDataURL(blob);
  }

  function microphoneError_(err) {
    var name = err && err.name ? err.name : '';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Microphone permission was denied. Allow microphone access for this page, then tap Record again.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return 'No microphone was found on this device.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return 'The microphone is being used by another app. Close the other app and try again.';
    }
    if (name === 'OverconstrainedError') {
      return 'This microphone cannot use the requested recording settings.';
    }
    if (name === 'AbortError') {
      return 'The microphone stopped unexpectedly. Try again.';
    }
    return (err && err.message) ? err.message : 'The microphone could not start.';
  }

  function hasLiveMicrophone_() {
    if (!state.mediaStream) return false;
    var tracks = state.mediaStream.getAudioTracks ? state.mediaStream.getAudioTracks() : [];
    return !!(tracks.length && tracks.some(function (t) { return t.readyState === 'live'; }));
  }

  function setMicrophoneEnabled_(enabled) {
    if (!state.mediaStream || !state.mediaStream.getAudioTracks) return;
    state.mediaStream.getAudioTracks().forEach(function (track) {
      try { track.enabled = !!enabled; } catch (e) {}
    });
  }

  function ensureMicrophoneStream_() {
    if (hasLiveMicrophone_()) return Promise.resolve(state.mediaStream);
    stopTracks();
    return getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    }).then(function (stream) {
      state.mediaStream = stream;
      setMicrophoneEnabled_(false);
      return stream;
    });
  }

  /**
   * Record directly in the top-level HTTPS page. The microphone stream is
   * requested once and retained for the complete test, so the candidate is
   * not bounced through repeated browser permission flows.
   */
  function recordSeconds(maxSec, onTick, onDone) {
    maxSec = Math.max(3, Number(maxSec) || 5);

    if (isIframed()) {
      onDone(null, new Error('Open the speaking test in its full-screen tab first.'));
      return;
    }
    if (!window.isSecureContext) {
      onDone(null, new Error('Microphone recording requires a secure HTTPS page.'));
      return;
    }
    if (!window.MediaRecorder) {
      onDone(null, new Error('This browser does not support audio recording. Use current Chrome or Safari.'));
      return;
    }

    ensureMicrophoneStream_().then(function (stream) {
      setMicrophoneEnabled_(true);
      state.chunks = [];
      var mime = preferredMime();
      try {
        state.mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      } catch (e) {
        state.mediaRecorder = new MediaRecorder(stream);
      }
      state.currentMime = state.mediaRecorder.mimeType || mime || 'audio/webm';
      state.recordingStartedAt = isoNow();
      state.startAt = Date.now();
      state.micRecording = true;

      state.mediaRecorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size) state.chunks.push(ev.data);
      };
      state.mediaRecorder.onerror = function (ev) {
        clearTimer();
        stopTracks();
        state.micRecording = false;
        onDone(null, new Error(microphoneError_(ev && ev.error ? ev.error : ev)));
      };
      state.mediaRecorder.onstop = function () {
        clearTimer();
        state.micRecording = false;
        setMicrophoneEnabled_(false);
        state.recordingEndedAt = isoNow();
        var type = state.currentMime || 'audio/webm';
        var blob = new Blob(state.chunks, { type: type });
        var duration = Math.max(0, (Date.now() - state.startAt) / 1000);
        if (!blob.size || blob.size < 400) {
          onDone(null, new Error('The recording was empty. Speak closer to the microphone and try again.'));
          return;
        }
        onDone({ blob: blob, mime: type, duration: duration }, null);
      };

      try {
        state.mediaRecorder.start(250);
      } catch (eStart) {
        try {
          state.mediaRecorder.start();
        } catch (eStart2) {
          stopTracks();
          state.micRecording = false;
          onDone(null, new Error('The recorder could not start on this browser.'));
          return;
        }
      }

      clearTimer();
      state.timerId = setInterval(function () {
        var elapsed = (Date.now() - state.startAt) / 1000;
        onTick && onTick(elapsed, maxSec);
        if (elapsed >= maxSec && state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
          state.mediaRecorder.stop();
        }
      }, 200);
    }).catch(function (err) {
      state.micRecording = false;
      logEvent('MIC_DIRECT_FAIL', (err && err.name ? err.name : '') + ' ' + (err && err.message ? err.message : ''));
      onDone(null, new Error(microphoneError_(err)));
    });
  }

  function stopRecording() {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
      state.mediaRecorder.stop();
    }
  }

  function applyPrefill(data) {
    data = data || boot;
    if (data.studentId) $('studentId').value = data.studentId;
    if (data.fullName) $('fullName').value = data.fullName;
    if (data.age) $('age').value = data.age;
    if (data.phone) $('phone').value = data.phone;
    if (data.writtenAttemptId) $('writtenAttemptId').value = data.writtenAttemptId;
    if (data.level && ['BEG', 'INT', 'ADV'].indexOf(String(data.level).toUpperCase()) !== -1) {
      $('level').value = String(data.level).toUpperCase();
    }
  }

  function collectForm() {
    return {
      studentId: $('studentId').value.trim(),
      fullName: $('fullName').value.trim(),
      age: $('age').value.trim(),
      phone: $('phone').value.trim(),
      level: $('level').value,
      writtenAttemptId: $('writtenAttemptId').value.trim(),
      sessionId: state.sessionId
    };
  }

  function startAttemptFromForm(form, thenMic) {
    state.busy = true;
    $('idStatus').textContent = 'Starting…';
    if ($('btnStart')) $('btnStart').disabled = true;

    run('studentStartAttempt', [{
      studentId: form.studentId,
      fullName: form.fullName,
      age: form.age,
      phone: form.phone,
      level: form.level,
      writtenAttemptId: form.writtenAttemptId,
      device: deviceLabel(),
      userAgent: ua(),
      clientTimestamp: isoNow(),
      sessionId: form.sessionId || state.sessionId
    }], function (res) {
      state.busy = false;
      if ($('btnStart')) $('btnStart').disabled = false;
      if (!res || !res.ok) {
        $('idStatus').textContent = 'Could not start.';
        toast('Could not start attempt.', true);
        return;
      }
      state.attemptId = res.attemptId;
      state.sessionId = res.sessionId || state.sessionId;
      state.level = res.level;
      state.tasks = res.tasks || [];
      state.micCheckSeconds = res.micCheckSeconds || 5;
      $('idStatus').textContent = res.message || '';
      setPills('mic');
      show('stepMic');
      if (thenMic !== false) {
        // Must stay in user-gesture chain as much as possible: start mic ASAP
        setTimeout(function () { startMicCheck(); }, 200);
      }
    }, function (err) {
      state.busy = false;
      if ($('btnStart')) $('btnStart').disabled = false;
      $('idStatus').textContent = '';
      toast((err && err.message) || 'Start failed', true);
    });
  }

  // ---- Identity ----
  $('btnStart').onclick = function () {
    if (state.busy) return;
    var form = collectForm();
    if (!form.fullName) { toast('Please enter your full name.', true); return; }
    if (!form.level) { toast('Select a level.', true); return; }

    // Production students use the top-level HTTPS front end (GitHub Pages).
    // The Apps Script HtmlService page remains a server/admin fallback only.
    if (!window.__SPE_TOPLEVEL_RUNNER__ && !window.__SPE_EXTERNAL_FRONTEND__) {
      var frontend = String(boot.frontendUrl || '');
      if (frontend) {
        var qs = new URLSearchParams({
          studentId: form.studentId,
          fullName: form.fullName,
          age: form.age,
          phone: form.phone,
          level: form.level,
          writtenAttemptId: form.writtenAttemptId
        });
        var destination = frontend.replace(/\/$/, '') + '/?' + qs.toString();
        var link = document.createElement('a');
        link.href = destination;
        link.target = '_top';
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        $('idStatus').textContent = 'Opening the secure speaking test…';
      } else {
        toast('Use the published Talk Today speaking-test link.', true);
      }
      return;
    }

    state.busy = true;
    $('btnStart').disabled = true;
    $('idStatus').textContent = 'Checking microphone…';
    ensureMicrophoneStream_().then(function () {
      state.busy = false;
      $('btnStart').disabled = false;
      startAttemptFromForm(form, true);
    }).catch(function (err) {
      state.busy = false;
      $('btnStart').disabled = false;
      stopTracks();
      $('idStatus').textContent = '';
      toast(microphoneError_(err), true);
    });
  };

  // ---- Mic check ----
  var micBlob = null;
  var micBase64 = null;

  function startMicCheck() {
    if (state.busy || state.micRecording) return;
    micBlob = null;
    micBase64 = null;
    $('micConfirmRow').classList.add('hidden');
    $('micPlayback').classList.add('hidden');
    $('btnMicRecord').classList.add('hidden');
    $('btnMicStop').classList.remove('hidden');
    $('micStatus').textContent = 'Allow microphone access if your browser asks, then speak now.';
    $('micTimer').classList.add('live');
    $('micTimer').textContent = '00:00';

    recordSeconds(state.micCheckSeconds || 5, function (elapsed, max) {
      $('micTimer').textContent = fmt(Math.min(elapsed, max));
    }, function (result, err) {
      $('btnMicStop').classList.add('hidden');
      $('btnMicRecord').classList.remove('hidden');
      $('micTimer').classList.remove('live');
      if (err) {
        $('micStatus').textContent = err.message;
        toast(err.message, true);
        return;
      }
      micBlob = result.blob;
      micBase64 = result.base64 || null;
      var url = URL.createObjectURL(result.blob);
      var audio = $('micPlayback');
      audio.src = url;
      audio.classList.remove('hidden');
      try { audio.play(); } catch (e) {}
      $('micConfirmRow').classList.remove('hidden');
      $('micStatus').textContent = 'Play the check, then confirm you can hear yourself.';
    });
  }

  $('btnMicRecord').onclick = function () { startMicCheck(); };
  $('btnMicStop').onclick = function () { stopRecording(); };
  $('btnMicRetry').onclick = function () {
    micBlob = null;
    micBase64 = null;
    $('micPlayback').removeAttribute('src');
    $('micPlayback').classList.add('hidden');
    $('micConfirmRow').classList.add('hidden');
    $('micTimer').textContent = '00:00';
    startMicCheck();
  };
  $('btnMicOk').onclick = function () {
    if (!micBlob) { toast('Record the check first.', true); return; }
    state.busy = true;
    run('studentConfirmMic', [{
      attemptId: state.attemptId,
      passed: true,
      clientTimestamp: isoNow(),
      userAgent: ua()
    }], function () {
      state.busy = false;
      state.micPassed = true;
      state.taskIndex = 0;
      state.rerecordCount = 0;
      beginTask();
    }, function (err) {
      state.busy = false;
      toast((err && err.message) || 'Could not confirm mic', true);
    });
  };

  // ---- Tasks ----
  function currentTask() { return state.tasks[state.taskIndex]; }

  function beginTask() {
    var t = currentTask();
    if (!t) {
      toast('No task loaded.', true);
      return;
    }
    state.phase = 'prep_ready';
    state.currentBlob = null;
    state.rerecordCount = 0;
    setPills(state.taskIndex === 0 ? 'task1' : 'task2');
    show('stepTask');
    $('taskTitle').textContent = 'Task ' + t.taskNumber + ' · ' + (t.taskType || '').replace(/_/g, ' ');
    $('taskChip').textContent = t.level;
    $('taskPrompt').textContent = t.promptText;
    $('taskTimer').textContent = fmt(t.preparationSeconds);
    $('taskTimer').className = 'timer prep';
    $('taskStatus').textContent = 'Preparation starts automatically…';
    $('taskPlayback').classList.add('hidden');
    $('taskPlayback').removeAttribute('src');
    $('taskActionRow').classList.remove('hidden');
    $('taskRecRow').classList.add('hidden');
    $('taskAfterRow').classList.add('hidden');
    $('btnStartPrep').disabled = false;
    $('btnStartPrep').textContent = 'Start preparation';
    setTimeout(function () {
      if (state.phase === 'prep_ready') startPrep(t);
    }, 400);
  }

  $('btnReadAloud').onclick = function () {
    var t = currentTask();
    if (!t || !window.speechSynthesis) { toast('Speech not available on this device.', true); return; }
    window.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(t.ttsText || t.promptText);
    u.lang = 'en-US';
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  };
  $('btnStopAloud').onclick = function () {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  };

  $('btnStartPrep').onclick = function () {
    var t = currentTask();
    if (!t) return;
    if (state.phase === 'prep_ready') startPrep(t);
    else if (state.phase === 'record_ready') startTaskRecord(t);
  };

  function startPrep(t) {
    state.phase = 'prep';
    $('btnStartPrep').disabled = true;
    var left = Number(t.preparationSeconds) || 10;
    $('taskTimer').className = 'timer prep';
    $('taskStatus').textContent = 'Prepare your answer…';
    clearTimer();
    state.timerId = setInterval(function () {
      left -= 1;
      $('taskTimer').textContent = fmt(left);
      if (left <= 0) {
        clearTimer();
        state.phase = 'record_ready';
        $('taskStatus').textContent = 'Recording starts now…';
        $('btnStartPrep').disabled = false;
        $('btnStartPrep').textContent = 'Start recording';
        setTimeout(function () {
          if (state.phase === 'record_ready') startTaskRecord(t);
        }, 300);
      }
    }, 1000);
  }

  function startTaskRecord(t) {
    if (state.phase === 'recording' || state.micRecording) return;
    state.phase = 'recording';
    $('taskActionRow').classList.add('hidden');
    $('taskRecRow').classList.remove('hidden');
    $('taskAfterRow').classList.add('hidden');
    $('taskTimer').className = 'timer live';
    $('taskStatus').textContent = 'Recording… speak now';
    logEvent('RECORDING_START', 'task=' + t.taskNumber);

    recordSeconds(Number(t.maximumRecordingSeconds) || 60, function (elapsed, max) {
      $('taskTimer').textContent = fmt(Math.min(elapsed, max));
    }, function (result, err) {
      $('taskRecRow').classList.add('hidden');
      if (err) {
        state.phase = 'record_ready';
        $('taskActionRow').classList.remove('hidden');
        $('btnStartPrep').disabled = false;
        $('btnStartPrep').textContent = 'Start recording';
        $('taskStatus').textContent = err.message;
        toast(err.message, true);
        return;
      }
      state.currentBlob = result.blob;
      state.currentMime = result.mime;
      state.currentDuration = result.duration;
      state._uploadBase64 = result.base64 || null;
      var url = URL.createObjectURL(result.blob);
      var audio = $('taskPlayback');
      audio.src = url;
      audio.classList.remove('hidden');
      try { audio.play(); } catch (e) {}
      state.phase = 'review';
      $('taskAfterRow').classList.remove('hidden');
      var canRerecord = state.rerecordCount < state.maxRerecords;
      $('btnRerecord').disabled = !canRerecord;
      $('btnRerecord').textContent = canRerecord ? 'Rerecord once' : 'Rerecord used';
      $('taskStatus').textContent = 'Listen, then keep & upload (or rerecord once).';
      if (result.duration < (t.minimumRecordingSeconds || 3)) {
        toast('Recording is quite short — you may rerecord.', true);
      }
    });
  }

  $('btnStopRec').onclick = function () { stopRecording(); };

  $('btnRerecord').onclick = function () {
    if (state.rerecordCount >= state.maxRerecords) {
      toast('Only one rerecord is allowed.', true);
      return;
    }
    state.rerecordCount += 1;
    logEvent('RERECORD', 'task=' + (currentTask() && currentTask().taskNumber));
    state.currentBlob = null;
    state._uploadBase64 = null;
    $('taskPlayback').classList.add('hidden');
    $('taskAfterRow').classList.add('hidden');
    state.phase = 'record_ready';
    startTaskRecord(currentTask());
  };

  $('btnKeepUpload').onclick = function () {
    if (!state.currentBlob || state.busy) return;
    var t = currentTask();
    state.busy = true;
    $('btnKeepUpload').disabled = true;
    $('btnRerecord').disabled = true;
    $('taskStatus').textContent = 'Uploading… please wait';

    function doUpload(b64) {
      run('studentUploadResponse', [{
        attemptId: state.attemptId,
        promptId: t.promptId,
        taskNumber: t.taskNumber,
        base64Audio: b64,
        mimeType: state.currentMime,
        duration: state.currentDuration || 0,
        recordingStartedAt: state.recordingStartedAt,
        recordingEndedAt: state.recordingEndedAt,
        rerecordCount: state.rerecordCount,
        clientTimestamp: isoNow(),
        userAgent: ua()
      }], function (res) {
        state.busy = false;
        $('btnKeepUpload').disabled = false;
        if (!res || !res.ok) {
          toast('Upload failed — try again.', true);
          return;
        }
        state.uploaded[t.taskNumber] = true;
        toast('Task ' + t.taskNumber + ' uploaded');
        if (state.taskIndex === 0) {
          state.taskIndex = 1;
          state.rerecordCount = 0;
          beginTask();
        } else {
          finalizeSubmit();
        }
      }, function (e) {
        state.busy = false;
        $('btnKeepUpload').disabled = false;
        $('btnRerecord').disabled = state.rerecordCount >= state.maxRerecords;
        $('taskStatus').textContent = 'Upload failed — you can try again.';
        toast((e && e.message) || 'Upload failed', true);
      });
    }

    if (state._uploadBase64) {
      doUpload(state._uploadBase64);
    } else {
      blobToBase64(state.currentBlob, function (b64, err) {
        if (err) {
          state.busy = false;
          $('btnKeepUpload').disabled = false;
          toast(err.message, true);
          return;
        }
        doUpload(b64);
      });
    }
  };

  function finalizeSubmit() {
    if (state.submitting) return;
    state.submitting = true;
    $('taskStatus').textContent = 'Submitting your speaking test…';
    run('studentSubmitAttempt', [{
      attemptId: state.attemptId,
      clientTimestamp: isoNow(),
      userAgent: ua()
    }], function (res) {
      stopTracks();
      setPills('done');
      show('stepDone');
      toast((res && res.message) || 'Submitted');
    }, function (err) {
      state.submitting = false;
      toast((err && err.message) || 'Submit failed — staff may still have your uploads.', true);
      $('taskStatus').textContent = (err && err.message) || 'Submit failed';
    });
  }

  // ---- Init ----
  applyPrefill(window.__SPE_TRANSFER__ || boot);
  updateIframeBanner();
  setPills('id');
  show('stepIdentity');

  if (window.__SPE_TOPLEVEL_RUNNER__ || window.__SPE_EXTERNAL_FRONTEND__) {
    document.documentElement.classList.add('top-level-runner');
    if (!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec(?:$|[?#])/.test(String(boot.webAppUrl || ''))) {
      $('btnStart').disabled = true;
      $('idStatus').textContent = 'This speaking-test link has not been connected to the Talk Today server.';
    } else {
      $('btnStart').disabled = true;
      $('idStatus').textContent = 'Connecting securely…';
      installRunnerRpcListener_();
      ensureRunnerBridge_();
      state.bridgeConnectTimer = setTimeout(function () {
        if (!state.bridgeReady) {
          $('btnStart').disabled = true;
          $('idStatus').textContent = 'The Talk Today server could not be reached. Refresh this page and try again.';
        }
      }, 12000);
    }
    if (window.__SPE_AUTOSTART__ && window.__SPE_TRANSFER__) {
      setTimeout(function () {
        var form = collectForm();
        if (form.fullName && form.level) startAttemptFromForm(form, true);
      }, 60);
    }
  }

  window.addEventListener('pagehide', stopTracks);
  window.addEventListener('beforeunload', stopTracks);
})();
