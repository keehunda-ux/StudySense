/* Sidebar UI — runs inside the injected iframe on Canvas */

const $ = id => document.getElementById(id);

let currentAnalysis = null;
let isRefreshing = false;
let filtersChanged = false;

// ── Init ─────────────────────────────────────────────────────────────────────

function init() {
  $('ss-tab').addEventListener('click', openSidebar);
  $('ss-close-btn').addEventListener('click', closeSidebar);
  $('ss-expand-btn').addEventListener('click', openFullscreen);
  $('ss-refresh-btn').addEventListener('click', triggerRefresh);
  $('ss-reanalyze-btn').addEventListener('click', triggerReanalyze);

  document.querySelectorAll('.ss-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target);
      const icon = btn.querySelector('.ss-toggle-icon');
      target.classList.toggle('hidden');
      icon.classList.toggle('open');
    });
  });

  chrome.runtime.onMessage.addListener(handleMessage);
  loadCourses();
  loadAnalysis();
}

// ── Message handler (progress updates from background) ────────────────────────

function handleMessage(msg) {
  if (msg.type !== 'PROGRESS') return;
  if (msg.message === 'done') {
    loadAnalysis();
  } else {
    $('ss-alerts').innerHTML = `<div class="ss-loading">${escHtml(msg.message)}</div>`;
  }
}

// ── Load & render analysis ────────────────────────────────────────────────────

function loadAnalysis() {
  chrome.runtime.sendMessage({ type: 'GET_ANALYSIS' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      renderError('Could not load analysis. Try refreshing.');
      return;
    }
    if (res.analysis) {
      currentAnalysis = res.analysis;
      render(res.analysis);
    } else {
      $('ss-alerts').innerHTML = '<div class="ss-loading">No analysis yet — click Refresh.</div>';
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
  const map = {
    gaining_ground: { cls: 'gaining', icon: '▲', color: 'var(--accent)' },
    holding_steady: { cls: 'holding', icon: '●', color: 'var(--warning)' },
    losing_ground:  { cls: 'losing',  icon: '▼', color: 'var(--critical)' },
  };
  const cfg = map[m.direction] || map.holding_steady;
  $('ss-momentum-icon').textContent = cfg.icon;
  $('ss-momentum-icon').className   = `ss-momentum-icon ${cfg.cls}`;
  $('ss-momentum').style.borderLeft = `3px solid ${cfg.color}`;
  $('ss-momentum-text').textContent  = m.summary || m.direction;
}

function renderAlerts(alerts) {
  const container = $('ss-alerts');
  if (!alerts.length) {
    container.innerHTML = '<div class="ss-empty">No critical alerts right now.</div>';
    return;
  }

  const sorted = [...alerts].sort((a, b) => {
    const o = { critical: 0, warning: 1, info: 2 };
    return (o[a.urgency] ?? 3) - (o[b.urgency] ?? 3);
  });

  container.innerHTML = sorted.map(a => `
    <div class="ss-alert-card" data-alert-id="${escHtml(a.id)}">
      <div class="ss-alert-stripe ${escHtml(a.urgency)}"></div>
      <div class="ss-alert-body">
        <div class="ss-alert-top">
          <div class="ss-alert-headline">${escHtml(a.headline)}</div>
          <button class="ss-dismiss-btn" title="Dismiss this alert" data-headline="${escHtml(a.headline)}">×</button>
        </div>
        <div class="ss-alert-detail">${escHtml(a.detail)}</div>
        <div class="ss-alert-action">→ ${escHtml(a.action)}</div>
      </div>
    </div>
  `).join('');

  // Wire dismiss buttons
  container.querySelectorAll('.ss-dismiss-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismissAlert(btn.dataset.headline, btn.closest('.ss-alert-card'));
    });
  });
}

