import { describe, expect, it } from 'vitest';
import {
  isRestoreWindowOpen,
  isStrictlyEditable,
  normalizeMoodTags,
  sortTracesBy,
  tracePrimaryPage,
  validatePageRange,
  validateStatusTransition
} from './domain.js';
import { AppError } from './errors.js';

describe('domain rules', () => {
  it('allows declared status transitions', () => {
    expect(() => validateStatusTransition('READING', 'READ')).not.toThrow();
    expect(() => validateStatusTransition('READ', 'READING')).not.toThrow();
  });

  it('rejects illegal status transitions', () => {
    expect(() => validateStatusTransition('TO_READ', 'READ')).toThrow(AppError);
    expect(() => validateStatusTransition('ABANDONED', 'READING')).toThrow(AppError);
  });

  it('validates page ranges and page count', () => {
    expect(() => validatePageRange(42, 44, 300)).not.toThrow();
    expect(() => validatePageRange(44, 42, 300)).toThrow(AppError);
    expect(() => validatePageRange(42, 301, 300)).toThrow(AppError);
  });

  it('normalizes mood tags and rejects empty or duplicate overrun', () => {
    expect(normalizeMoodTags(['MOVED', 'MOVED', 'CALM'])).toEqual(['MOVED', 'CALM']);
    expect(() => normalizeMoodTags([])).toThrow(AppError);
  });

  it('enforces restore and edit windows', () => {
    const now = new Date('2026-09-24T12:00:00.000Z');
    expect(isRestoreWindowOpen(new Date('2026-09-24T00:00:00.000Z'), now)).toBe(true);
    expect(isRestoreWindowOpen(new Date('2026-09-22T00:00:00.000Z'), now)).toBe(false);
    expect(isStrictlyEditable(new Date('2026-09-25T00:00:00.000Z'), now)).toBe(true);
    expect(isStrictlyEditable(new Date('2026-09-23T00:00:00.000Z'), now)).toBe(false);
  });

  it('locates a trace by its primary page, annotations by start page', () => {
    expect(tracePrimaryPage({ createdAt: new Date(), pageNumber: 42 })).toBe(42);
    expect(tracePrimaryPage({ createdAt: new Date(), startPage: 10 })).toBe(10);
    expect(tracePrimaryPage({ createdAt: new Date() })).toBe(0);
  });

  it('sorts traces by page with newest first on the same page', () => {
    const older = new Date('2026-09-20T08:00:00.000Z');
    const newer = new Date('2026-09-21T08:00:00.000Z');
    const traces = [
      { id: 'reread-300', createdAt: older, pageNumber: 300 },
      { id: 'dog-ear-12-new', createdAt: newer, pageNumber: 12 },
      { id: 'annotation-9-20', createdAt: older, startPage: 9 },
      { id: 'dog-ear-12-old', createdAt: older, pageNumber: 12 }
    ];
    expect(sortTracesBy(traces, 'page').map((trace) => trace.id)).toEqual([
      'annotation-9-20',
      'dog-ear-12-new',
      'dog-ear-12-old',
      'reread-300'
    ]);
    expect(sortTracesBy(traces, 'recent').map((trace) => trace.id)).toEqual([
      'dog-ear-12-new',
      'reread-300',
      'annotation-9-20',
      'dog-ear-12-old'
    ]);
    expect(traces[0]?.id).toBe('reread-300');
  });
});
