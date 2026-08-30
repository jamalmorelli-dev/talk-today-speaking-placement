(function () {
  'use strict';

  var activeAttempt = false;
  var reviewStartedAt = 0;
  var recordingStartedAt = 0;
  var reviewTimer = null;
  var recordingTimer = null;
  var lastStatus = '';

  function $(id) { return document.getElementById(id); }
  function visible(el) { return !!el && !el.classList.contains('hidden'); }

  function announce(msg) {
    var status = $('taskStatus');
    if (status) status.textContent = msg;
  }

  function clearReviewWatch() {
    if (reviewTimer) clearTimeout(reviewTimer);
    reviewTimer = null;
    reviewStartedAt = 0;
  }

  function clearRecordingWatch() {
    if (recordingTimer) clearTimeout(recordingTimer);
    recordingTimer = null;
    recordingStartedAt = 0;
  }

  function protectAttempt() {
    activeAttempt = true;
  }

  function unprotectAttempt() {
    activeAttempt = false;
    clearReviewWatch();
    clearRecordingWatch();
  }

  function focusUploadButton() {
    var keep = $('btnKeepUpload');
    if (!keep || keep.disabled || !visible($('taskAfterRow'))) return;
    try { keep.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { keep.scrollIntoView(); }
    try { keep.focus({ preventScroll: true }); } catch (e2) { try { keep.focus(); } catch (e3) {} }
  }

  function startReviewWatch() {
    clearReviewWatch();
    protectAttempt();
    reviewStartedAt = Date.now();
    focusUploadButton();

    reviewTimer = setTimeout(function () {
      var after = $('taskAfterRow');
      var keep = $('btnKeepUpload');
      if (!visible(after) || !keep || keep.disabled) return;
      announce('Your recording is ready. Tap KEEP & UPLOAD to continue — do not refresh or restart the test.');
      keep.classList.add('spe-needs-action');
      focusUploadButton();
    }, 15000);
  }

  function startRecordingWatch() {
    clearRecordingWatch();
    protectAttempt();
    recordingStartedAt = Date.now();

    // The normal recorder already auto-stops at the task maximum. This watchdog
    // only catches a UI/MediaRecorder transition that has become stranded.
    recordingTimer = setTimeout(function () {
      var recRow = $('taskRecRow');
      var stop = $('btnStopRec');
      if (!visible(recRow) || !stop) return;
      announce('Recording is taking unusually long. Finishing the recording now…');
      try { stop.click(); } catch (e) {}

      setTimeout(function () {
        if (visible($('taskRecRow'))) {
          announce('The browser did not finish the recording correctly. Do not restart the whole test; tap Stop recording once, or ask staff to refresh this page only if the button remains stuck.');
        }
      }, 5000);
    }, 75000);
  }

  function inspect() {
    var done = $('stepDone');
    if (visible(done)) {
      unprotectAttempt();
      return;
    }

    var identity = $('stepIdentity');
    var mic = $('stepMic');
    var task = $('stepTask');
    if (visible(mic) || visible(task)) protectAttempt();
    if (visible(identity) && !visible(mic) && !visible(task)) activeAttempt = false;

    var recRow = $('taskRecRow');
    var afterRow = $('taskAfterRow');
    var status = $('taskStatus');
    var statusText = status ? status.textContent : '';

    if (visible(recRow) && !recordingStartedAt) startRecordingWatch();
    if (!visible(recRow) && recordingStartedAt) clearRecordingWatch();

    if (visible(afterRow)) {
      if (!reviewStartedAt) startReviewWatch();
    } else if (reviewStartedAt) {
      clearReviewWatch();
      var keep = $('btnKeepUpload');
      if (keep) keep.classList.remove('spe-needs-action');
    }

    // Once app.js has started an upload, remove the review reminder but retain
    // unload protection until the next task or final Done screen appears.
    if (statusText && statusText !== lastStatus) {
      lastStatus = statusText;
      if (/Uploading|Submitting/i.test(statusText)) {
        clearReviewWatch();
        var keep2 = $('btnKeepUpload');
        if (keep2) keep2.classList.remove('spe-needs-action');
      }
    }
  }

  window.addEventListener('beforeunload', function (ev) {
    if (!activeAttempt || visible($('stepDone'))) return;
    ev.preventDefault();
    ev.returnValue = '';
  });

  document.addEventListener('click', function (ev) {
    var target = ev.target;
    if (!target) return;
    if (target.id === 'btnKeepUpload') {
      clearReviewWatch();
      target.classList.remove('spe-needs-action');
      announce('Uploading… please wait. Do not refresh this page.');
    }
  }, true);

  var observer = new MutationObserver(inspect);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeFilter: ['class', 'disabled']
  });

  var style = document.createElement('style');
  style.textContent = [
    '#btnKeepUpload.spe-needs-action {',
    '  transform: scale(1.04);',
    '  box-shadow: 0 0 0 4px rgba(37, 99, 235, .22);',
    '  font-weight: 800;',
    '}',
    '#taskAfterRow:not(.hidden) #btnKeepUpload { min-height: 54px; }'
  ].join('\n');
  document.head.appendChild(style);

  inspect();
})();