function renderPatterns(patterns) {
  const container = $('ss-patterns-list');
  if (!patterns.slice(0, 3).length) {
    container.innerHTML = '<div class="ss-empty">Not enough data to detect patterns yet.</div>';
    return;
  }
  container.innerHTML = patterns.slice(0, 3).map(p => `
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
    const rows = (r.remaining_assignments || []).map(a =>
      `<div>${escHtml(a.name)} — need ${a.needed_score}% (${a.points_possible}pts, due ${fmtDate(a.due)})</div>`
    ).join('');
    return `
      <div class="ss-recovery-row">
        <div class="ss-recovery-course">${escHtml(r.course)}</div>
        <div class="ss-recovery-grades">
          <span class="ss-grade-current">${escHtml(r.current_letter)} (${r.current_grade?.toFixed(1)}%)</span>
          <span class="ss-grade-arrow">→</span>
          <span class="ss-grade-target">${escHtml(r.target_grade)}</span>
        </div>
        <div class="ss-recovery-detail">${rows}</div>
      </div>`;
  }).join('');
}

function renderWorkload(forecast) {
  const container = $('ss-workload-list');
  if (!forecast.length) {
    container.innerHTML = '<div class="ss-empty">No upcoming assignments found.</div>';
    return;
  }
  container.innerHTML = forecast.map(w => `
    <div class="ss-workload-week">
      <div class="ss-workload-header">
        <span class="ss-workload-week-label">Week of ${fmtDate(w.week_of)}</span>
        <span class="ss-risk-badge ${escHtml(w.risk_level)}">${escHtml(w.risk_level)}</span>
      </div>
      <div class="ss-workload-stats">${w.assignment_count} assignments · ${w.total_points_due} pts</div>
      <div class="ss-workload-items">${(w.assignments || []).map(a => `<div>• ${escHtml(String(a))}</div>`).join('')}</div>
    </div>
  `).join('');
}

function renderFooter(analyzedAt) {
  if (!analyzedAt) return;
  $('ss-last-analyzed').textContent = `Last analyzed: ${formatAge(new Date(analyzedAt))}`;
}

function updateBadge(alerts) {
  const badge = $('ss-badge');
  const hasCritical = alerts.some(a => a.urgency === 'critical');
  const hasWarning  = alerts.some(a => a.urgency === 'warning');
  badge.className = hasCritical ? 'ss-badge' : hasWarning ? 'ss-badge warning' : 'ss-badge hidden';
}

// ── Course management ─────────────────────────────────────────────────────────

function loadCourses() {
  chrome.runtime.sendMessage({ type: 'GET_COURSES' }, (res) => {
    if (chrome.runtime.lastError || !res?.ok || !res.courses?.length) return;
    renderCourseToggles(res.courses, res.excluded || []);
  });
}

function renderCourseToggles(courses, excluded) {
  const excSet = new Set(excluded.map(String));
  const container = $('ss-courses-list');

  container.innerHTML = courses.map(c => {
    const isActive = !excSet.has(String(c.id));
    return `
      <div class="ss-course-row ${isActive ? '' : 'excluded'}" data-course-id="${escHtml(String(c.id))}">
        <div>
          <span class="ss-course-name">${escHtml(c.name)}</span>
          <span class="ss-course-code">${escHtml(c.code || '')}</span>
        </div>
        <label class="ss-toggle" title="${isActive ? 'Click to exclude' : 'Click to include'}">
          <input type="checkbox" ${isActive ? 'checked' : ''} data-course-id="${escHtml(String(c.id))}" />
          <span class="ss-toggle-track"></span>
        </label>
      </div>`;
  }).join('');

  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => onCourseToggle(container, courses));
  });
}

function onCourseToggle(container, courses) {
  // Read current state of all checkboxes
  const newExcluded = [];
  container.querySelectorAll('input[type=checkbox]').forEach(cb => {
    const row = cb.closest('.ss-course-row');
    if (!cb.checked) {
      newExcluded.push(cb.dataset.courseId);
      row.classList.add('excluded');
    } else {
      row.classList.remove('excluded');
    }
  });

  // Persist
  chrome.runtime.sendMessage({ type: 'SAVE_EXCLUSIONS', ids: newExcluded }, () => {});

  // Show re-analyze banner
  filtersChanged = true;
  $('ss-filter-banner').classList.remove('hidden');
}

// ── Alert dismissal ───────────────────────────────────────────────────────────

function dismissAlert(headline, cardEl) {
  // Visually remove immediately
  cardEl.style.transition = 'opacity 0.2s';
  cardEl.style.opacity = '0';
  setTimeout(() => cardEl.remove(), 200);

  // Persist
  chrome.runtime.sendMessage({ type: 'DISMISS_ALERT', headline }, () => {});

  // Show re-analyze banner so Claude skips it next time
  filtersChanged = true;
  $('ss-filter-banner').classList.remove('hidden');
}

// ── Refresh / re-analyze ──────────────────────────────────────────────────────

async function triggerRefresh() {
  if (isRefreshing) return;
  startLoading('Pulling Canvas data…');
  chrome.runtime.sendMessage({ type: 'REFRESH' }, (res) => {
    stopLoading();
    if (res?.ok && res.result) {
      currentAnalysis = res.result;
      render(res.result);
      hideBanner();
    } else {
      renderError(res?.error || 'Refresh failed. Check your API tokens.');
    }
  });
}

async function triggerReanalyze() {
  if (isRefreshing) return;
  startLoading('Re-analyzing with updated filters…');
  $('ss-reanalyze-btn').disabled = true;
  chrome.runtime.sendMessage({ type: 'REANALYZE' }, (res) => {
    stopLoading();
    $('ss-reanalyze-btn').disabled = false;
    if (res?.ok && res.result) {
      currentAnalysis = res.result;
      render(res.result);
      hideBanner();
      filtersChanged = false;
    } else {
      renderError(res?.error || 'Re-analysis failed.');
    }
  });
}

function startLoading(msg) {
  isRefreshing = true;
  $('ss-refresh-btn').disabled = true;
  $('ss-refresh-btn').textContent = '↻ …';
  $('ss-alerts').innerHTML = `<div class="ss-loading">${escHtml(msg)}</div>`;
}

function stopLoading() {
  isRefreshing = false;
  $('ss-refresh-btn').disabled = false;
  $('ss-refresh-btn').textContent = '↻ Refresh';
}

function hideBanner() { $('ss-filter-banner').classList.add('hidden'); }

// ── Misc ──────────────────────────────────────────────────────────────────────

function renderError(msg) {
  $('ss-alerts').innerHTML = `<div class="ss-error">${escHtml(msg)}</div>`;
}

function openSidebar()    { $('ss-sidebar').classList.remove('hidden'); $('ss-tab').style.display = 'none'; }
function closeSidebar()   { $('ss-sidebar').classList.add('hidden');    $('ss-tab').style.display = 'flex'; }
function openFullscreen() { window.open(chrome.runtime.getURL('fullscreen/fullscreen.html'), '_blank'); }

function escHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function formatAge(date) {
  const m = Math.floor((Date.now() - date.getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  return `${h} hour${h === 1 ? '' : 's'} ago`;
}

init();
