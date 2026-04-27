const BASE_URL = 'https://usfca.instructure.com';

async function canvasFetch(path, token, params = {}) {
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set('per_page', '100');
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      v.forEach(item => url.searchParams.append(k, item));
    } else {
      url.searchParams.set(k, v);
    }
  }

  const results = [];
  let nextUrl = url.toString();

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.status === 401) throw new Error('CANVAS_UNAUTHORIZED');
    if (res.status === 429) {
      await sleep(60000);
      continue;
    }
    if (!res.ok) throw new Error(`Canvas API error: ${res.status} ${res.statusText}`);

    const data = await res.json();
    if (Array.isArray(data)) {
      results.push(...data);
    } else {
      return data;
    }

    const linkHeader = res.headers.get('Link');
    nextUrl = parseNextLink(linkHeader);
  }

  return results;
}

function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const [urlPart, relPart] = part.split(';').map(s => s.trim());
    if (relPart === 'rel="next"') {
      return urlPart.replace(/^<|>$/g, '');
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getUser(token) {
  return canvasFetch('/api/v1/users/self', token);
}

async function getCourses(token) {
  return canvasFetch('/api/v1/courses', token, {
    enrollment_state: 'active',
    'include[]': ['total_scores', 'current_grading_period_scores'],
  });
}

async function getAssignments(token, courseId) {
  return canvasFetch(`/api/v1/courses/${courseId}/assignments`, token, {
    'include[]': ['submission', 'assignment_group'],
    order_by: 'due_at',
  });
}

async function getSubmissions(token, courseId) {
  return canvasFetch(`/api/v1/courses/${courseId}/submissions`, token, {
    'student_ids[]': ['self'],
    'include[]': ['submission_comments', 'rubric_assessment', 'assignment'],
  });
}

async function getMissingSubmissions(token) {
  return canvasFetch('/api/v1/users/self/missing_submissions', token, {
    'include[]': ['planner_overrides'],
  });
}

async function getUpcomingEvents(token) {
  return canvasFetch('/api/v1/users/self/upcoming_events', token, {
    type: 'assignment',
  });
}

async function getStudentAnalytics(token, courseId) {
  try {
    return await canvasFetch(`/api/v1/courses/${courseId}/analytics/student_summaries`, token);
  } catch {
    return null;
  }
}

/**
 * Pulls all data needed for analysis. Returns raw API payloads.
 * Caller is responsible for caching.
 */
async function fetchAllData(token, onProgress) {
  const progress = onProgress || (() => {});

  progress('Fetching your profile...');
  const user = await getUser(token);

  progress('Fetching your courses...');
  const courses = await getCourses(token);
  const activeCourses = courses.filter(c => !c.access_restricted_by_date);

  const assignmentsByCourse = {};
  const submissionsByCourse = {};

  for (let i = 0; i < activeCourses.length; i++) {
    const course = activeCourses[i];
    progress(`Fetching ${course.name} (${i + 1}/${activeCourses.length})...`);
    try {
      assignmentsByCourse[course.id] = await getAssignments(token, course.id);
      submissionsByCourse[course.id] = await getSubmissions(token, course.id);
    } catch (e) {
      console.warn(`StudySense: skipping course ${course.id}`, e);
      assignmentsByCourse[course.id] = [];
      submissionsByCourse[course.id] = [];
    }
  }

  progress('Fetching missing submissions...');
  const missing = await getMissingSubmissions(token).catch(() => []);

  progress('Fetching upcoming events...');
  const upcoming = await getUpcomingEvents(token).catch(() => []);

  return { user, courses: activeCourses, assignmentsByCourse, submissionsByCourse, missing, upcoming };
}

export { fetchAllData, getUser, getCourses };
