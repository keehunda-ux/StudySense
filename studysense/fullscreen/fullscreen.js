let analysis = null;

function $(id) { return document.getElementById(id); }

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso; }
}

// ── Nav ──
document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`section-${btn.dataset.section}`).classList.add('active');
  });
});

// ── Load ──
chrome.runtime.sendMessage({ type: 'GET_ANALYSIS' }, (res) => {
  if (!res?.ok || !res.analysis) {
    $('overview-subtitle').textContent = 'No analysis available yet. Open Canvas and click Refresh.';
    return;
  }
  analysis = res.analysis;
  render(analysis);
});

function render(a) {
  $('nav-student').textContent = a.student_name ? `Signed in as ${a.student_name}` : '';
  $('overview-subtitle').textContent = `Analyzed ${fmtDate(a.analyzed_at)}`;
  renderMomentum(a.momentum);
  renderOverviewAlerts(a.critical_alerts || []);
  renderAllAlerts(a.critical_alerts || []);
  renderFeedback(a.feedback_patterns || []);
  renderBehavioral(a.behavioral_patterns || []);
  renderPeakPerformance(a.peak_performance);
  renderRecovery(a.grade_recovery || []);
  renderWorkload(a.workload_forecast || []);
}

function renderMomentum(m) {
  if (!m) return;
  const map = {
    gaining_ground: { cls: 'gaining', icon: '▲', label: 'Gaining Ground' },
    holding_steady: { cls: 'holding', icon: '●', label: 'Holding Steady' },
    losing_ground:  { cls: 'losing',  icon: '▼', label: 'Losing Ground'  },
  };
  const cfg = map[m.direction] || map.holding_steady;
  const drivers = (m.drivers || []).map(d => `<span class="driver-chip">${esc(d)}</span>`).join('');
  $('momentum-block').innerHTML = `
    <div class="momentum-bar">
      <div class="momentum-icon ${cfg.cls}">${cfg.icon}</div>
      <div class="momentum-body">
        <div class="momentum-label">${cfg.label}</div>
        <div class="momentum-summary">${esc(m.summary)}</div>
        <div class="momentum-drivers">${drivers}</div>
      </div>
    </div>`;
}

function renderOverviewAlerts(alerts) {
  const top3 = [...alerts]
    .sort((a,b) => ({ critical:0, warning:1, info:2 }[a.urgency]??3) - ({ critical:0, warning:1, info:2 }[b.urgency]??3))
    .slice(0, 3);
  $('overview-alerts').innerHTML = top3.map(alertCard).join('') || '<div class="empty-state">No critical alerts.</div>';
}

function renderAllAlerts(alerts) {
  const sorted = [...alerts].sort((a,b) => ({ critical:0, warning:1, info:2 }[a.urgency]??3) - ({ critical:0, warning:1, info:2 }[b.urgency]??3));
  $('all-alerts-list').innerHTML = sorted.map(alertCard).join('') || '<div class="empty-state">No alerts found.</div>';
}

function alertCard(a) {
  return `
    <div class="alert-card ${esc(a.urgency)}">
      <div class="alert-headline">${esc(a.headline)}</div>
      <div class="alert-detail">${esc(a.detail)}</div>
      <div class="alert-action">→ ${esc(a.action)}</div>
    </div>`;
}

function renderFeedback(patterns) {
  if (!patterns.length) {
    $('feedback-list').innerHTML = '<div class="empty-state">No instructor feedback found yet.</div>';
    return;
  }
  $('feedback-list').innerHTML = patterns.map(p => `
    <div class="feedback-card">
      <div class="feedback-theme">
        ${esc(p.theme)}
        ${p.recurring ? '<span class="recurring-badge">Recurring</span>' : ''}
      </div>
      <div class="feedback-meta">
        <div class="feedback-stat">Frequency: <span>${p.frequency}</span></div>
        <div class="feedback-stat">Est. points lost: <span>${p.estimated_points_lost ?? '—'}</span></div>
        <div class="feedback-stat">Courses: <span>${(p.courses_affected || []).join(', ') || '—'}</span></div>
      </div>
      ${p.example_quote ? `<div class="feedback-quote">"${esc(p.example_quote)}"</div>` : ''}
    </div>`).join('');
}

