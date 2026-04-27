/**
 * Transforms raw Canvas API responses into a clean structured schema
 * that the analysis engine and UI can consume.
 */

function parseUser(raw) {
  return {
    id: raw.id,
    name: raw.name,
    first_name: raw.name?.split(' ')[0] || raw.short_name,
    email: raw.email,
    avatar_url: raw.avatar_url,
  };
}

function parseCourse(raw) {
  const enrollment = raw.enrollments?.[0] || {};
  return {
    id: raw.id,
    name: raw.name,
    course_code: raw.course_code,
    current_score: enrollment.computed_current_score ?? null,
    final_score: enrollment.computed_final_score ?? null,
    current_grade: enrollment.computed_current_grade ?? null,
    final_grade: enrollment.computed_final_grade ?? null,
    grading_period_score: enrollment.current_period_computed_current_score ?? null,
    start_at: raw.start_at,
    end_at: raw.end_at,
  };
}

function parseAssignment(raw, courseId, courseName) {
  return {
    id: raw.id,
    course_id: courseId,
    course_name: courseName,
    name: raw.name,
    due_at: raw.due_at,
    points_possible: raw.points_possible,
    assignment_group_id: raw.assignment_group_id,
    assignment_group_name: raw.assignment_group?.name || null,
    submission_types: raw.submission_types,
    grading_type: raw.grading_type,
    published: raw.published,
    omit_from_final_grade: raw.omit_from_final_grade,
    submission: raw.submission ? parseSubmission(raw.submission, raw) : null,
  };
}

function parseSubmission(raw, assignment = {}) {
  const dueAt = assignment.due_at || raw.cached_due_date;
  let secondsLate = raw.seconds_late || 0;
  if (!secondsLate && raw.submitted_at && dueAt) {
    const diffMs = new Date(raw.submitted_at) - new Date(dueAt);
    secondsLate = diffMs > 0 ? Math.floor(diffMs / 1000) : 0;
  }

  return {
    id: raw.id,
    assignment_id: raw.assignment_id,
    assignment_name: assignment.name || raw.assignment?.name || null,
    course_id: raw.course_id,
    user_id: raw.user_id,
    submitted_at: raw.submitted_at,
    due_at: dueAt,
    score: raw.score,
    points_possible: assignment.points_possible || raw.assignment?.points_possible || null,
    percent: (raw.score != null && assignment.points_possible)
      ? ((raw.score / assignment.points_possible) * 100)
      : null,
    grade: raw.grade,
    late: raw.late || false,
    missing: raw.missing || false,
    excused: raw.excused || false,
    seconds_late: secondsLate,
    hours_late: secondsLate > 0 ? +(secondsLate / 3600).toFixed(2) : 0,
    attempt: raw.attempt || 1,
    workflow_state: raw.workflow_state,
    submission_type: raw.submission_type,
    submission_comments: (raw.submission_comments || []).map(parseComment),
    rubric_assessment: raw.rubric_assessment || null,
    assignment_group_name: assignment.assignment_group?.name || null,
  };
}

function parseComment(raw) {
  return {
    id: raw.id,
    author_name: raw.author_name,
    body: raw.comment,
    created_at: raw.created_at,
    is_instructor: !raw.author?.enrollments?.some(e => e.type === 'StudentEnrollment'),
  };
}

function parseMissing(raw) {
  return {
    id: raw.id,
    assignment_id: raw.id,
    name: raw.name,
    course_id: raw.course_id,
    due_at: raw.due_at,
    points_possible: raw.points_possible,
    course_name: raw.course?.name || null,
  };
}

function parseUpcomingEvent(raw) {
  return {
    id: raw.id,
    title: raw.title,
    start_at: raw.start_at,
    end_at: raw.end_at,
    assignment: raw.assignment ? {
      id: raw.assignment.id,
      course_id: raw.assignment.course_id,
      points_possible: raw.assignment.points_possible,
      due_at: raw.assignment.due_at,
    } : null,
  };
}

/**
 * Build the full canonical data object that everything else works from.
 */
function buildSchema({ user, courses, assignmentsByCourse, submissionsByCourse, missing, upcoming }) {
  const parsedCourses = courses.map(parseCourse);
  const courseMap = Object.fromEntries(parsedCourses.map(c => [c.id, c]));

  const allSubmissions = [];
  const allAssignments = [];

  for (const courseId of Object.keys(assignmentsByCourse)) {
    const course = courseMap[courseId] || { name: `Course ${courseId}` };
    const assignments = (assignmentsByCourse[courseId] || []).map(a => parseAssignment(a, courseId, course.name));
    allAssignments.push(...assignments);

    const subs = (submissionsByCourse[courseId] || []).map(s => {
      const assignment = assignments.find(a => a.id === s.assignment_id) || {};
      return parseSubmission(s, assignment);
    });
    allSubmissions.push(...subs);
  }

  const gradedSubmissions = allSubmissions.filter(
    s => s.score != null && s.submitted_at && s.workflow_state === 'graded'
  );

  return {
    user: parseUser(user),
    courses: parsedCourses,
    assignments: allAssignments,
    submissions: allSubmissions,
    graded_submissions: gradedSubmissions,
    missing: (missing || []).map(parseMissing),
    upcoming: (upcoming || []).map(parseUpcomingEvent),
    built_at: new Date().toISOString(),
  };
}

export { buildSchema, parseUser, parseCourse, parseAssignment, parseSubmission, parseComment };
