/* ===========================
   DRIVING COURSE SIMULATOR - app.js
   =========================== */

// ===========================
// DATA MODEL
// ===========================

const COURSES = {
  city: {
    name: "市街地コース",
    totalDistance: 15,
    totalDuration: 30, // minutes
    restFacility: "コンビニ",
    segments: [
      { name: "会社(出発)", type: "start", distance: 0, speed: 0, icon: "🏢" },
      { name: "市街地", type: "urban", distance: 3, speed: 40, icon: "🏙️" },
      { name: "コンビニ", type: "rest", distance: 7, speed: 0, icon: "🏪" },
      { name: "市街地", type: "urban", distance: 12, speed: 35, icon: "🏙️" },
      { name: "自宅(到着)", type: "end", distance: 15, speed: 0, icon: "🏠" }
    ]
  },
  suburban: {
    name: "郊外コース",
    totalDistance: 30,
    totalDuration: 45,
    restFacility: "ロードサイド休憩所",
    segments: [
      { name: "会社(出発)", type: "start", distance: 0, speed: 0, icon: "🏢" },
      { name: "国道", type: "national", distance: 8, speed: 55, icon: "🛣️" },
      { name: "ロードサイド休憩所", type: "rest", distance: 18, speed: 0, icon: "☕" },
      { name: "住宅街", type: "residential", distance: 25, speed: 40, icon: "🏘️" },
      { name: "自宅(到着)", type: "end", distance: 30, speed: 0, icon: "🏠" }
    ]
  },
  highway: {
    name: "高速利用コース",
    totalDistance: 50,
    totalDuration: 40,
    restFacility: "SA(サービスエリア)",
    segments: [
      { name: "会社(出発)", type: "start", distance: 0, speed: 0, icon: "🏢" },
      { name: "高速道路", type: "highway", distance: 15, speed: 90, icon: "🛣️" },
      { name: "SA(サービスエリア)", type: "rest", distance: 30, speed: 0, icon: "⛽" },
      { name: "一般道", type: "urban", distance: 42, speed: 50, icon: "🏙️" },
      { name: "自宅(到着)", type: "end", distance: 50, speed: 0, icon: "🏠" }
    ]
  }
};

const ROAD_TYPE_LABELS = {
  start: "出発地",
  end: "到着地",
  rest: "休憩所",
  urban: "市街地",
  highway: "高速道路",
  national: "国道",
  residential: "住宅街"
};

let state = {
  currentCourse: "city",
  isPlaying: false,
  speedMultiplier: 1,
  currentDistance: 0,       // km
  elapsedMinutes: 0,        // simulation minutes
  firedEvents: new Set(),   // track which UC events have fired (1, 2, 3)
  activeProposal: null,     // which UC proposal is showing (null, 1, 2, 3)

  // UC settings
  uc1: { timeThreshold: 10, drowsiness: true, steering: true, combinedThreshold: 5 },
  uc2: { alertnessMethod: "換気" },
  uc3: { restMethod: "飲み物休憩", restTime: "3分" }
};

// RAF state
let lastTimestamp = null;
let rafId = null;

// Scrubbing state
let isScrubbing = false;

// ===========================
// FIRE POSITION CALCULATION
// ===========================

function calculateFirePositions(courseKey) {
  const course = COURSES[courseKey];
  const restSegment = course.segments.find(s => s.type === "rest");
  const restDistance = restSegment.distance;
  const avgSpeed = course.totalDistance / (course.totalDuration / 60); // km/h

  // UC① position: time threshold in minutes → distance
  const uc1Distance = Math.min(
    (state.uc1.timeThreshold / course.totalDuration) * course.totalDistance,
    restDistance - 0.5
  );

  // UC② position: 5 minutes before rest facility
  const fiveMinDistance = avgSpeed * (5 / 60);
  const uc2Distance = Math.max(restDistance - fiveMinDistance, uc1Distance + 0.5);

  // UC③ position: at rest facility
  const uc3Distance = restDistance;

  return {
    uc1: uc1Distance,
    uc2: uc2Distance,
    uc3: uc3Distance
  };
}

