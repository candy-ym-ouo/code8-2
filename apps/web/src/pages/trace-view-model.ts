import type { Trace, TraceType } from '../types/domain';

export const TRACE_PAGE_SIZE = 20;

export type TraceSortMode = 'page' | 'recent';
export type TraceTab = 'ALL' | TraceType;

export interface TraceFilters {
  keyword: string;
  pageNumber: number | null;
}

/** 痕迹在列表中定位使用的主页码：批注取起始页，其余取记录页码。 */
export function primaryPageOf(trace: Trace): number {
  return trace.type === 'ANNOTATION' ? trace.startPage : trace.pageNumber;
}

/** 解析跳页输入：空字符串表示未设置；非法页码返回 null。 */
export function parsePageInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 1) return null;
  return value;
}

/** 删除最后一条后页码不越界：空列表时也保证至少停在第 1 页。 */
export function clampListPage(page: number, total: number, pageSize: number): number {
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  return Math.min(Math.max(1, page), lastPage);
}

export function lastListPage(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

export interface TraceQueryInput {
  tab: TraceTab;
  filters: TraceFilters;
  sort: TraceSortMode;
  page: number;
  pageSize?: number;
}

/** 构造书目详情痕迹列表的查询参数，过滤与跳页都由服务端完成。 */
export function buildTraceQuery(input: TraceQueryInput): URLSearchParams {
  const pageSize = input.pageSize ?? TRACE_PAGE_SIZE;
  const params = new URLSearchParams({
    page: String(input.page),
    pageSize: String(pageSize),
    sort: input.sort
  });
  if (input.tab !== 'ALL') params.set('type', input.tab);
  if (input.filters.keyword) params.set('keyword', input.filters.keyword);
  if (input.filters.pageNumber !== null) params.set('pageNumber', String(input.filters.pageNumber));
  return params;
}
