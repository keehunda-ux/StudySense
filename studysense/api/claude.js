const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

// ── System prompt — built dynamically from the student's course filters ──────

function buildSystemPrompt(allCourses, excludedIds, today) {
  const excSet = new Set((excludedIds || []).map(String));
  const active   = allCourses.filter(c => !excSet.has(String(c.id)));
  const excluded = allCourses.filter(c =>  excSet.has(String(c.id)));

  const activeLine   = active.map(c => `  ✓ ${c.name}`).join('\n') || '  (all courses active)';
  const excludedLine = excluded.length
    ? excluded.map(c => `  ✗ ${c.name}`).join('\n')
    : '  (none)';

  return `You are StudySense, an academic intelligence assistant for Kee-Vonne.

TONE AND PERSPECTIVE:
Address Kee-Vonne directly using second person ("you", "your"). Never use third person ("Kee-Vonne has...", "the student's...").
✅ CORRECT: "You have 3 major assignments due within 36 hours"
✅ CORRECT: "Your IT Policy grade is at risk (79%)"
❌ WRONG: "Kee-Vonne has 3 major assignments..."
❌ WRONG: "The student's IT Policy grade..."

CRITICAL FILTERING INSTRUCTION:
Only analyze courses marked ACTIVE below. Excluded courses appear in Canvas but belong to a completed block and must be completely ignored — do not mention them in any section of your response.

ACTIVE COURSES — include in all analysis:
${activeLine}

EXCLUDED / COMPLETED COURSES — ignore entirely:
${excludedLine}

When analyzing deadline collisions, grade impact, workload forecasting, and behavioral patterns, consider ONLY the active courses listed above. Never flag a missing assignment, late submission, or upcoming deadline for an excluded course — even if the data contains it.

Today is ${today}.`;
}

// ── User prompt — data payload sent to Claude ─────────────────────────────────