// ===========================
// TOAST
// ===========================

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

// ===========================
// COURSE RENDERING
// ===========================

function renderCourse(animate) {
  const course = COURSES[state.currentCourse];

  // Update metadata
  document.getElementById('totalDistance').textContent = course.totalDistance + ' km';
  document.getElementById('totalDuration').textContent = course.totalDuration + ' 分';
  document.getElementById('restFacility').textContent = course.restFacility;

  const segmentList = document.getElementById('segmentList');

  function buildSegments() {
    segmentList.innerHTML = '';
    course.segments.forEach((seg, idx) => {
      const li = document.createElement('li');
      li.className = 'segment-item' + (animate ? ' fade-in' : '');
      li.dataset.index = idx;
      li.dataset.type = seg.type;

      const iconSpan = document.createElement('span');
      iconSpan.className = 'segment-icon';
      iconSpan.textContent = seg.icon;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'segment-name';
      nameSpan.textContent = seg.name;

      const distSpan = document.createElement('span');
      distSpan.className = 'segment-dist';
      distSpan.textContent = seg.distance + ' km';

      li.appendChild(iconSpan);
      li.appendChild(nameSpan);
      li.appendChild(distSpan);
      segmentList.appendChild(li);
    });
    // Add fire indicator badges after segments are built
    updateSegmentFireIndicators();
  }

  if (animate) {
    // Fade out existing items
    const existingItems = segmentList.querySelectorAll('.segment-item');
    existingItems.forEach(item => item.classList.add('fade-out'));
    setTimeout(() => {
      buildSegments();
    }, 300);
  } else {
    buildSegments();
  }

  // Render segment dividers on progress bar
  renderSegmentDividers();

  // Update fire positions
  updateFirePositions();
}

function renderSegmentDividers() {
  const course = COURSES[state.currentCourse];
  const totalDistance = course.totalDistance;

  const dividerContainer = document.getElementById('segmentDividers');
  const labelsContainer = document.getElementById('segmentLabels');

  dividerContainer.innerHTML = '';
  labelsContainer.innerHTML = '';

  course.segments.forEach((seg, idx) => {
    const pct = (seg.distance / totalDistance) * 100;

    // Divider line (skip first segment at 0%)
    if (idx > 0) {
      const divider = document.createElement('div');
      divider.className = 'segment-divider';
      divider.style.left = pct + '%';
      dividerContainer.appendChild(divider);
    }

    // Dot
    const dot = document.createElement('div');
    dot.className = 'segment-dot' + (seg.type === 'rest' ? ' rest-dot' : '');
    dot.style.left = pct + '%';
    dividerContainer.appendChild(dot);

    // Label below progress bar
    const label = document.createElement('div');
    label.className = 'segment-label';
    label.style.left = pct + '%';
    label.textContent = seg.icon;
    labelsContainer.appendChild(label);
  });
}

// ===========================
// FIRE POSITION UPDATES
// ===========================

function updateFirePositions() {
  const course = COURSES[state.currentCourse];
  const totalDistance = course.totalDistance;
  const positions = calculateFirePositions(state.currentCourse);

  const marker1 = document.getElementById('marker1');
  const marker2 = document.getElementById('marker2');
  const marker3 = document.getElementById('marker3');

  marker1.style.left = (positions.uc1 / totalDistance * 100) + '%';
  marker2.style.left = (positions.uc2 / totalDistance * 100) + '%';
  marker3.style.left = (positions.uc3 / totalDistance * 100) + '%';

  document.getElementById('ucPos1').textContent = '発火位置: ' + positions.uc1.toFixed(1) + ' km';
  document.getElementById('ucPos2').textContent = '発火位置: ' + positions.uc2.toFixed(1) + ' km';
  document.getElementById('ucPos3').textContent = '発火位置: ' + positions.uc3.toFixed(1) + ' km';

  updateSegmentFireIndicators();
}

