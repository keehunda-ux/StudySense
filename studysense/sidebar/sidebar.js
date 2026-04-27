/* Sidebar UI logic — runs inside the injected iframe on Canvas */

const $ = id => document.getElementById(id);

let currentAnalysis = null;
let isRefreshing = false;

function init() {
  $('ss-tab').addEventListener('click', openSidebar);
  $('ss-close-btn').addEventListener('click', closeSidebar);
  $('ss-expand-btn').addEventListener('click', openFullscreen);
  $('ss-refresh-btn').addEventListener('click', triggerRefresh);

  document.querySelectorAll('.ss-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const icon = btn.querySelector('.ss-toggle-icon');
      target.classList.toggle('hidden');
      icon.classList.toggle('open');
    });
  });

  chrome.runtime.onMessage.addListener(handleMessage);
  loadAnalysis();
}

function handleMessage(msg) {
  if (msg.type === 'PROGRESS') updateProgress(msg.message);
}

function updateProgress(message) {
  if (message === 'done') {
    loadAnalysis();
    return;
  }
  $('ss-alerts').innerHTML = `<div class="ss-loading">${escHtml(message)}</div>`;
}

async function loadAnalysis() {
  chrome.runtime.sendMessage({ type: 'GET_ANALYSIS' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      renderError('Could not load analysis. Try refreshing.');
      return;
    }
    if (res.analysis) {
      currentAnalysis = res.analysis;
      render(res.analysis);
    } else {
      $('ss-alerts').innerHTML = '<div class="ss-loading">No analysis yet — click Refresh to start.</div>';
    }
  });
}

function render(a) {
  renderStudentName(a.student_name);
  renderMomentum(a.momentum);
  renderAlerts(a.critical_alerts || []);
  renderPatterns(a.behavioral_patterns || []);
  renderRecovery(a.grade_recovery || []);
  renderWorkload(a.workload_forecast || []);
  renderFooter(a.analyzed_at);
  updateBadge(a.critical_alerts || []);
}

function renderStudentName(name) {
  if (name) $('ss-student-name').textContent = name;
}

function renderMomentum(m) {
  if (!m) return;
  const icon = $('ss-momentum-icon');
  const text = $('ss-momentum-text');
  const bar = $('ss-momentum');

  const map = {
    gaining_ground: { cls: 'gaining', icon: '▲', color: 'var(--accent)' },
    holding_steady: { cls: 'holding', icon: '●', color: 'var(--warning)' },
    losing_ground: { cls: 'losing', icon: '▼', color: 'var(--critical)' },
  };
  const config = map[m.direction] || map.holding_steady;

  icon.textContent = config.icon;
  icon.className = `ss-momentum-icon ${config.cls}`;
  bar.style.borderLeft = `3px solid ${config.color}`;
  text.textContent = m.summary || m.direction;
}

function renderAlerts(alerts) {
  const container = $('ss-alerts');
  if (!alerts.length) {
    container.innerHTML = '<div class="ss-empty">No critical alerts right now.</div>';
    return;
  }

  const sorted = [...alerts].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return (order[a.urgency] ?? 3) - (order[b.urgency] ?? 3);
  });

  container.innerHTML = sorted.map(a => `
    <div class="ss-alert-card">
      <div class="ss-alert-stripe ${escHtml(a.urgency)}"></div>
      <div class="ss-alert-body">
        <div class="ss-alert-headline">${escHtml(a.headline)}</div>
        <div class="ss-alert-detail">${escHtml(a.detail)}</div>
        <div class="ss-alert-action">→ ${escHtml(a.action)}</div>
      </div>
    </div>
  `).join('');
}

function renderPatterns(patterns) {
  const container = $('ss-patterns-list');
  const top3 = patterns.slice(0, 3);
  if (!top3.length) {
    container.innerHTML = '<div class="ss-empty">Not enough data yet to detect patterns.</div>';
    return;
  }

  container.innerHTML = top3.map(p => `
    <div class="ss-pattern-card">
      <div class="ss-pattern-headline">${escHtml(p.headline)}</div>
      <div class="ss-pattern-evidence">${escHtml(p.evidence)}</div>
      <div class="ss-pattern-impact">${escHtml(p.impact)}</div>
    </div>
  `).join('');
}