function buildPrompt(schema, dismissedAlerts) {
  const { user, courses, graded_submissions, missing, upcoming } = schema;

  const today = new Date().toISOString().split('T')[0];
  const in21Days = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const coursesSummary = courses.map(c =>
    `- ${c.name} (${c.course_code}): score ${c.current_score ?? 'N/A'}%, grade ${c.current_grade ?? 'N/A'}`
  ).join('\n');

  // Add recency context and sort newest-first so Claude naturally weights recent work
  const now = Date.now();
  const gradedData = graded_submissions
    .slice(0, 120)
    .map(s => {
      const daysAgo = s.submitted_at
        ? Math.round((now - new Date(s.submitted_at).getTime()) / 86400000)
        : null;
      return {
        course: s.course_id,
        assignment: s.assignment_name,
        submitted_at: s.submitted_at,
        due_at: s.due_at,
        days_ago: daysAgo,
        score: s.score,
        points_possible: s.points_possible,
        percent: s.percent != null ? +s.percent.toFixed(1) : null,
        late: s.late,
        hours_late: s.hours_late,
        attempt: s.attempt,
        group: s.assignment_group_name,
        comments: s.submission_comments
          .filter(c => c.body && c.body.trim().length > 5)
          .slice(0, 4)
          .map(c => ({ author: c.author_name, text: c.body.slice(0, 400), date: c.created_at })),
      };
    })
    .sort((a, b) => (a.days_ago ?? 999) - (b.days_ago ?? 999)); // newest first

  // Guard: only include missing items whose course is actually in the active course list.
  // This catches anything that slipped through the upstream course_id filter (e.g. nulls,
  // type mismatches, or exclusions not yet saved) by cross-referencing both ID and name.
  const activeCourseIds   = new Set(courses.map(c => String(c.id)));
  const activeCourseNames = new Set(courses.map(c => c.name?.toLowerCase()));

  const missingData = missing
    .filter(m => {
      const idMatch   = m.course_id   && activeCourseIds.has(String(m.course_id));
      const nameMatch = m.course_name && activeCourseNames.has(m.course_name.toLowerCase());
      return idMatch || nameMatch;
    })
    .map(m => ({ name: m.name, course: m.course_name, due: m.due_at, points: m.points_possible }));

  const upcomingData = upcoming
    .filter(e => e.start_at >= today && e.start_at <= in21Days)
    .map(e => ({ title: e.title, due: e.start_at, points: e.assignment?.points_possible }));

  const dismissNote = dismissedAlerts?.length
    ? `\nDO NOT generate alerts for these previously dismissed items: ${dismissedAlerts.map(h => `"${h}"`).join(', ')}\n`
    : '';

  return `Analyze the following Canvas LMS data for ${user.first_name} and return a structured JSON analysis. Be specific — use real course names, assignment names, dates, and scores from the data below. Do not hallucinate.
${dismissNote}
TODAY: ${today}

ACTIVE COURSES:
${coursesSummary}

GRADED SUBMISSIONS (${gradedData.length} shown, sorted newest first — weight insights toward recent work):
${JSON.stringify(gradedData)}

MISSING SUBMISSIONS:
${JSON.stringify(missingData)}

UPCOMING (next 21 days):
${JSON.stringify(upcomingData)}

---
Return ONLY a valid JSON object. No markdown fences, no text before or after — raw JSON starting with { and ending with }.

{
  "student_name": "${user.first_name}",
  "analyzed_at": "${new Date().toISOString()}",
  "momentum": {
    "direction": "losing_ground | holding_steady | gaining_ground",
    "summary": "one specific sentence with real course names and data",
    "drivers": ["specific data point with numbers", "specific data point with numbers"]
  },
  "critical_alerts": [
    {
      "id": "alert_1",
      "type": "missing | deadline | grade_risk | pattern",
      "urgency": "critical | warning | info",
      "headline": "Specific alert — max 12 words",
      "detail": "Full explanation with course name, assignment name, points, dates",
      "action": "Specific thing to do right now"
    }
  ],
  "behavioral_patterns": [
    {
      "id": "pattern_1",
      "category": "submission_timing | late_pattern | effort_mismatch | feedback_loop",
      "headline": "Short pattern description",
      "evidence": "Specific data proving this pattern with numbers",
      "impact": "What this costs in points or grade percentage"
    }
  ],
  "feedback_patterns": [
    {
      "theme": "theme name",
      "frequency": 0,
      "courses_affected": ["course name"],
      "estimated_points_lost": 0,
      "example_quote": "verbatim instructor comment (max 120 chars)",
      "recurring": true
    }
  ],
  "grade_recovery": [
    {
      "course": "course name",
      "current_grade": 0.0,
      "current_letter": "B-",
      "target_grade": "B+",
      "target_score": 0.0,
      "remaining_assignments": [
        { "name": "assignment name", "points_possible": 0, "due": "date", "needed_score": 0 }
      ],
      "achievable": true
    }
  ],
  "workload_forecast": [
    {
      "week_of": "YYYY-MM-DD",
      "total_points_due": 0,
      "assignment_count": 0,
      "risk_level": "high | medium | low",
      "assignments": ["name — course — Xpts — due date"]
    }
  ],
  "peak_performance": {
    "best_day": "day name or null",
    "best_time_window": "time range or null",
    "avg_score_in_window": 0.0,
    "avg_score_outside_window": 0.0,
    "evidence_count": 0
  }
}

Rules:
- Only analyze active courses from the system prompt. Never mention excluded courses.
- critical_alerts: ALL missing = critical. Deadlines within 7 days with high points = warning. Declining grade = warning.
- behavioral_patterns: derive from submitted_at vs due_at. Weight last 30 days heavily.
- feedback_patterns: read all comment text. Quote verbatim (120 chars max).
- grade_recovery: mathematically achievable only. Use ungraded upcoming for remaining points.
- workload_forecast: group by calendar week. 3+ assignments or 150+ pts = high risk.
- peak_performance: null all fields if fewer than 5 graded submissions.
- Keep string values concise — headlines ≤15 words, details ≤50 words.`;
}

// ── API call ──────────────────────────────────────────────────────────────────

async function analyzeWithClaude(schema, apiKey, { excludedIds = [], dismissedAlerts = [], allCourses = [] } = {}) {
  const today = new Date().toISOString().split('T')[0];
  const system = buildSystemPrompt(allCourses, excludedIds, today);
  const prompt = buildPrompt(schema, dismissedAlerts);

  const res = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (res.status === 401) throw new Error('CLAUDE_UNAUTHORIZED');
  if (res.status === 429) throw new Error('CLAUDE_RATE_LIMITED');
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error: ${res.status} — ${body.slice(0, 200)}`);
  }

  const data = await res.json();

  if (data.stop_reason === 'max_tokens') {
    throw new Error('Claude response was cut off (max_tokens reached). Try again.');
  }

  const text = data.content?.[0]?.text || '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude did not return valid JSON. Started with: ${text.slice(0, 100)}`);

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

export { analyzeWithClaude };
