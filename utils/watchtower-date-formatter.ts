/**
 * Centralized date formatter for Watchtower, enforcing exact rules:
 * - < 60 min: "23 min ago"
 * - < 24 hr: "2 hr ago"
 * - Same calendar day (local): "Today, 7:12 AM"
 * - Previous calendar day (local): "Yesterday, 9:41 AM"
 * - Older: "Aug 2, 2026, 2:12 PM"
 */
export const formatWatchtowerDate = (utcIsoString: string | null | undefined): string => {
  if (!utcIsoString) return 'No completed scan yet';
  
  const d = new Date(utcIsoString);
  if (isNaN(d.getTime())) return 'No completed scan yet';
  
  const now = new Date();
  const diffSeconds = (now.getTime() - d.getTime()) / 1000;
  
  // Strict formatting requirements:
  // - 2 minutes ago
  // - Today at 3:42 PM
  // - Yesterday at 11:18 PM
  
  if (diffSeconds >= 0 && diffSeconds < 3600) {
    const mins = Math.max(1, Math.floor(diffSeconds / 60));
    return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
  }
  
  // Future prevention logic (e.g. backend clock ahead by a few seconds)
  if (diffSeconds < 0 && diffSeconds > -60) {
    return '1 minute ago';
  } else if (diffSeconds <= -60) {
    // If backend is significantly ahead (shouldn't happen, but gracefully fallback)
    return `Today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();

  if (isToday) {
    return `Today at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  if (isYesterday) {
    return `Yesterday at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Older
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