function renderRecovery(recovery) {
  const container = $('ss-recovery-list');
  if (!recovery.length) {
    container.innerHTML = '<div class="ss-empty">No grade recovery paths computed.</div>';
    return;
  }

  container.innerHTML = recovery.map(r => {
    const assignments = (r.remaining_assignments || []).map(a =>
      `<div>${escHtml(a.name)} — need ${a.needed_score}% (${a.points_possible}pts, due ${fmtDate(a.due)})</div>`
    ).join('');

    return `
      <div class="ss-recovery-row">
        <div class="ss-recovery-course">${escHtml(r.course)}</div>
        <div class="ss-recovery-grades">
          <span class="ss-grade-current">${r.current_letter} (${r.current_grade?.toFixed(1)}%)</span>
          <span class="ss-grade-arrow">→</span>
          <span class="ss-grade-target">${escHtml(r.target_grade)}</span>
        </div>
        <div class="ss-recovery-detail">${assignments}</div>
      </div>
    `;
  }).join('');
}

function renderWorkload(forecast) {
  const container = $('ss-workload-list');
  if (!forecast.length) {
    container.innerHTML = '<div class="ss-empty">No upcoming assignments found.</div>';
    return;
  }

  container.innerHTML = forecast.map(w => {
    const items = (w.assignments || []).map(a =>
      `<div>• ${escHtml(String(a))}</div>`
    ).join('');

    return `
      <div class="ss-workload-week">
        <div class="ss-workload-header">
          <span class="ss-workload-week-label">Week of ${fmtDate(w.week_of)}</span>
          <span class="ss-risk-badge ${escHtml(w.risk_level)}">${escHtml(w.risk_level)}</span>
        </div>
        <div class="ss-workload-stats">${w.assignment_count} assignments · ${w.total_points_due} pts</div>
        <div class="ss-workload-items">${items}</div>
      </div>
    `;
  }).join('');
}

function renderFooter(analyzedAt) {
  if (!analyzedAt) return;
  const ago = formatAge(new Date(analyzedAt));
  $('ss-last-analyzed').textContent = `Last analyzed: ${ago}`;
}

function updateBadge(alerts) {
  const badge = $('ss-badge');
  const hasCritical = alerts.some(a => a.urgency === 'critical');
  const hasWarning = alerts.some(a => a.urgency === 'warning');

  if (hasCritical) {
    badge.className = 'ss-badge';
  } else if (hasWarning) {
    badge.className = 'ss-badge warning';
  } else {
    badge.className = 'ss-badge hidden';
  }
}

async function triggerRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  const btn = $('ss-refresh-btn');
  btn.disabled = true;
  btn.textContent = '↻ Refreshing...';
  $('ss-alerts').innerHTML = '<div class="ss-loading">Pulling Canvas data...</div>';

  chrome.runtime.sendMessage({ type: 'REFRESH' }, (res) => {
    isRefreshing = false;
    btn.disabled = false;
    btn.textContent = '↻ Refresh';
    if (res?.ok && res.result) {
      currentAnalysis = res.result;
      render(res.result);
    } else {
      renderError(res?.error || 'Refresh failed. Check your API tokens.');
    }
  });
}

function renderError(msg) {
  $('ss-alerts').innerHTML = `<div class="ss-error">${escHtml(msg)}</div>`;
}

function openSidebar() {
  $('ss-sidebar').classList.remove('hidden');
  $('ss-tab').style.display = 'none';
}

function closeSidebar() {
  $('ss-sidebar').classList.add('hidden');
  $('ss-tab').style.display = 'flex';
}

function openFullscreen() {
  const url = chrome.runtime.getURL('fullscreen/fullscreen.html');
  window.open(url, '_blank');
}

/* ── Helpers ── */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return iso; }
}

function formatAge(date) {
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

init();
