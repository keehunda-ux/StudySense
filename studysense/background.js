import { fetchAllData } from './api/canvas.js';
import { analyzeWithClaude } from './api/claude.js';
import { buildSchema } from './utils/parser.js';
import {
  getCanvasToken, getClaudeKey, isOnboarded,
  setRawData, getRawData,
  setAnalysis, getAnalysis, forceGetAnalysis,
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
  await runAnalysisCycle(false);
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'REFRESH') {
    runAnalysisCycle(true)
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

  if (msg.type === 'RUN_FIRST_ANALYSIS') {
    runAnalysisCycle(true, msg.onProgress)
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function runAnalysisCycle(forceRefresh = false, progressCallback) {
  const canvasToken = await getCanvasToken();
  const claudeKey = await getClaudeKey();
  if (!canvasToken || !claudeKey) return null;

  const progress = progressCallback || (() => {});

  let raw = forceRefresh ? null : await getRawData();

  if (!raw) {
    raw = await fetchAllData(canvasToken, (msg) => {
      broadcastProgress(msg);
      progress(msg);
    });
    await setRawData(raw);
  }

  const schema = buildSchema(raw);
  broadcastProgress('Running AI analysis...');

  const previousAnalysis = await forceGetAnalysis();
  const analysis = await analyzeWithClaude(schema, claudeKey);
  await setAnalysis(analysis);

  if (previousAnalysis) {
    const prevCritical = (previousAnalysis.critical_alerts || []).map(a => a.id).sort().join(',');
    const newCritical = (analysis.critical_alerts || []).map(a => a.id).sort().join(',');
    if (prevCritical !== newCritical) {
      notifyNewAlerts(analysis);
    }
  }

  broadcastProgress('done');
  return analysis;
}

function broadcastProgress(message) {
  // Send to popup and any other extension pages
  chrome.runtime.sendMessage({ type: 'PROGRESS', message }).catch(() => {});
  // Send to Canvas tabs (for sidebar iframe)
  chrome.tabs.query({ url: 'https://usfca.instructure.com/*' }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { type: 'PROGRESS', message }).catch(() => {});
    }
  });
}

function notifyNewAlerts(analysis) {
  const critical = (analysis.critical_alerts || []).filter(a => a.urgency === 'critical');
  if (critical.length === 0) return;

  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: 'StudySense Alert',
    message: critical[0].headline,
    priority: 2,
  });
}