function updateSegmentFireIndicators() {
  const course = COURSES[state.currentCourse];
  const positions = calculateFirePositions(state.currentCourse);
  const segments = course.segments;

  // Clear all existing fire indicator containers
  document.querySelectorAll('#segmentList .fire-indicators').forEach(el => el.remove());

  // Ensure each segment list item has an indicator container
  const listItems = document.querySelectorAll('#segmentList .segment-item');
  listItems.forEach(li => {
    const container = document.createElement('div');
    container.className = 'fire-indicators';
    li.appendChild(container);
  });

  // For each fire point, find the segment it falls in
  const firePoints = [
    { num: 1, dist: positions.uc1, label: '①', cssClass: 'fire-indicator-1' },
    { num: 2, dist: positions.uc2, label: '②', cssClass: 'fire-indicator-2' },
    { num: 3, dist: positions.uc3, label: '③', cssClass: 'fire-indicator-3' }
  ];

  firePoints.forEach(fp => {
    // Find the segment whose distance is <= fire distance and
    // the next segment's distance is > fire distance (or it's the last segment)
    let segIdx = 0;
    for (let i = segments.length - 1; i >= 0; i--) {
      if (segments[i].distance <= fp.dist) {
        segIdx = i;
        break;
      }
    }

    const li = listItems[segIdx];
    if (li) {
      const container = li.querySelector('.fire-indicators');
      if (container) {
        const badge = document.createElement('span');
        badge.className = 'fire-indicator ' + fp.cssClass;
        badge.textContent = fp.label;
        container.appendChild(badge);
      }
    }
  });
}

// ===========================
// PLAYBACK ENGINE
// ===========================

function startPlayback() {
  if (rafId) return;
  lastTimestamp = null;
  rafId = requestAnimationFrame(tick);
}

function stopPlayback() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTimestamp = null;
}

function tick(timestamp) {
  if (!state.isPlaying) {
    rafId = null;
    return;
  }

  if (lastTimestamp === null) {
    lastTimestamp = timestamp;
  }

  const dtMs = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  // Convert real milliseconds to simulation minutes
  // At 1x speed: full course plays in 60 real seconds
  // So 1 real second = (totalDuration / 60) simulation minutes at 1x
  const course = COURSES[state.currentCourse];
  const simMinutesPerRealSecond = course.totalDuration / 60;
  const dtSimMinutes = (dtMs / 1000) * simMinutesPerRealSecond * state.speedMultiplier;

  state.elapsedMinutes = Math.min(
    state.elapsedMinutes + dtSimMinutes,
    course.totalDuration
  );

  // Simple linear distance calculation
  state.currentDistance = (state.elapsedMinutes / course.totalDuration) * course.totalDistance;

  updateUI();
  checkFireEvents();

  if (state.currentDistance < course.totalDistance) {
    rafId = requestAnimationFrame(tick);
  } else {
    // Reached end
    state.isPlaying = false;
    rafId = null;
    updatePlayPauseButton();
  }
}

// ===========================
// UI UPDATES PER FRAME
// ===========================

function updateUI() {
  const course = COURSES[state.currentCourse];
  const totalDistance = course.totalDistance;
  const pct = totalDistance > 0 ? (state.currentDistance / totalDistance) * 100 : 0;

  // Car icon and progress fill
  document.getElementById('carIcon').style.left = pct + '%';
  document.getElementById('progressFill').style.width = pct + '%';
  document.getElementById('progressPercent').textContent = Math.round(pct) + '%';

  // Driving time (MM:SS)
  const totalSecs = Math.floor(state.elapsedMinutes * 60);
  const mm = Math.floor(totalSecs / 60);
  const ss = totalSecs % 60;
  document.getElementById('drivingTime').textContent =
    String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');

  // Current position
  document.getElementById('currentPosition').textContent = state.currentDistance.toFixed(1) + ' km';

  // Current segment
  const currentSeg = getCurrentSegment();
  updateSegmentHighlight(currentSeg);

  // Exterior state
  if (currentSeg) {
    document.getElementById('drivingArea').textContent = currentSeg.name;
    document.getElementById('currentSpeed').textContent = currentSeg.speed;
    document.getElementById('roadType').textContent = ROAD_TYPE_LABELS[currentSeg.type] || currentSeg.type;
  }

  // Interior state - drowsiness
  updateDrowsiness(pct);

  // Cabin temperature: 22°C + progress * 4 (slowly rises to 26°C)
  const temp = (22 + (pct / 100) * 4).toFixed(1);
  document.getElementById('cabinTemp').textContent = temp + '°C';

  // Nav display
  updateNavDisplay();
}

