import { fetchAllData } from './api/canvas.js';
import { analyzeWithClaude, chatWithClaude } from './api/claude.js';
import { buildSchema } from './utils/parser.js';
import {
  getCanvasToken, getClaudeKey, isOnboarded,
  setRawData, getRawData,
  setAnalysis, getAnalysis, forceGetAnalysis,
  getExcludedCourses, setExcludedCourses,
  getCourseList, setCourseList,
  getDismissedAlerts, addDismissedAlert, clearDismissedAlerts,
} from './utils/storage.js';

const ALARM_NAME = 'studysense_refresh';
const ALARM_PERIOD_MINUTES = 180;

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  const onboarded = await isOnboarded();
  if (!onboarded) return;
  await runAnalysisCycle({ forceCanvasFetch: false });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Full refresh: re-fetch Canvas data + re-run Claude
  if (msg.type === 'REFRESH') {
    runAnalysisCycle({ forceCanvasFetch: true })
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Re-analyze only: use cached Canvas data, re-run Claude with current filters
  if (msg.type === 'REANALYZE') {
    runAnalysisCycle({ forceCanvasFetch: false })
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === 'GET_ANALYSIS') {
    getAnalysis()
      .then(analysis => {
        if (analysis) return sendResponse({ ok: true, analysis });
        return forceGetAnalysis().then(a => sendResponse({ ok: true, analysis: a }));
      })
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Returns the full course list + current exclusions for the sidebar UI
  if (msg.type === 'GET_COURSES') {
    Promise.all([getCourseList(), getExcludedCourses()])
      .then(([courses, excluded]) => sendResponse({ ok: true, courses, excluded }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Save updated exclusion list (array of course ID strings)
  if (msg.type === 'SAVE_EXCLUSIONS') {
    setExcludedCourses(msg.ids)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Dismiss a single alert by headline
  if (msg.type === 'DISMISS_ALERT') {
    addDismissedAlert(msg.headline)
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // Chat: answer a question using the stored analysis as context
  if (msg.type === 'CHAT') {
    handleChat(msg)
      .then(reply => sendResponse({ ok: true, reply }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

// ── Core analysis cycle ──────────────────────────────────────────────────────

async function runAnalysisCycle({ forceCanvasFetch = false } = {}) {
  const canvasToken = await getCanvasToken();
  const claudeKey = await getClaudeKey();
  if (!canvasToken || !claudeKey) return null;

  // ── Step 1: Canvas data (cached or fresh) ──
  let raw = forceCanvasFetch ? null : await getRawData();
  if (!raw) {
    raw = await fetchAllData(canvasToken, (msg) => broadcastProgress(msg));
    await setRawData(raw);
    // Persist the full course list so the sidebar can render toggles
    await setCourseList(
      (raw.courses || []).map(c => ({ id: String(c.id), name: c.name, code: c.course_code }))
    );
  }

  // ── Step 2: Apply user-defined filters ──
  const [excludedIds, dismissedAlerts] = await Promise.all([
    getExcludedCourses(),
    getDismissedAlerts(),
  ]);
  const filteredRaw = applyFilters(raw, excludedIds);

  // ── Step 3: Build schema + run Claude ──
  broadcastProgress('Running AI analysis…');
  const schema = buildSchema(filteredRaw);
  const previousAnalysis = await forceGetAnalysis();
  const analysis = await analyzeWithClaude(schema, claudeKey, {
    excludedIds,
    dismissedAlerts,
    allCourses: raw.courses || [],
  });
  await setAnalysis(analysis);

  // Notify if critical alerts changed
  if (previousAnalysis) {
    const prevIds = (previousAnalysis.critical_alerts || []).map(a => a.id).sort().join(',');
    const newIds  = (analysis.critical_alerts || []).map(a => a.id).sort().join(',');
    if (prevIds !== newIds) notifyNewAlerts(analysis);
  }

  broadcastProgress('done');
  return analysis;
}

// ── Chat ─────────────────────────────────────────────────────────────────────

async function handleChat({ history }) {
  const [claudeKey, analysis, courseList, excludedIds] = await Promise.all([
    getClaudeKey(),
    forceGetAnalysis(),
    getCourseList(),
    getExcludedCourses(),
  ]);
  if (!claudeKey) throw new Error('No Claude API key configured.');
  return chatWithClaude({ history, analysis, courseList, excludedIds, claudeKey });
}

// ── Filter raw Canvas data by excluded course IDs ────────────────────────────

function applyFilters(raw, excludedIds) {
  if (!excludedIds || excludedIds.length === 0) return raw;

  const excSet = new Set(excludedIds.map(String));

  const courses = (raw.courses || []).filter(c => !excSet.has(String(c.id)));

  const assignmentsByCourse = {};
  for (const [cid, assignments] of Object.entries(raw.assignmentsByCourse || {})) {
    if (!excSet.has(String(cid))) assignmentsByCourse[cid] = assignments;
  }

  const submissionsByCourse = {};
  for (const [cid, subs] of Object.entries(raw.submissionsByCourse || {})) {
    if (!excSet.has(String(cid))) submissionsByCourse[cid] = subs;
  }

  const missing = (raw.missing || []).filter(m => !excSet.has(String(m.course_id)));
  const upcoming = (raw.upcoming || []).filter(u => !excSet.has(String(u.assignment?.course_id)));

  return { ...raw, courses, assignmentsByCourse, submissionsByCourse, missing, upcoming };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function broadcastProgress(message) {
  chrome.runtime.sendMessage({ type: 'PROGRESS', message }).catch(() => {});
  chrome.tabs.query({ url: 'https://usfca.instructure.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'PROGRESS', message }).catch(() => {});
    }
  });
}

function notifyNewAlerts(analysis) {
  const critical = (analysis.critical_alerts || []).filter(a => a.urgency === 'critical');
  if (!critical.length) return;
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'StudySense Alert',
    message: critical[0].headline,
    priority: 2,
  });
}
