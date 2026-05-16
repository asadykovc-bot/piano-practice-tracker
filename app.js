const STORAGE_KEY = "piano-practice-tracker:v1";
const DEFAULT_BPM = 80;

const state = {
  entries: {},
  sessionSeconds: 0,
  startedAt: null,
  running: false,
  stopwatchVisible: false,
  bpm: DEFAULT_BPM,
  metronomeRunning: false,
  audioContext: null,
  metronomeTimer: null,
  wakeLock: null,
};

const els = {
  runStatus: document.getElementById("runStatus"),
  runStatusText: document.getElementById("runStatusText"),
  todayTotal: document.getElementById("todayTotal"),
  compactSessionTime: document.getElementById("compactSessionTime"),
  stopwatch: document.getElementById("stopwatch"),
  timeDetails: document.getElementById("timeDetails"),
  stopwatchWrap: document.getElementById("stopwatchWrap"),
  quietSession: document.getElementById("quietSession"),
  toggleStopwatch: document.getElementById("toggleStopwatch"),
  toggleStopwatchText: document.getElementById("toggleStopwatchText"),
  toggleStopwatchIcon: document.getElementById("toggleStopwatchIcon"),
  startPauseButton: document.getElementById("startPauseButton"),
  saveButton: document.getElementById("saveButton"),
  wakeStatus: document.getElementById("wakeStatus"),
  wakeStatusText: document.getElementById("wakeStatusText"),
  metronomeToggle: document.getElementById("metronomeToggle"),
  pendulum: document.getElementById("pendulum"),
  bpmInput: document.getElementById("bpmInput"),
  bpmDown: document.getElementById("bpmDown"),
  bpmUp: document.getElementById("bpmUp"),
  weekAverage: document.getElementById("weekAverage"),
  monthAverage: document.getElementById("monthAverage"),
  weekTotal: document.getElementById("weekTotal"),
  monthTotal: document.getElementById("monthTotal"),
  weekChart: document.getElementById("weekChart"),
  historyList: document.getElementById("historyList"),
  exportButton: document.getElementById("exportButton"),
  importInput: document.getElementById("importInput"),
  clearButton: document.getElementById("clearButton"),
  dataMessage: document.getElementById("dataMessage"),
};

function todayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function getCurrentSessionSeconds() {
  if (!state.running || !state.startedAt) {
    return state.sessionSeconds;
  }

  return state.sessionSeconds + Math.floor((Date.now() - state.startedAt) / 1000);
}