function getCurrentSegment() {
  const course = COURSES[state.currentCourse];
  const segments = course.segments;
  const dist = state.currentDistance;

  // Find which segment range we're in
  // A segment is "current" if the car is between its distance and the next segment's distance
  for (let i = segments.length - 1; i >= 0; i--) {
    if (dist >= segments[i].distance) {
      return segments[i];
    }
  }
  return segments[0];
}

function getCurrentSegmentIndex() {
  const course = COURSES[state.currentCourse];
  const segments = course.segments;
  const dist = state.currentDistance;

  for (let i = segments.length - 1; i >= 0; i--) {
    if (dist >= segments[i].distance) {
      return i;
    }
  }
  return 0;
}

function updateSegmentHighlight(currentSeg) {
  const items = document.querySelectorAll('#segmentList .segment-item');
  const course = COURSES[state.currentCourse];

  items.forEach((item, idx) => {
    if (course.segments[idx] && course.segments[idx].name === currentSeg.name &&
        course.segments[idx].distance === currentSeg.distance) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
  });
}

function updateDrowsiness(pct) {
  const bar = document.getElementById('drowsinessBar');
  const label = document.getElementById('drowsinessLabel');

  let barWidth, level, labelText;

  if (pct < 60) {
    level = 'low';
    // Map 0-60% progress to 20% bar width
    barWidth = 20;
    labelText = '低';
  } else if (pct < 80) {
    level = 'medium';
    // Map 60-80% progress to 20-50% bar width
    const t = (pct - 60) / 20;
    barWidth = 20 + t * 30;
    labelText = '中';
  } else {
    level = 'high';
    // Map 80-100% progress to 50-80% bar width
    const t = (pct - 80) / 20;
    barWidth = 50 + t * 30;
    labelText = '高';
  }

  bar.style.width = barWidth + '%';
  bar.classList.remove('medium', 'high');
  label.classList.remove('medium', 'high');

  if (level === 'medium') {
    bar.classList.add('medium');
    label.classList.add('medium');
  } else if (level === 'high') {
    bar.classList.add('high');
    label.classList.add('high');
  }

  label.textContent = labelText;
}

function updateNavDisplay() {
  const course = COURSES[state.currentCourse];
  const segments = course.segments;
  const currentIdx = getCurrentSegmentIndex();

  // Find next segment
  const nextIdx = currentIdx + 1;
  if (nextIdx >= segments.length) {
    // At the end
    document.getElementById('navPlace').textContent = segments[segments.length - 1].name;
    document.getElementById('navDistance').textContent = '到着しました';
    document.getElementById('navBarFill').style.width = '100%';
    return;
  }

  const nextSeg = segments[nextIdx];
  const distToNext = Math.max(0, nextSeg.distance - state.currentDistance);
  const currentSeg = segments[currentIdx];
  const segLength = nextSeg.distance - currentSeg.distance;

  // Progress within current segment
  let segProgress = 0;
  if (segLength > 0) {
    segProgress = Math.min(1, (state.currentDistance - currentSeg.distance) / segLength);
  }

  document.getElementById('navPlace').textContent = nextSeg.name;
  document.getElementById('navDistance').textContent = distToNext.toFixed(1) + ' km先';
  document.getElementById('navBarFill').style.width = (segProgress * 100) + '%';
  document.getElementById('navDirection').textContent = '↑';
}

// ===========================
// FIRE EVENT CHECKING
// ===========================

function checkFireEvents() {
  const positions = calculateFirePositions(state.currentCourse);
  const dist = state.currentDistance;

  if (!state.firedEvents.has(1) && dist >= positions.uc1) {
    triggerFireEvent(1, positions);
  } else if (!state.firedEvents.has(2) && dist >= positions.uc2) {
    triggerFireEvent(2, positions);
  } else if (!state.firedEvents.has(3) && dist >= positions.uc3) {
    triggerFireEvent(3, positions);
  }
}

