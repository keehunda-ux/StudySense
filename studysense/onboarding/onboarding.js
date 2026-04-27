document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('get-started-btn').addEventListener('click', () => goTo(2));
  document.getElementById('canvas-next-btn').addEventListener('click', saveCanvas);
  document.getElementById('claude-next-btn').addEventListener('click', saveClaude);
  document.getElementById('open-canvas-btn').addEventListener('click', openCanvas);
});

let currentScreen = 1;

function goTo(n) {
  document.getElementById(`screen-${currentScreen}`).classList.remove('active');
  document.getElementById(`screen-${n}`).classList.add('active');
  currentScreen = n;
}

async function saveCanvas() {
  const input = document.getElementById('canvas-token');
  const err = document.getElementById('canvas-error');
  const btn = document.getElementById('canvas-next-btn');
  const token = input.value.trim();

  err.style.display = 'none';
  input.classList.remove('error');

  if (!token) {
    input.classList.add('error');
    err.textContent = 'Please enter your Canvas API token.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch('https://usfca.instructure.com/api/v1/users/self', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) throw new Error('invalid');
    if (!res.ok) throw new Error('network');
    await chrome.storage.local.set({ canvas_token: token });
    goTo(3);
  } catch (e) {
    input.classList.add('error');
    err.textContent = e.message === 'invalid'
      ? 'Token invalid or expired. Please generate a new one.'
      : 'Could not reach Canvas. Check your connection.';
    err.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continue →';
  }
}

async function saveClaude() {
  const input = document.getElementById('claude-key');
  const err = document.getElementById('claude-error');
  const btn = document.getElementById('claude-next-btn');
  const key = input.value.trim();

  err.style.display = 'none';
  input.classList.remove('error');

  if (!key || !key.startsWith('sk-ant-')) {
    input.classList.add('error');
    err.textContent = 'Please enter a valid Anthropic API key (starts with sk-ant-).';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Starting analysis...';

  await chrome.storage.local.set({ claude_key: key, onboarded: true });
  goTo(4);
  runFirstAnalysis();
}

function runFirstAnalysis() {
  const msgEl = document.getElementById('loading-message');

  chrome.runtime.sendMessage({ type: 'REFRESH' }, (res) => {
    if (chrome.runtime.lastError) {
      msgEl.textContent = `Connection error: ${chrome.runtime.lastError.message}`;
      return;
    }
    if (!res?.ok) {
      if (res?.error === 'CLAUDE_UNAUTHORIZED') {
        const errEl = document.getElementById('claude-error');
        errEl.textContent = 'API key rejected. Double-check it at console.anthropic.com and re-enter.';
        errEl.style.display = 'block';
        document.getElementById('claude-key').classList.add('error');
        goTo(3);
        return;
      }
      msgEl.textContent = `Analysis error: ${res?.error || 'Unknown error'}`;
      return;
    }
    showFirstInsight(res.result);
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'PROGRESS' && msg.message !== 'done') {
      msgEl.textContent = msg.message;
    }
  });
}

function showFirstInsight(analysis) {
  goTo(5);
  const container = document.getElementById('first-insight-content');
  if (!analysis) {
    container.innerHTML = '<p>Analysis complete. Open Canvas to see your full dashboard.</p>';
    return;
  }

  const dirMap = {
    gaining_ground: { cls: 'momentum-gaining', label: '▲ Gaining Ground' },
    holding_steady: { cls: 'momentum-holding', label: '● Holding Steady' },
    losing_ground: { cls: 'momentum-losing', label: '▼ Losing Ground' },
  };
  const dir = dirMap[analysis.momentum?.direction] || dirMap.holding_steady;

  const topAlert = (analysis.critical_alerts || [])[0];

  container.innerHTML = `
    <div class="insight-card">
      <div class="insight-momentum ${dir.cls}">${dir.label}</div>
      <div class="insight-alert">${esc(analysis.momentum?.summary || '')}</div>
    </div>
    ${topAlert ? `
    <div class="insight-card">
      <div class="insight-momentum" style="font-size:13px;color:#e8e8f0">${esc(topAlert.headline)}</div>
      <div class="insight-alert" style="margin-top:6px">${esc(topAlert.detail)}</div>
      <div class="insight-alert" style="margin-top:6px;color:#4ade80">→ ${esc(topAlert.action)}</div>
    </div>` : ''}
    <p style="color:#7070a0;font-size:11px;margin-bottom:16px">
      ${(analysis.critical_alerts || []).length} alert(s) ·
      ${(analysis.behavioral_patterns || []).length} pattern(s) detected
    </p>
  `;
}

function openCanvas() {
  chrome.tabs.create({ url: 'https://usfca.instructure.com' });
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
