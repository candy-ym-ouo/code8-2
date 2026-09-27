import { describe, expect, it } from 'vitest';
import {
  TRACE_PAGE_SIZE,
  buildTraceQuery,
  clampListPage,
  lastListPage,
  parsePageInput,
  primaryPageOf
} from './trace-view-model';
import type { Trace } from '../types/domain';

const dogEar = (id: string, pageNumber: number): Trace => ({
  id,
  bookId: 'book-1',
  type: 'DOG_EAR',
  pageNumber,
  reason: null,
  version: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
});

const annotation = (id: string, startPage: number, endPage: number): Trace => ({
  id,
  bookId: 'book-1',
  type: 'ANNOTATION',
  startPage,
  endPage,
  content: '内容',
  version: 1,
  createdAt: '2026-09-20T00:00:00.000Z',
  updatedAt: '2026-09-20T00:00:00.000Z'
});

describe('primaryPageOf', () => {
  it('uses pageNumber for dog ears and startPage for annotations', () => {
    expect(primaryPageOf(dogEar('a', 42))).toBe(42);
    expect(primaryPageOf(annotation('b', 9, 12))).toBe(9);
  });
});

describe('parsePageInput', () => {
  it('treats blank input as unset', () => {
    expect(parsePageInput('')).toBeNull();
    expect(parsePageInput('   ')).toBeNull();
  });

  it('parses positive integers and rejects other input', () => {
    expect(parsePageInput('42')).toBe(42);
    expect(parsePageInput(' 7 ')).toBe(7);
    expect(parsePageInput('0')).toBeNull();
    expect(parsePageInput('-3')).toBeNull();
    expect(parsePageInput('1.5')).toBeNull();
    expect(parsePageInput('abc')).toBeNull();
  });
});

describe('clampListPage', () => {
  it('keeps a valid page', () => {
    expect(clampListPage(2, 40, TRACE_PAGE_SIZE)).toBe(2);
  });

  it('steps back when the current page became empty after deletion', () => {
    expect(clampListPage(3, 41, 20)).toBe(3);
    expect(clampListPage(3, 40, 20)).toBe(2);
    expect(clampListPage(2, 0, 20)).toBe(1);
  });
});

describe('lastListPage', () => {
  it('covers empty lists and partial last pages', () => {
    expect(lastListPage(0, 20)).toBe(1);
    expect(lastListPage(20, 20)).toBe(1);
    expect(lastListPage(21, 20)).toBe(2);
  });
});

describe('buildTraceQuery', () => {
  it('always sends pagination and sort', () => {
    const params = buildTraceQuery({
      tab: 'ALL',
      filters: { keyword: '', pageNumber: null },
      sort: 'page',
      page: 2
    });
    expect(params.get('page')).toBe('2');
    expect(params.get('pageSize')).toBe(String(TRACE_PAGE_SIZE));
    expect(params.get('sort')).toBe('page');
    expect(params.get('type')).toBeNull();
    expect(params.get('keyword')).toBeNull();
    expect(params.get('pageNumber')).toBeNull();
  });

  it('encodes type, keyword and jump page together', () => {
    const params = buildTraceQuery({
      tab: 'DOG_EAR',
      filters: { keyword: '这一页', pageNumber: 42 },
      sort: 'recent',
      page: 1,
      pageSize: 50
    });
    expect(params.get('type')).toBe('DOG_EAR');
    expect(params.get('keyword')).toBe('这一页');
    expect(params.get('pageNumber')).toBe('42');
    expect(params.get('sort')).toBe('recent');
    expect(params.get('pageSize')).toBe('50');
  });
});