function formatDuration(seconds, compact = false) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (!compact) {
    return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${secs}s`;
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (saved && typeof saved.entries === "object") {
      state.entries = normalizeEntries(saved.entries);
    }
    if (Number.isFinite(saved.bpm)) {
      state.bpm = clampBpm(saved.bpm);
    }
  } catch {
    state.entries = {};
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      entries: state.entries,
      bpm: state.bpm,
      updatedAt: new Date().toISOString(),
    })
  );
}

function normalizeEntries(entries) {
  return Object.entries(entries).reduce((acc, [date, seconds]) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Number(seconds))) {
      acc[date] = Math.max(0, Math.round(Number(seconds)));
    }
    return acc;
  }, {});
}

function clampBpm(value) {
  return Math.min(240, Math.max(30, Math.round(Number(value) || DEFAULT_BPM)));
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) {
    els.wakeStatus.classList.remove("active");
    els.wakeStatusText.textContent = "Screen wake lock is not supported in this browser.";
    return;
  }

  if (!state.running || document.visibilityState !== "visible") {
    return;
  }

  try {
    state.wakeLock = await navigator.wakeLock.request("screen");
    state.wakeLock.addEventListener("release", () => {
      state.wakeLock = null;
      if (state.running) {
        els.wakeStatus.classList.remove("active");
        els.wakeStatusText.textContent = "Screen wake lock was interrupted.";
      }
    });
    els.wakeStatus.classList.add("active");
    els.wakeStatusText.textContent = "Screen wake lock is active.";
  } catch {
    els.wakeStatus.classList.remove("active");
    els.wakeStatusText.textContent = "Screen wake lock could not be started.";
  }
}

async function releaseWakeLock() {
  if (state.wakeLock) {
    await state.wakeLock.release();
    state.wakeLock = null;
  }
  els.wakeStatus.classList.remove("active");
  els.wakeStatusText.textContent = "Screen wake lock will start with practice when supported.";
}

function startPractice() {
  state.running = true;
  state.startedAt = Date.now();
  requestWakeLock();
  render();
}

function pausePractice() {
  state.sessionSeconds = getCurrentSessionSeconds();
  state.startedAt = null;
  state.running = false;
  releaseWakeLock();
  render();
}

function saveToday() {
  const seconds = getCurrentSessionSeconds();
  if (seconds <= 0) {
    return;
  }

  pausePractice();
  const key = todayKey();
  state.entries[key] = (state.entries[key] || 0) + seconds;
  state.sessionSeconds = 0;
  saveState();
  render();
}

function setStopwatchVisible(visible) {
  state.stopwatchVisible = visible;
  els.timeDetails.hidden = !visible;
  els.quietSession.hidden = visible;
  els.toggleStopwatch.setAttribute("aria-expanded", String(visible));
  els.toggleStopwatchText.textContent = visible ? "Hide Stopwatch" : "Show Stopwatch";
  els.toggleStopwatchIcon.textContent = visible ? "◴" : "◷";
}

function getAudioContext() {
  if (!state.audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass();
  }
  return state.audioContext;
}

function tick() {
  const context = getAudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillator.frequency.setValueAtTime(980, now);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.32, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.06);
}

async function startMetronome() {
  const context = getAudioContext();
  if (context.state === "suspended") {
    await context.resume();
  }

  state.metronomeRunning = true;
  tick();
  state.metronomeTimer = window.setInterval(tick, 60000 / state.bpm);
  renderMetronome();
}

function stopMetronome() {
  state.metronomeRunning = false;
  window.clearInterval(state.metronomeTimer);
  state.metronomeTimer = null;
  renderMetronome();
}

function restartMetronomeIfNeeded() {
  if (!state.metronomeRunning) {
    renderMetronome();
    return;
  }

  window.clearInterval(state.metronomeTimer);
  tick();
  state.metronomeTimer = window.setInterval(tick, 60000 / state.bpm);
  renderMetronome();
}

function setBpm(value) {
  state.bpm = clampBpm(value);
  els.bpmInput.value = String(state.bpm);
  document.documentElement.style.setProperty("--beat-duration", `${60000 / state.bpm}ms`);
  saveState();
  restartMetronomeIfNeeded();
}

function rangeDays(count) {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => todayKey(addDays(today, index - count + 1)));
}

function totalForDays(count) {
  return rangeDays(count).reduce((total, date) => total + (state.entries[date] || 0), 0);
}

function renderStatus() {
  els.runStatus.classList.toggle("running", state.running);
  els.runStatus.classList.toggle("paused", !state.running && state.sessionSeconds > 0);
  els.runStatusText.textContent = state.running ? "Recording" : state.sessionSeconds > 0 ? "Paused" : "Ready";
  els.startPauseButton.textContent = state.running ? "Pause" : state.sessionSeconds > 0 ? "Resume" : "Start Practice";
  els.saveButton.disabled = getCurrentSessionSeconds() <= 0;
}

function renderStats() {
  const weekTotal = totalForDays(7);
  const monthTotal = totalForDays(30);
  els.weekAverage.textContent = formatDuration(weekTotal / 7, true);
  els.monthAverage.textContent = formatDuration(monthTotal / 30, true);
  els.weekTotal.textContent = formatDuration(weekTotal, true);
  els.monthTotal.textContent = formatDuration(monthTotal, true);

  const days = rangeDays(7);
  const max = Math.max(...days.map((date) => state.entries[date] || 0), 1);
  els.weekChart.innerHTML = days
    .map((date) => {
      const seconds = state.entries[date] || 0;
      const height = Math.max(5, Math.round((seconds / max) * 96));
      const label = date.slice(5).replace("-", "/");
      return `<div class="bar-wrap" title="${label}: ${formatDuration(seconds, true)}">
        <div class="bar" style="height: ${height}px"></div>
        <div class="bar-label">${label}</div>
      </div>`;
    })
    .join("");

  const entries = Object.entries(state.entries).sort(([a], [b]) => b.localeCompare(a));
  if (!entries.length) {
    els.historyList.innerHTML = '<div class="history-empty">No practice saved yet.</div>';
    return;
  }

  els.historyList.innerHTML = entries
    .map(([date, seconds]) => `<div class="history-item"><time datetime="${date}">${date}</time><span>${formatDuration(seconds, true)}</span></div>`)
    .join("");
}

function renderMetronome() {
  els.metronomeToggle.textContent = state.metronomeRunning ? "Stop" : "Start";
  els.pendulum.classList.toggle("active", state.metronomeRunning);
  document.documentElement.style.setProperty("--beat-duration", `${60000 / state.bpm}ms`);
}

function render() {
  const currentSession = getCurrentSessionSeconds();
  els.todayTotal.textContent = formatDuration(state.entries[todayKey()] || 0, true);
  els.compactSessionTime.textContent = formatDuration(currentSession, true);
  els.stopwatch.textContent = formatDuration(currentSession);
  renderStatus();
  renderStats();
}

function exportHistory() {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    entries: state.entries,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `piano-practice-history-${todayKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  els.dataMessage.textContent = "History exported.";
}

function importHistory(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const payload = JSON.parse(String(reader.result || "{}"));
      const incoming = normalizeEntries(payload.entries || payload);
      const incomingCount = Object.keys(incoming).length;

      if (!incomingCount) {
        els.dataMessage.textContent = "No valid entries found in that file.";
        return;
      }

      for (const [date, seconds] of Object.entries(incoming)) {
        state.entries[date] = (state.entries[date] || 0) + seconds;
      }

      saveState();
      render();
      els.dataMessage.textContent = `Imported ${incomingCount} day${incomingCount === 1 ? "" : "s"} and merged by date.`;
    } catch {
      els.dataMessage.textContent = "Could not import that file.";
    }
  });
  reader.readAsText(file);
}

