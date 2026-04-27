/**
 * TTL-based cache helpers — thin wrappers so callers don't touch timestamps directly.
 * All actual persistence is in chrome.storage.local via storage.js.
 */

function formatAge(ms) {
  if (ms == null) return 'never';
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

export { formatAge };