function triggerFireEvent(ucNum, positions) {
  state.firedEvents.add(ucNum);
  state.activeProposal = ucNum;

  // Pause simulation so user can read the proposal
  state.isPlaying = false;
  stopPlayback();
  updatePlayPauseButton();

  // Pulse the marker
  const marker = document.getElementById('marker' + ucNum);
  marker.classList.add('fired');

  // Show proposal
  showProposal(ucNum);
}

function showProposal(ucNum) {
  const course = COURSES[state.currentCourse];

  // Build proposal content
  let icon, ucLabel, speech;

  const elapsedStr = formatElapsedTime(state.elapsedMinutes);

  if (ucNum === 1) {
    icon = state.uc1.drowsiness ? '💤' : '⏱️';
    ucLabel = 'UC①';
    const template = document.getElementById('uc1Speech').value;
    speech = template
      .replace(/\{time\}/g, elapsedStr)
      .replace(/\{restName\}/g, course.restFacility);
  } else if (ucNum === 2) {
    icon = '🎵';
    ucLabel = 'UC②';
    const template = document.getElementById('uc2Speech').value;
    speech = template
      .replace(/\{restName\}/g, course.restFacility);
  } else {
    icon = '🛏️';
    ucLabel = 'UC③';
    const template = document.getElementById('uc3Speech').value;
    speech = template
      .replace(/\{restName\}/g, course.restFacility)
      .replace(/\{restMethod\}/g, state.uc3.restMethod)
      .replace(/\{restTime\}/g, state.uc3.restTime);
  }

  document.getElementById('proposalIcon').textContent = icon;
  document.getElementById('proposalUC').textContent = ucLabel;
  document.getElementById('proposalSpeech').textContent = speech;

  // Trigger reason and warning (Fix 3)
  const triggerEl = document.getElementById('proposalTrigger');
  const warningEl = document.getElementById('proposalWarning');

  if (ucNum === 1) {
    // Build trigger reason
    const reasons = [];
    reasons.push('走行時間 ' + elapsedStr);
    if (state.uc1.drowsiness) reasons.push('眠気サイン検知');
    if (state.uc1.steering) reasons.push('操舵異常検知');
    triggerEl.textContent = '検知根拠: ' + reasons.join(' ＋ ');
    triggerEl.style.display = 'block';

    // Show warning if no detection signals
    warningEl.classList.remove('visible');
    if (!state.uc1.drowsiness && !state.uc1.steering) {
      warningEl.textContent = '⚠ 眠気サイン・操舵異常ともに未検知';
      warningEl.classList.add('visible');
    } else if (!state.uc1.drowsiness) {
      warningEl.textContent = '⚠ 眠気の兆候が確認されていません';
      warningEl.classList.add('visible');
    } else if (!state.uc1.steering) {
      warningEl.textContent = '⚠ 操舵異常が確認されていません';
      warningEl.classList.add('visible');
    }
  } else {
    triggerEl.style.display = 'none';
    warningEl.classList.remove('visible');
  }

  // Switch cockpit view
  document.getElementById('cockpitNav').classList.add('hidden');
  document.getElementById('cockpitProposal').classList.add('visible');
}

function dismissProposal() {
  state.activeProposal = null;
  document.getElementById('cockpitNav').classList.remove('hidden');
  document.getElementById('cockpitProposal').classList.remove('visible');
  // Hide trigger and warning elements
  const triggerEl = document.getElementById('proposalTrigger');
  const warningEl = document.getElementById('proposalWarning');
  if (triggerEl) triggerEl.style.display = 'none';
  if (warningEl) warningEl.classList.remove('visible');
}

function formatElapsedTime(minutes) {
  const totalSecs = Math.floor(minutes * 60);
  const mm = Math.floor(totalSecs / 60);
  const ss = totalSecs % 60;
  if (mm > 0) {
    return mm + '分' + (ss > 0 ? ss + '秒' : '');
  }
  return ss + '秒';
}