function clearHistory() {
  if (!confirm("Clear all saved practice history?")) {
    return;
  }

  state.entries = {};
  saveState();
  render();
  els.dataMessage.textContent = "History cleared.";
}

function bindEvents() {
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-button").forEach((nav) => nav.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });

  els.toggleStopwatch.addEventListener("click", () => setStopwatchVisible(!state.stopwatchVisible));
  els.startPauseButton.addEventListener("click", () => (state.running ? pausePractice() : startPractice()));
  els.saveButton.addEventListener("click", saveToday);
  els.metronomeToggle.addEventListener("click", () => (state.metronomeRunning ? stopMetronome() : startMetronome()));
  els.bpmDown.addEventListener("click", () => setBpm(state.bpm - 1));
  els.bpmUp.addEventListener("click", () => setBpm(state.bpm + 1));
  els.bpmInput.addEventListener("change", () => setBpm(els.bpmInput.value));
  els.exportButton.addEventListener("click", exportHistory);
  els.importInput.addEventListener("change", () => {
    const file = els.importInput.files && els.importInput.files[0];
    if (file) {
      importHistory(file);
    }
    els.importInput.value = "";
  });
  els.clearButton.addEventListener("click", clearHistory);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.running) {
      requestWakeLock();
      render();
    }
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./service-worker.js?v=3").catch(() => {});
  }
}

loadState();
bindEvents();
setStopwatchVisible(false);
setBpm(state.bpm);
renderMetronome();
render();
registerServiceWorker();
window.setInterval(render, 500);