function renderBehavioral(patterns) {
  if (!patterns.length) {
    $('behavioral-list').innerHTML = '<div class="empty-state">Not enough data to detect behavioral patterns yet.</div>';
    return;
  }
  $('behavioral-list').innerHTML = patterns.map(p => `
    <div class="card">
      <div class="card-title">${esc(p.headline)}</div>
      <div class="card-body">
        <div style="margin-bottom:6px">${esc(p.evidence)}</div>
        <div style="color:#f59e0b">${esc(p.impact)}</div>
      </div>
    </div>`).join('');
}

function renderPeakPerformance(p) {
  if (!p || !p.best_day) {
    $('peak-performance-block').innerHTML = '<div class="empty-state">Not enough submissions yet to compute peak performance window.</div>';
    return;
  }
  $('peak-performance-block').innerHTML = `
    <h2 style="font-size:16px;font-weight:700;margin:24px 0 8px">Peak Performance Window</h2>
    <div class="perf-grid">
      <div class="perf-stat">
        <div class="perf-label">Best Day</div>
        <div class="perf-value">${esc(p.best_day)}</div>
      </div>
      <div class="perf-stat">
        <div class="perf-label">Best Time</div>
        <div class="perf-value" style="font-size:15px">${esc(p.best_time_window || '—')}</div>
      </div>
      <div class="perf-stat">
        <div class="perf-label">Avg Score In Window</div>
        <div class="perf-value">${p.avg_score_in_window?.toFixed(1) ?? '—'}%</div>
        <div class="perf-sub">${p.evidence_count} submissions</div>
      </div>
      <div class="perf-stat">
        <div class="perf-label">Avg Score Outside</div>
        <div class="perf-value" style="color:#f59e0b">${p.avg_score_outside_window?.toFixed(1) ?? '—'}%</div>
      </div>
    </div>`;
}

function renderRecovery(courses) {
  if (!courses.length) {
    $('recovery-list').innerHTML = '<div class="empty-state">No grade recovery paths available.</div>';
    return;
  }
  $('recovery-list').innerHTML = courses.map(r => {
    const rows = (r.remaining_assignments || []).map(a => `
      <div class="recovery-assignment-row">
        <span>${esc(a.name)} — due ${fmtDate(a.due)} (${a.points_possible}pts)</span>
        <span class="needed-score">Need ${a.needed_score}%</span>
      </div>`).join('');
    return `
      <div class="recovery-card">
        <div class="recovery-header">
          <span class="recovery-course-name">${esc(r.course)}</span>
          <span class="grade-pill">
            <span class="grade-current">${esc(r.current_letter)} (${r.current_grade?.toFixed(1)}%)</span>
            <span style="color:#7070a0">→</span>
            <span class="grade-target">${esc(r.target_grade)}</span>
          </span>
        </div>
        <div class="recovery-assignments">${rows}</div>
        ${!r.achievable ? '<div style="color:#ef4444;font-size:11px;margin-top:8px">⚠ Target may not be mathematically achievable</div>' : ''}
      </div>`;
  }).join('');
}

function renderWorkload(weeks) {
  if (!weeks.length) {
    $('workload-list').innerHTML = '<div class="empty-state">No upcoming assignments found.</div>';
    return;
  }
  $('workload-list').innerHTML = weeks.map(w => {
    const items = (w.assignments || []).map(a => `<div>• ${esc(String(a))}</div>`).join('');
    return `
      <div class="week-card">
        <div class="week-header">
          <span class="week-label">Week of ${fmtDate(w.week_of)}</span>
          <span class="risk-pill ${esc(w.risk_level)}">${esc(w.risk_level)}</span>
        </div>
        <div style="font-size:12px;color:#7070a0">${w.assignment_count} assignments · ${w.total_points_due} pts total</div>
        <div class="week-assignments">${items}</div>
      </div>`;
  }).join('');
}