// ===========================
// PLAY/PAUSE
// ===========================

function updatePlayPauseButton() {
  const btn = document.getElementById('playPauseBtn');
  if (state.isPlaying) {
    btn.textContent = '⏸ 一時停止';
    btn.classList.add('playing');
  } else {
    btn.textContent = '▶ 再生';
    btn.classList.remove('playing');
  }
}

// ===========================
// COURSE SWITCHING
// ===========================

function switchCourse(newCourseKey) {
  const oldCourse = COURSES[state.currentCourse];
  const oldPositions = calculateFirePositions(state.currentCourse);
  const oldRestFacility = oldCourse.restFacility;
  const oldCourseName = oldCourse.name;

  state.currentCourse = newCourseKey;

  // Reset playback
  state.isPlaying = false;
  stopPlayback();
  state.currentDistance = 0;
  state.elapsedMinutes = 0;
  state.firedEvents = new Set();
  updatePlayPauseButton();

  // Dismiss any active proposal
  dismissProposal();

  // Render course with animation
  renderCourse(true);

  // Calculate new positions for toast
  const newCourse = COURSES[newCourseKey];
  const newPositions = calculateFirePositions(newCourseKey);
  const newRestFacility = newCourse.restFacility;
  const newCourseName = newCourse.name;

  // Update UI to reflect reset
  updateUI();

  // Show toast
  const toastMsg = 'コース変更: ' + oldCourseName + ' → ' + newCourseName +
    ' | 休憩施設: ' + oldRestFacility + ' → ' + newRestFacility +
    ' | ①' + oldPositions.uc1.toFixed(1) + 'km→' + newPositions.uc1.toFixed(1) + 'km' +
    ' ②' + oldPositions.uc2.toFixed(1) + 'km→' + newPositions.uc2.toFixed(1) + 'km' +
    ' ③' + oldPositions.uc3.toFixed(1) + 'km→' + newPositions.uc3.toFixed(1) + 'km';
  showToast(toastMsg);
}

// ===========================
// PROGRESS BAR SCRUBBING
// ===========================

function getProgressFromEvent(e, track) {
  const rect = track.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
  return x / rect.width;
}

function scrubToProgress(progress) {
  const course = COURSES[state.currentCourse];
  state.currentDistance = progress * course.totalDistance;
  state.elapsedMinutes = progress * course.totalDuration;

  // Reset firedEvents for events whose position is ahead of current position
  const positions = calculateFirePositions(state.currentCourse);
  if (state.currentDistance < positions.uc1) state.firedEvents.delete(1);
  if (state.currentDistance < positions.uc2) state.firedEvents.delete(2);
  if (state.currentDistance < positions.uc3) state.firedEvents.delete(3);

  updateUI();
}

// ===========================
// INIT
// ===========================

