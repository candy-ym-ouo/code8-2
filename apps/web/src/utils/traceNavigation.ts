import type { Trace, TraceType } from '../types/domain';

export type TraceFilter = 'ALL' | TraceType;

export interface TraceDigest {
  total: number;
  dogEars: number;
  annotations: number;
  rereadMarks: number;
  pages: number;
}

export interface PageGroup {
  page: number;
  items: Trace[];
}

export interface PageLocation {
  index: number;
  page: number;
  exact: boolean;
}

export function tracePageOf(trace: Trace): number {
  return trace.type === 'ANNOTATION' ? trace.startPage : trace.pageNumber;
}

function traceCoversPage(trace: Trace, page: number): boolean {
  if (trace.type === 'ANNOTATION') return trace.startPage <= page && page <= trace.endPage;
  return trace.pageNumber === page;
}

export function summarizeTraces(traces: readonly Trace[]): TraceDigest {
  const digest: TraceDigest = { total: traces.length, dogEars: 0, annotations: 0, rereadMarks: 0, pages: 0 };
  const pages = new Set<number>();
  for (const trace of traces) {
    if (trace.type === 'DOG_EAR') digest.dogEars += 1;
    else if (trace.type === 'ANNOTATION') digest.annotations += 1;
    else digest.rereadMarks += 1;
    pages.add(tracePageOf(trace));
  }
  digest.pages = pages.size;
  return digest;
}

export function groupTracesByPage(traces: readonly Trace[], filter: TraceFilter): PageGroup[] {
  const groups = new Map<number, Trace[]>();
  for (const trace of traces) {
    if (filter !== 'ALL' && trace.type !== filter) continue;
    const page = tracePageOf(trace);
    const bucket = groups.get(page);
    if (bucket) bucket.push(trace);
    else groups.set(page, [trace]);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, items]) => ({
      page,
      items: [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    }));
}

export function locatePageGroup(groups: readonly PageGroup[], targetPage: number): PageLocation | null {
  if (groups.length === 0 || !Number.isInteger(targetPage) || targetPage < 1) return null;
  const exactIndex = groups.findIndex((group) => group.page === targetPage);
  const exact = groups[exactIndex];
  if (exact) return { index: exactIndex, page: exact.page, exact: true };
  const coveringIndex = groups.findIndex((group) =>
    group.items.some((trace) => traceCoversPage(trace, targetPage))
  );
  const covering = groups[coveringIndex];
  if (covering) return { index: coveringIndex, page: covering.page, exact: true };
  const afterIndex = groups.findIndex((group) => group.page > targetPage);
  const after = groups[afterIndex];
  if (after) return { index: afterIndex, page: after.page, exact: false };
  const last = groups[groups.length - 1];
  return last ? { index: groups.length - 1, page: last.page, exact: false } : null;
}

export function neighborLocation(
  groups: readonly PageGroup[],
  currentPage: number,
  direction: -1 | 1
): PageLocation | null {
  if (groups.length === 0) return null;
  const currentIndex = groups.findIndex((group) => group.page === currentPage);
  if (currentIndex === -1) return locatePageGroup(groups, currentPage);
  const nextIndex = currentIndex + direction;
  const next = groups[nextIndex];
  if (!next) return null;
  return { index: nextIndex, page: next.page, exact: true };
}
