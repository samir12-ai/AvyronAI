import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatWatchtowerDate } from '../watchtower-date-formatter';

describe('formatWatchtowerDate', () => {
  beforeEach(() => {
    // Mock the system time to a fixed point: 2026-08-02T12:00:00Z
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-02T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should handle null/undefined', () => {
    expect(formatWatchtowerDate(null)).toBe('Time unavailable');
    expect(formatWatchtowerDate(undefined)).toBe('Time unavailable');
  });

  it('should handle invalid timestamp', () => {
    expect(formatWatchtowerDate('invalid-date')).toBe('Time unavailable');
  });

  it('should format < 60 min accurately', () => {
    // 23 mins ago -> 11:37 AM
    const date = new Date('2026-08-02T11:37:00Z');
    expect(formatWatchtowerDate(date.toISOString())).toBe('23 min ago');
  });

  it('should format < 24 hr (same day) accurately', () => {
    // 2 hrs ago -> 10:00 AM
    const date = new Date('2026-08-02T10:00:00Z');
    expect(formatWatchtowerDate(date.toISOString())).toBe('2 hr ago');
  });

  it('should format < 24 hr (yesterday) accurately', () => {
    // Yesterday, 9:41 PM -> 2026-08-01T21:41:00Z (local time will depend on timezone but let's test Yesterday)
    const date = new Date('2026-08-01T21:41:00Z'); // 14 hours ago
    const res = formatWatchtowerDate(date.toISOString());
    expect(res).toMatch(/Yesterday/);
  });

  it('should format older dates accurately', () => {
    // Older date -> July 1, 2026
    const date = new Date('2026-07-01T14:12:00Z');
    const res = formatWatchtowerDate(date.toISOString());
    expect(res).toContain('2026');
    expect(res).toContain('Jul 1');
  });

  it('should handle future timestamps gracefully', () => {
    const date = new Date('2026-08-02T13:00:00Z');
    expect(formatWatchtowerDate(date.toISOString())).toBe('Just now');
  });
});