function init() {
  // Render initial course (no animation)
  renderCourse(false);
  updateUI();

  // ---- Play/Pause button ----
  document.getElementById('playPauseBtn').addEventListener('click', () => {
    const course = COURSES[state.currentCourse];
    // If at end, restart
    if (state.currentDistance >= course.totalDistance) {
      state.currentDistance = 0;
      state.elapsedMinutes = 0;
      state.firedEvents = new Set();
      updateUI();
    }

    state.isPlaying = !state.isPlaying;
    updatePlayPauseButton();

    if (state.isPlaying) {
      startPlayback();
    } else {
      stopPlayback();
    }
  });

  // ---- Speed buttons ----
  document.querySelectorAll('.speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.speedMultiplier = parseInt(btn.dataset.speed, 10);
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // ---- Course select ----
  document.getElementById('courseSelect').addEventListener('change', (e) => {
    switchCourse(e.target.value);
  });

  // ---- Progress bar scrubbing ----
  const progressTrack = document.getElementById('progressTrack');

  progressTrack.addEventListener('mousedown', (e) => {
    isScrubbing = true;
    const wasPlaying = state.isPlaying;
    if (state.isPlaying) {
      state.isPlaying = false;
      stopPlayback();
      updatePlayPauseButton();
    }
    progressTrack._wasPlaying = wasPlaying;
    scrubToProgress(getProgressFromEvent(e, progressTrack));
  });

  document.addEventListener('mousemove', (e) => {
    if (!isScrubbing) return;
    scrubToProgress(getProgressFromEvent(e, progressTrack));
  });

  document.addEventListener('mouseup', (e) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    scrubToProgress(getProgressFromEvent(e, progressTrack));
    // Resume if was playing
    if (progressTrack._wasPlaying) {
      const course = COURSES[state.currentCourse];
      if (state.currentDistance < course.totalDistance) {
        state.isPlaying = true;
        updatePlayPauseButton();
        startPlayback();
      }
      progressTrack._wasPlaying = false;
    }
  });

  // Also handle click (mousedown+mouseup at same position already handles this,
  // but add click for cases that might slip through)
  progressTrack.addEventListener('click', (e) => {
    scrubToProgress(getProgressFromEvent(e, progressTrack));
  });

  // ---- Proposal close button ----
  document.getElementById('proposalClose').addEventListener('click', () => {
    dismissProposal();
  });

  // Proposal option buttons also dismiss
  document.querySelectorAll('.proposal-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      dismissProposal();
    });
  });

  // ---- UC Card Accordion ----
  document.querySelectorAll('.uc-card-header').forEach(header => {
    header.addEventListener('click', () => {
      const ucNum = header.dataset.uc;
      const card = document.getElementById('ucCard' + ucNum);
      const isOpen = card.classList.contains('open');

      // Close all cards
      document.querySelectorAll('.uc-card').forEach(c => c.classList.remove('open'));

      // Toggle clicked card
      if (!isOpen) {
        card.classList.add('open');
      }
    });
  });

  // ---- UC Form Handlers ----

  // UC1 time threshold
  const uc1TimeThreshold = document.getElementById('uc1TimeThreshold');
  const uc1TimeThresholdVal = document.getElementById('uc1TimeThresholdVal');
  uc1TimeThreshold.addEventListener('input', () => {
    const val = parseInt(uc1TimeThreshold.value, 10);
    state.uc1.timeThreshold = val;
    uc1TimeThresholdVal.textContent = val + '分';
    updateFirePositions();
  });

  // UC1 drowsiness toggle
  const uc1Drowsiness = document.getElementById('uc1Drowsiness');
  uc1Drowsiness.addEventListener('change', () => {
    state.uc1.drowsiness = uc1Drowsiness.checked;
    // Update toggle label (find sibling .toggle-label)
    const label = uc1Drowsiness.closest('.toggle-switch').querySelector('.toggle-label');
    if (label) label.textContent = uc1Drowsiness.checked ? 'ON' : 'OFF';
  });

  // UC1 steering toggle
  const uc1Steering = document.getElementById('uc1Steering');
  uc1Steering.addEventListener('change', () => {
    state.uc1.steering = uc1Steering.checked;
    const label = uc1Steering.closest('.toggle-switch').querySelector('.toggle-label');
    if (label) label.textContent = uc1Steering.checked ? 'ON' : 'OFF';
  });

  // UC1 combined threshold
  const uc1CombinedThreshold = document.getElementById('uc1CombinedThreshold');
  const uc1CombinedThresholdVal = document.getElementById('uc1CombinedThresholdVal');
  uc1CombinedThreshold.addEventListener('input', () => {
    const val = parseInt(uc1CombinedThreshold.value, 10);
    state.uc1.combinedThreshold = val;
    uc1CombinedThresholdVal.textContent = val;
  });

  // UC2 alertness method
  document.getElementById('uc2AlertnessMethod').addEventListener('change', (e) => {
    state.uc2.alertnessMethod = e.target.value;
  });

  // UC3 rest method
  document.getElementById('uc3RestMethod').addEventListener('change', (e) => {
    state.uc3.restMethod = e.target.value;
  });

  // UC3 rest time
  document.getElementById('uc3RestTime').addEventListener('change', (e) => {
    state.uc3.restTime = e.target.value;
  });
}

// ===========================
// START
// ===========================

document.addEventListener('DOMContentLoaded', init);
