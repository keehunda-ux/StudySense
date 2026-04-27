const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;

function buildPrompt(schema) {
  const { user, courses, assignments, graded_submissions, missing, upcoming } = schema;

  const today = new Date().toISOString().split('T')[0];
  const in21Days = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const coursesSummary = courses.map(c =>
    `- ${c.name} (${c.course_code}): current score ${c.current_score ?? 'N/A'}%, grade ${c.current_grade ?? 'N/A'}`
  ).join('\n');

  // Cap comments per submission and truncate long text to keep prompt size manageable
  const gradedData = graded_submissions.slice(0, 120).map(s => ({
    course: s.course_id,
    assignment: s.assignment_name,
    submitted_at: s.submitted_at,
    due_at: s.due_at,
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
      .map(c => ({
        author: c.author_name,
        text: c.body.slice(0, 400),
        date: c.created_at,
      })),
  }));

  const missingData = missing.map(m => ({
    name: m.name,
    course: m.course_name,
    due: m.due_at,
    points: m.points_possible,
  }));

  const upcomingData = upcoming
    .filter(e => e.start_at >= today && e.start_at <= in21Days)
    .map(e => ({
      title: e.title,
      due: e.start_at,
      points: e.assignment?.points_possible,
    }));

  return `You are an academic intelligence engine. Analyze the following Canvas LMS data for a student named ${user.first_name} and return a structured JSON analysis. Be specific, data-driven, and name real courses and assignments. Do not hallucinate.

TODAY: ${today}

COURSES:
${coursesSummary}

GRADED SUBMISSIONS (${gradedData.length} shown):
${JSON.stringify(gradedData)}

MISSING SUBMISSIONS:
${JSON.stringify(missingData)}

UPCOMING (next 21 days):
${JSON.stringify(upcomingData)}

---

Return ONLY a valid JSON object. No markdown fences, no explanation text before or after — just the raw JSON object starting with { and ending with }.

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
      "headline": "Specific alert max 12 words",
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
      "example_quote": "verbatim instructor comment snippet",
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
- critical_alerts: ALL missing submissions = critical. Upcoming high-point deadlines within 7 days = warning. Declining grade trend = warning.
- behavioral_patterns: derive from submitted_at vs due_at timestamps. Flag if >50% late. Flag recurring feedback.
- feedback_patterns: read all comment text. Cluster by theme. Quote real instructor text verbatim (max 120 chars).
- grade_recovery: only mathematically achievable targets. Use ungraded upcoming assignments for remaining points.
- workload_forecast: group by calendar week. Flag weeks with 3+ assignments or 150+ pts as high.
- peak_performance: null all fields if fewer than 5 graded submissions.
- Keep string values concise — headlines under 15 words, details under 50 words.`;
}

async function analyzeWithClaude(schema, apiKey) {
  const prompt = buildPrompt(schema);

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
  const stopReason = data.stop_reason;
  const text = data.content?.[0]?.text || '';

  if (stopReason === 'max_tokens') {
    throw new Error('Claude response was cut off (max_tokens reached). Try again — if this repeats, the dataset may be too large.');
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude did not return valid JSON. Response started with: ${text.slice(0, 100)}`);

  try {
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    throw new Error(`JSON parse failed at position ${e.message}. Claude response may have been malformed.`);
  }
}

export { analyzeWithClaude };
