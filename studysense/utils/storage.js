const KEYS = {
  CANVAS_TOKEN: 'canvas_token',
  CLAUDE_KEY: 'claude_key',
  RAW_DATA: 'raw_canvas_data',
  RAW_DATA_TS: 'raw_canvas_data_ts',
  ANALYSIS: 'claude_analysis',
  ANALYSIS_TS: 'claude_analysis_ts',
  ONBOARDED: 'onboarded',
  STUDENT: 'student_profile',
};

const TTL = {
  RAW_DATA: 30 * 60 * 1000,
  ANALYSIS: 2 * 60 * 60 * 1000,
};

async function get(key) {
  return new Promise((resolve) => {
    chrome.storage.local.get(key, (result) => resolve(result[key]));
  });
}

async function set(key, value) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, resolve);
  });
}

async function getCanvasToken() { return get(KEYS.CANVAS_TOKEN); }
async function setCanvasToken(token) { return set(KEYS.CANVAS_TOKEN, token); }
async function getClaudeKey() { return get(KEYS.CLAUDE_KEY); }
async function setClaudeKey(key) { return set(KEYS.CLAUDE_KEY, key); }
async function isOnboarded() { return get(KEYS.ONBOARDED); }
async function setOnboarded() { return set(KEYS.ONBOARDED, true); }

async function setRawData(data) {
  await set(KEYS.RAW_DATA, data);
  await set(KEYS.RAW_DATA_TS, Date.now());
}

async function getRawData() {
  const ts = await get(KEYS.RAW_DATA_TS);
  if (!ts || Date.now() - ts > TTL.RAW_DATA) return null;
  return get(KEYS.RAW_DATA);
}

async function setAnalysis(analysis) {
  await set(KEYS.ANALYSIS, analysis);
  await set(KEYS.ANALYSIS_TS, Date.now());
}

async function getAnalysis() {
  const ts = await get(KEYS.ANALYSIS_TS);
  if (!ts || Date.now() - ts > TTL.ANALYSIS) return null;
  return get(KEYS.ANALYSIS);
}

async function getAnalysisAge() {
  const ts = await get(KEYS.ANALYSIS_TS);
  if (!ts) return null;
  return Date.now() - ts;
}

async function getRawAge() {
  const ts = await get(KEYS.RAW_DATA_TS);
  if (!ts) return null;
  return Date.now() - ts;
}

async function forceGetAnalysis() {
  return get(KEYS.ANALYSIS);
}

async function setStudent(profile) { return set(KEYS.STUDENT, profile); }
async function getStudent() { return get(KEYS.STUDENT); }

async function clearAll() {
  return new Promise((resolve) => chrome.storage.local.clear(resolve));
}

export {
  KEYS, TTL,
  get, set,
  getCanvasToken, setCanvasToken,
  getClaudeKey, setClaudeKey,
  isOnboarded, setOnboarded,
  setRawData, getRawData,
  setAnalysis, getAnalysis, getAnalysisAge, forceGetAnalysis,
  setStudent, getStudent,
  clearAll,
};
