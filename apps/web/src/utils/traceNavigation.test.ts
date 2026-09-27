import { describe, expect, it } from 'vitest';
import type { Annotation, DogEar, RereadMark, Trace } from '../types/domain';
import {
  groupTracesByPage,
  locatePageGroup,
  neighborLocation,
  summarizeTraces,
  tracePageOf
} from './traceNavigation';

function dogEar(id: string, pageNumber: number, createdAt = '2026-01-01T00:00:00.000Z'): DogEar {
  return {
    id,
    bookId: 'book-1',
    type: 'DOG_EAR',
    pageNumber,
    reason: null,
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

function annotation(id: string, startPage: number, endPage: number, createdAt = '2026-01-01T00:00:00.000Z'): Annotation {
  return {
    id,
    bookId: 'book-1',
    type: 'ANNOTATION',
    startPage,
    endPage,
    content: '批注',
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

function reread(id: string, pageNumber: number, createdAt = '2026-01-01T00:00:00.000Z'): RereadMark {
  return {
    id,
    bookId: 'book-1',
    type: 'REREAD_MARK',
    pageNumber,
    reason: null,
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

const sample: Trace[] = [
  dogEar('d1', 12, '2026-01-02T00:00:00.000Z'),
  annotation('a1', 10, 14, '2026-01-01T00:00:00.000Z'),
  reread('r1', 12, '2026-01-03T00:00:00.000Z'),
  dogEar('d2', 40, '2026-01-04T00:00:00.000Z'),
  annotation('a2', 10, 10, '2026-01-05T00:00:00.000Z')
];

describe('tracePageOf', () => {
  it('uses the start page for annotations and the page number otherwise', () => {
    expect(tracePageOf(dogEar('d', 7))).toBe(7);
    expect(tracePageOf(annotation('a', 3, 9))).toBe(3);
    expect(tracePageOf(reread('r', 21))).toBe(21);
  });
});

describe('summarizeTraces', () => {
  it('counts each type and the distinct pages covered', () => {
    expect(summarizeTraces(sample)).toEqual({
      total: 5,
      dogEars: 2,
      annotations: 2,
      rereadMarks: 1,
      pages: 3
    });
  });

  it('returns zeros for an empty list', () => {
    expect(summarizeTraces([])).toEqual({ total: 0, dogEars: 0, annotations: 0, rereadMarks: 0, pages: 0 });
  });
});

describe('groupTracesByPage', () => {
  it('groups by page ascending and sorts items inside a page by newest first', () => {
    const groups = groupTracesByPage(sample, 'ALL');
    expect(groups.map((group) => group.page)).toEqual([10, 12, 40]);
    expect(groups[1]?.items.map((trace) => trace.id)).toEqual(['r1', 'd1']);
    expect(groups[0]?.items.map((trace) => trace.id)).toEqual(['a2', 'a1']);
  });

  it('filters by trace type', () => {
    const groups = groupTracesByPage(sample, 'DOG_EAR');
    expect(groups.map((group) => group.page)).toEqual([12, 40]);
    expect(groups[0]?.items.map((trace) => trace.id)).toEqual(['d1']);
  });

  it('returns no groups when the filter matches nothing', () => {
    expect(groupTracesByPage(sample, 'REREAD_MARK').map((group) => group.page)).toEqual([12]);
    expect(groupTracesByPage([], 'ALL')).toEqual([]);
  });
});

describe('locatePageGroup', () => {
  const groups = groupTracesByPage(sample, 'ALL');

  it('finds the exact page group', () => {
    expect(locatePageGroup(groups, 12)).toEqual({ index: 1, page: 12, exact: true });
  });

  it('treats a page inside an annotation range as an exact hit', () => {
    expect(locatePageGroup(groups, 11)).toEqual({ index: 0, page: 10, exact: true });
    expect(locatePageGroup(groups, 14)).toEqual({ index: 0, page: 10, exact: true });
  });

  it('falls forward to the next page with traces', () => {
    expect(locatePageGroup(groups, 15)).toEqual({ index: 2, page: 40, exact: false });
  });

  it('clamps to the last group when the target is beyond every trace', () => {
    expect(locatePageGroup(groups, 99)).toEqual({ index: 2, page: 40, exact: false });
  });

  it('clamps to the first group when the target is before every trace', () => {
    expect(locatePageGroup(groups, 1)).toEqual({ index: 0, page: 10, exact: false });
  });

  it('returns null for empty groups or invalid pages', () => {
    expect(locatePageGroup([], 10)).toBeNull();
    expect(locatePageGroup(groups, 0)).toBeNull();
    expect(locatePageGroup(groups, Number.NaN)).toBeNull();
  });
});

describe('neighborLocation', () => {
  const groups = groupTracesByPage(sample, 'ALL');

  it('steps to the previous and next page with traces', () => {
    expect(neighborLocation(groups, 12, -1)).toEqual({ index: 0, page: 10, exact: true });
    expect(neighborLocation(groups, 12, 1)).toEqual({ index: 2, page: 40, exact: true });
  });

  it('returns null at the edges', () => {
    expect(neighborLocation(groups, 10, -1)).toBeNull();
    expect(neighborLocation(groups, 40, 1)).toBeNull();
  });

  it('locates the nearest group first when the current page vanished', () => {
    expect(neighborLocation(groups, 20, 1)).toEqual({ index: 2, page: 40, exact: false });
    expect(neighborLocation([], 20, 1)).toBeNull();
  });
});
