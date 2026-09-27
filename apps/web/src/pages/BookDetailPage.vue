<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../api/client';
import { booksApi, reflectionApi, timelineApi, traceApi } from '../api';
import { formatDate, formatDateTime } from '../api/format';
import ErrorNotice from '../components/ErrorNotice.vue';
import MoodPicker from '../components/MoodPicker.vue';
import {
  ACTION_LABELS,
  ENTITY_LABELS,
  MOOD_LABELS,
  STATUS_LABELS,
  TRACE_LABELS,
  type Book,
  type BookStatus,
  type MoodTag,
  type Reflection,
  type Trace,
  type TraceType
} from '../types/domain';
import {
  TRACE_PAGE_SIZE,
  buildTraceQuery,
  clampListPage,
  lastListPage,
  parsePageInput,
  primaryPageOf,
  type TraceSortMode,
  type TraceTab
} from './trace-view-model';

type DetailTab = TraceTab | 'REFLECTIONS' | 'TIMELINE';
type DeletedItem = { kind: 'DOG_EAR' | 'ANNOTATION' | 'REREAD_MARK' | 'REFLECTION'; id: string; label: string };
type ReflectionEdit = { id: string; version: number; moodTags: MoodTag[]; text: string };

const route = useRoute();
const router = useRouter();
const bookId = computed(() => String(route.params.bookId));
const book = ref<Book | null>(null);
const bookView = computed(() => book.value as Book);
const traces = ref<Trace[]>([]);
const reflections = ref<Reflection[]>([]);
const activities = ref<Array<{ id: string; action: keyof typeof ACTION_LABELS; entityType: keyof typeof ENTITY_LABELS; payload: Record<string, unknown>; occurredAt: string }>>([]);
const loading = ref(true);
const tracesLoading = ref(false);
const saving = ref(false);
const error = ref('');
const success = ref('');
const activeTab = ref<DetailTab>('ALL');
const sortMode = ref<TraceSortMode>('page');
const tracePage = ref(1);
const traceTotal = ref(0);
const filterForm = reactive({ keyword: '', pageNumber: '' });
const appliedFilters = reactive<{ keyword: string; pageNumber: number | null }>({ keyword: '', pageNumber: null });
const createType = ref<TraceType | null>(null);
const editing = ref<Trace | null>(null);
const showCompleteForm = ref(false);
const reflectionEdit = ref<ReflectionEdit | null>(null);
const lastDeleted = ref<DeletedItem | null>(null);
const traceForm = reactive({
  pageNumber: '',
  reason: '',
  startPage: '',
  endPage: '',
  content: ''
});
const completeForm = reactive({
  moodTags: [] as MoodTag[],
  text: ''
});

const totalTraceCount = computed(() => {
  const summary = book.value?.traceSummary;
  return (summary?.dogEars ?? 0) + (summary?.annotations ?? 0) + (summary?.rereadMarks ?? 0);
});

const tabs = computed(() => [
  { value: 'ALL' as const, label: `全部 ${totalTraceCount.value}` },
  { value: 'DOG_EAR' as const, label: `折角 ${book.value?.traceSummary.dogEars ?? 0}` },
  { value: 'ANNOTATION' as const, label: `批注 ${book.value?.traceSummary.annotations ?? 0}` },
  { value: 'REREAD_MARK' as const, label: `重读 ${book.value?.traceSummary.rereadMarks ?? 0}` },
  { value: 'REFLECTIONS' as const, label: `读完感受 ${reflections.value.length}` },
  { value: 'TIMELINE' as const, label: '本书时间线' }
]);

const hasActiveFilter = computed(() => appliedFilters.keyword !== '' || appliedFilters.pageNumber !== null);
const traceLastPage = computed(() => lastListPage(traceTotal.value, TRACE_PAGE_SIZE));

const statusActions = computed(() => {
  if (!book.value) return [];
  const actions: Array<{ status: BookStatus; label: string }> = [];
  if (book.value.status === 'TO_READ') {
    actions.push({ status: 'READING', label: '开始阅读' }, { status: 'ABANDONED', label: '停止阅读' });
  } else if (book.value.status === 'READING') {
    actions.push({ status: 'PAUSED', label: '暂时搁置' }, { status: 'READ', label: '标记为读完' }, { status: 'ABANDONED', label: '停止阅读' });
  } else if (book.value.status === 'PAUSED') {
    actions.push({ status: 'READING', label: '继续阅读' }, { status: 'READ', label: '标记为读完' }, { status: 'ABANDONED', label: '停止阅读' });
  } else if (book.value.status === 'READ') {
    actions.push({ status: 'READING', label: '重新阅读' });
  }
  return actions;
});

function traceRange(trace: Trace): string {
  if (trace.type === 'ANNOTATION') {
    return trace.startPage === trace.endPage ? `第 ${trace.startPage} 页` : `第 ${trace.startPage}–${trace.endPage} 页`;
  }
  return `第 ${trace.pageNumber} 页`;
}

function traceBody(trace: Trace): string {
  return trace.type === 'ANNOTATION' ? trace.content : trace.reason || '未填写原因';
}

function canEditReflection(reflection: Reflection): boolean {
  return new Date(reflection.editableUntil).getTime() >= Date.now();
}

async function loadTraces(): Promise<void> {
  const tab = activeTab.value;
  if (tab === 'REFLECTIONS' || tab === 'TIMELINE') return;
  tracesLoading.value = true;
  try {
    const fetchPage = (page: number) =>
      booksApi.traces(
        bookId.value,
        buildTraceQuery({
          tab,
          filters: { keyword: appliedFilters.keyword, pageNumber: appliedFilters.pageNumber },
          sort: sortMode.value,
          page
        })
      );
    let result = await fetchPage(tracePage.value);
    // 删除当前页最后一条后回退到仍有数据的页码，避免停在空页。
    const clamped = clampListPage(tracePage.value, result.pagination.total, TRACE_PAGE_SIZE);
    if (clamped !== tracePage.value) {
      tracePage.value = clamped;
      result = await fetchPage(clamped);
    }
    traces.value = result.items;
    traceTotal.value = result.pagination.total;
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '阅读痕迹加载失败';
  } finally {
    tracesLoading.value = false;
  }
}

/** 写操作之后静默刷新书目计数、感受、时间线与当前过滤后的痕迹视图。 */
async function refresh(): Promise<void> {
  const [bookResult, reflectionResult, timelineResult] = await Promise.all([
    booksApi.get(bookId.value),
    booksApi.reflections(bookId.value),
    timelineApi.list(new URLSearchParams({ bookId: bookId.value, pageSize: '100' })),
    loadTraces()
  ]);
  book.value = bookResult.book;
  reflections.value = reflectionResult.items;
  activities.value = timelineResult.items;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '书目加载失败';
  } finally {
    loading.value = false;
  }
}

function resetTraceForm(): void {
  traceForm.pageNumber = '';
  traceForm.reason = '';
  traceForm.startPage = '';
  traceForm.endPage = '';
  traceForm.content = '';
}

function openCreate(type: TraceType): void {
  createType.value = type;
  editing.value = null;
  resetTraceForm();
  error.value = '';
}

function openEdit(trace: Trace): void {
  createType.value = null;
  editing.value = trace;
  resetTraceForm();
  if (trace.type === 'ANNOTATION') {
    traceForm.startPage = String(trace.startPage);
    traceForm.endPage = String(trace.endPage);
    traceForm.content = trace.content;
  } else {
    traceForm.pageNumber = String(trace.pageNumber);
    traceForm.reason = trace.reason ?? '';
  }
  error.value = '';
}

function setTab(tab: DetailTab): void {
  if (activeTab.value === tab) return;
  activeTab.value = tab;
  tracePage.value = 1;
  void loadTraces();
}

function setSort(mode: TraceSortMode): void {
  if (sortMode.value === mode) return;
  sortMode.value = mode;
  tracePage.value = 1;
  void loadTraces();
}

function applyFilters(): void {
  const parsed = filterForm.pageNumber.trim() === '' ? null : parsePageInput(filterForm.pageNumber);
  if (filterForm.pageNumber.trim() !== '' && parsed === null) {
    error.value = '请输入有效的页码（大于等于 1 的整数）';
    return;
  }
  error.value = '';
  appliedFilters.keyword = filterForm.keyword.trim();
  appliedFilters.pageNumber = parsed;
  tracePage.value = 1;
  void loadTraces();
}

function clearFilters(): void {
  filterForm.keyword = '';
  filterForm.pageNumber = '';
  appliedFilters.keyword = '';
  appliedFilters.pageNumber = null;
  error.value = '';
  tracePage.value = 1;
  void loadTraces();
}

function goToTracePage(page: number): void {
  tracePage.value = page;
  void loadTraces();
}

/** 保存或恢复后切换到痕迹所属类型并定位到页码，让变化立刻出现在视图中。 */
function locateTrace(trace: Trace): void {
  activeTab.value = trace.type;
  sortMode.value = 'page';
  filterForm.keyword = '';
  appliedFilters.keyword = '';
  const page = primaryPageOf(trace);
  filterForm.pageNumber = String(page);
  appliedFilters.pageNumber = page;
  tracePage.value = 1;
}

async function submitTrace(): Promise<void> {
  if (!book.value) return;
  if (!editing.value && !createType.value) return;
  saving.value = true;
  error.value = '';
  try {
    let savedTrace: Trace | null = null;
    if (createType.value === 'DOG_EAR') {
      const result = await traceApi.createDogEar(book.value.id, {
        pageNumber: Number(traceForm.pageNumber),
        reason: traceForm.reason.trim() || null
      });
      savedTrace = result.dogEar;
    } else if (createType.value === 'ANNOTATION') {
      const result = await traceApi.createAnnotation(book.value.id, {
        startPage: Number(traceForm.startPage),
        endPage: Number(traceForm.endPage || traceForm.startPage),
        content: traceForm.content
      });
      savedTrace = result.annotation;
    } else if (createType.value === 'REREAD_MARK') {
      const result = await traceApi.createReread(book.value.id, {
        pageNumber: Number(traceForm.pageNumber),
        reason: traceForm.reason.trim() || null
      });
      savedTrace = result.rereadMark;
    } else if (editing.value?.type === 'DOG_EAR') {
      const result = await traceApi.updateDogEar(editing.value.id, {
        pageNumber: Number(traceForm.pageNumber),
        reason: traceForm.reason.trim() || null,
        version: editing.value.version
      });
      savedTrace = result.dogEar;
    } else if (editing.value?.type === 'ANNOTATION') {
      const result = await traceApi.updateAnnotation(editing.value.id, {
        startPage: Number(traceForm.startPage),
        endPage: Number(traceForm.endPage || traceForm.startPage),
        content: traceForm.content,
        version: editing.value.version
      });
      savedTrace = result.annotation;
    } else if (editing.value?.type === 'REREAD_MARK') {
      const result = await traceApi.updateReread(editing.value.id, {
        pageNumber: Number(traceForm.pageNumber),
        reason: traceForm.reason.trim() || null,
        version: editing.value.version
      });
      savedTrace = result.rereadMark;
    }
    createType.value = null;
    editing.value = null;
    success.value = '阅读痕迹已保存，已定位到所在页';
    if (savedTrace) locateTrace(savedTrace);
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '保存失败，请检查输入';
  } finally {
    saving.value = false;
  }
}

async function deleteTrace(trace: Trace): Promise<void> {
  if (!window.confirm(`确定删除${TRACE_LABELS[trace.type]}「${traceRange(trace)}」吗？24 小时内可以撤销。`)) return;
  error.value = '';
  try {
    if (trace.type === 'DOG_EAR') await traceApi.deleteDogEar(trace.id, trace.version);
    if (trace.type === 'ANNOTATION') await traceApi.deleteAnnotation(trace.id, trace.version);
    if (trace.type === 'REREAD_MARK') await traceApi.deleteReread(trace.id, trace.version);
    lastDeleted.value = { kind: trace.type, id: trace.id, label: `${TRACE_LABELS[trace.type]} ${traceRange(trace)}` };
    success.value = '已删除，可在 24 小时内撤销';
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '删除失败';
  }
}

async function restoreLastDeleted(): Promise<void> {
  if (!lastDeleted.value) return;
  error.value = '';
  try {
    const item = lastDeleted.value;
    let restoredTrace: Trace | null = null;
    if (item.kind === 'DOG_EAR') {
      const result = await traceApi.restoreDogEar(item.id);
      restoredTrace = result.dogEar;
    }
    if (item.kind === 'ANNOTATION') {
      const result = await traceApi.restoreAnnotation(item.id);
      restoredTrace = result.annotation;
    }
    if (item.kind === 'REREAD_MARK') {
      const result = await traceApi.restoreReread(item.id);
      restoredTrace = result.rereadMark;
    }
    if (item.kind === 'REFLECTION') await reflectionApi.restore(item.id);
    lastDeleted.value = null;
    success.value = '删除已撤销';
    if (restoredTrace) locateTrace(restoredTrace);
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '恢复失败';
  }
}

async function changeStatus(status: BookStatus): Promise<void> {
  if (!book.value) return;
  if (status === 'READ') {
    completeForm.moodTags = [];
    completeForm.text = '';
    showCompleteForm.value = true;
    return;
  }
  if (!window.confirm(`将「${book.value.title}」的状态改为“${STATUS_LABELS[status]}”？`)) return;
  saving.value = true;
  error.value = '';
  try {
    const result = await booksApi.updateStatus(book.value.id, { status, version: book.value.version });
    book.value = { ...book.value, ...result.book, traceSummary: book.value.traceSummary };
    success.value = '书目状态已更新';
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '状态更新失败';
  } finally {
    saving.value = false;
  }
}

async function completeBook(): Promise<void> {
  if (!book.value) return;
  if (completeForm.moodTags.length === 0) {
    error.value = '请至少选择一个读完后的情绪';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await booksApi.updateStatus(book.value.id, {
      status: 'READ',
      version: book.value.version,
      reflection: { moodTags: completeForm.moodTags, text: completeForm.text }
    });
    showCompleteForm.value = false;
    success.value = '这本书的完成感受已保存';
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '完成感受保存失败';
  } finally {
    saving.value = false;
  }
}

function openReflectionEdit(reflection: Reflection): void {
  reflectionEdit.value = {
    id: reflection.id,
    version: reflection.version,
    moodTags: [...reflection.moodTags],
    text: reflection.text
  };
}

async function saveReflection(): Promise<void> {
  if (!reflectionEdit.value) return;
  if (reflectionEdit.value.moodTags.length === 0) {
    error.value = '请至少选择一个情绪';
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await reflectionApi.update(reflectionEdit.value.id, {
      moodTags: reflectionEdit.value.moodTags,
      text: reflectionEdit.value.text,
      version: reflectionEdit.value.version
    });
    reflectionEdit.value = null;
    success.value = '完成感受已修订，旧版本仍保留在时间线中';
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '修订失败';
  } finally {
    saving.value = false;
  }
}

async function deleteReflection(reflection: Reflection): Promise<void> {
  if (!window.confirm('删除这次完成感受后，书目会回到“阅读中”。确定继续吗？')) return;
  try {
    await reflectionApi.delete(reflection.id, reflection.version);
    lastDeleted.value = { kind: 'REFLECTION', id: reflection.id, label: `第 ${reflection.completionRound} 次读完感受` };
    success.value = '完成感受已删除，可撤销';
    await refresh();
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '删除失败';
  }
}

async function deleteBook(): Promise<void> {
  if (!book.value) return;
  if (!window.confirm(`确定删除《${book.value.title}》及其全部阅读痕迹吗？此操作不可从界面撤销。`)) return;
  try {
    await booksApi.delete(book.value.id, book.value.version);
    await router.push('/');
  } catch (caught) {
    error.value = caught instanceof ApiError ? caught.message : '删除书目失败';
  }
}

function eventSummary(payload: Record<string, unknown>): string {
  if (typeof payload.pageNumber === 'number') return `第 ${payload.pageNumber} 页`;
  if (typeof payload.startPage === 'number') {
    const end = typeof payload.endPage === 'number' ? payload.endPage : payload.startPage;
    return `第 ${payload.startPage}–${end} 页`;
  }
  if (Array.isArray(payload.moodTags)) return payload.moodTags.map((tag) => MOOD_LABELS[tag as MoodTag] ?? tag).join('、');
  if (payload.cascade) return '随书目删除';
  return '';
}

onMounted(load);
</script>

<template>
  <section v-if="loading" class="state-panel">正在读取书页之间的痕迹…</section>
  <section v-else-if="book">
    <header class="detail-heading">
      <div class="detail-title">
        <div v-if="bookView.coverUrl" class="detail-cover-wrap">
          <img class="detail-cover" :src="bookView.coverUrl" :alt="`${bookView.title} 封面`" referrerpolicy="no-referrer" />
        </div>
        <div>
          <p class="eyebrow">BOOK TRACES</p>
          <span class="status-badge" :data-status="bookView.status">{{ STATUS_LABELS[bookView.status] }}</span>
          <h1>{{ bookView.title }}</h1>
          <p class="muted">{{ [bookView.author || '作者未填写', bookView.publisher, bookView.publicationYear].filter(Boolean).join(' · ') }}</p>
          <p class="muted">总页数：{{ bookView.pageCount ?? '未填写' }} · ISBN：{{ bookView.isbn || '未填写' }}</p>
        </div>
      </div>
      <div class="heading-actions">
        <RouterLink class="button" :to="`/books/${bookView.id}/edit`">编辑书目</RouterLink>
        <button class="button button-danger-quiet" type="button" @click="deleteBook">删除书目</button>
      </div>
    </header>

    <ErrorNotice :message="error" />
    <div v-if="success" class="success-notice" role="status">
      {{ success }}
      <button v-if="lastDeleted" class="text-button" type="button" @click="restoreLastDeleted">
        撤销删除「{{ lastDeleted.label }}」
      </button>
    </div>

    <section class="card status-panel">
      <div>
        <h2>阅读状态</h2>
        <p class="muted">状态只表示书与你的关系，不计算阅读进度或速度。</p>
      </div>
      <div class="button-row">
        <button
          v-for="action in statusActions"
          :key="action.status"
          class="button"
          :class="{ 'button-primary': action.status === 'READ' }"
          type="button"
          :disabled="saving"
          @click="changeStatus(action.status)"
        >
          {{ action.label }}
        </button>
        <span v-if="statusActions.length === 0" class="muted">当前状态没有可执行的后续操作</span>
      </div>
    </section>

    <form v-if="showCompleteForm" class="card completion-form" @submit.prevent="completeBook">
      <div class="section-heading">
        <div>
          <p class="eyebrow">FINISHED</p>
          <h2>读完《{{ bookView.title }}》时</h2>
        </div>
        <button class="button button-quiet" type="button" @click="showCompleteForm = false">取消</button>
      </div>
      <MoodPicker v-model="completeForm.moodTags" />
      <label>
        想留下的话（可选）
        <textarea v-model="completeForm.text" rows="5" maxlength="5000" placeholder="不写摘要，只写此刻与你有关的感受。" />
      </label>
      <button class="button button-primary" type="submit" :disabled="saving">保存完成感受</button>
    </form>

    <section class="card trace-workspace">
      <div class="section-heading">
        <div>
          <h2>阅读痕迹</h2>
          <p class="muted">折角、批注和重读页都只以页码定位，不形成进度。</p>
        </div>
        <div class="button-row">
          <button class="button" type="button" @click="openCreate('DOG_EAR')">记一次折角</button>
          <button class="button" type="button" @click="openCreate('ANNOTATION')">写批注</button>
          <button class="button" type="button" @click="openCreate('REREAD_MARK')">标记重读页</button>
        </div>
      </div>

      <form v-if="createType || editing" class="inline-editor" @submit.prevent="submitTrace">
        <h3>
          {{ editing ? `编辑${TRACE_LABELS[editing.type]}` : `新增${TRACE_LABELS[createType!]}` }}
        </h3>
        <template v-if="createType === 'ANNOTATION' || editing?.type === 'ANNOTATION'">
          <div class="form-grid compact-grid">
            <label>起始页<input v-model="traceForm.startPage" type="number" min="1" required /></label>
            <label>结束页<input v-model="traceForm.endPage" type="number" min="1" placeholder="单页可留空" /></label>
          </div>
          <label>批注<textarea v-model="traceForm.content" rows="5" maxlength="5000" required /></label>
        </template>
        <template v-else>
          <label>页码<input v-model="traceForm.pageNumber" type="number" min="1" required /></label>
          <label>
            {{ createType === 'DOG_EAR' || editing?.type === 'DOG_EAR' ? '折角原因（可选）' : '为什么重读这一页（可选）' }}
            <textarea
              v-model="traceForm.reason"
              rows="3"
              :maxlength="createType === 'REREAD_MARK' || editing?.type === 'REREAD_MARK' ? 1000 : 500"
            />
          </label>
        </template>
        <div class="form-actions">
          <button class="button button-quiet" type="button" @click="createType = null; editing = null">取消</button>
          <button class="button button-primary" type="submit" :disabled="saving">保存痕迹</button>
        </div>
      </form>

      <div class="tabs" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          class="tab"
          :class="{ active: activeTab === tab.value }"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.value"
          @click="setTab(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div v-if="activeTab === 'REFLECTIONS'" class="trace-list">
        <article v-for="reflection in reflections" :key="reflection.id" class="trace-card">
          <div class="trace-card-heading">
            <div>
              <span class="trace-type">第 {{ reflection.completionRound }} 次读完</span>
              <strong>{{ formatDate(reflection.completedAt) }}</strong>
            </div>
            <div v-if="canEditReflection(reflection)" class="button-row">
              <button class="text-button" type="button" @click="openReflectionEdit(reflection)">修订</button>
              <button class="text-button danger-text" type="button" @click="deleteReflection(reflection)">删除</button>
            </div>
          </div>
          <div class="mood-list">
            <span v-for="tag in reflection.moodTags" :key="tag" class="mood-chip selected">{{ MOOD_LABELS[tag] }}</span>
          </div>
          <p class="preserve-text">{{ reflection.text || '当时没有写下更多文字。' }}</p>
          <p class="muted">可编辑至 {{ formatDateTime(reflection.editableUntil) }}</p>
          <form v-if="reflectionEdit?.id === reflection.id" class="inline-editor" @submit.prevent="saveReflection">
            <MoodPicker v-model="reflectionEdit.moodTags" />
            <label>感受<textarea v-model="reflectionEdit.text" rows="4" maxlength="5000" /></label>
            <div class="form-actions">
              <button class="button button-quiet" type="button" @click="reflectionEdit = null">取消</button>
              <button class="button button-primary" type="submit" :disabled="saving">保存修订</button>
            </div>
          </form>
        </article>
        <p v-if="reflections.length === 0" class="empty-inline">还没有读完后留下的感受。</p>
      </div>

      <div v-else-if="activeTab === 'TIMELINE'" class="timeline-list">
        <article v-for="event in activities" :key="event.id" class="timeline-item">
          <span class="timeline-dot" aria-hidden="true" />
          <div>
            <strong>{{ ACTION_LABELS[event.action] }}{{ ENTITY_LABELS[event.entityType] }}</strong>
            <p>{{ eventSummary(event.payload) || '记录随时间更新' }}</p>
            <time :datetime="event.occurredAt">{{ formatDateTime(event.occurredAt) }}</time>
          </div>
        </article>
        <p v-if="activities.length === 0" class="empty-inline">这本书还没有变化记录。</p>
      </div>

      <div v-else class="trace-panel">
        <form class="trace-filter-bar" @submit.prevent="applyFilters">
          <div class="trace-filter-form">
            <label class="grow">
              搜索痕迹摘要
              <input
                v-model="filterForm.keyword"
                type="search"
                maxlength="100"
                placeholder="折角原因、批注内容或重读想法"
              />
            </label>
            <label class="page-jump-label">
              跳到第几页
              <input
                v-model="filterForm.pageNumber"
                type="number"
                min="1"
                :max="bookView.pageCount ?? undefined"
                placeholder="如 42"
              />
            </label>
            <div class="filter-actions">
              <button class="button" type="submit">过滤定位</button>
              <button v-if="hasActiveFilter" class="button button-quiet" type="button" @click="clearFilters">清除</button>
            </div>
          </div>
          <div class="trace-filter-meta">
            <div class="sort-toggle" role="group" aria-label="痕迹排序方式">
              <button
                class="sort-option"
                :class="{ active: sortMode === 'page' }"
                type="button"
                :aria-pressed="sortMode === 'page'"
                @click="setSort('page')"
              >
                按页码
              </button>
              <button
                class="sort-option"
                :class="{ active: sortMode === 'recent' }"
                type="button"
                :aria-pressed="sortMode === 'recent'"
                @click="setSort('recent')"
              >
                按时间
              </button>
            </div>
            <p class="muted filter-status" role="status">
              <span v-if="appliedFilters.pageNumber !== null" class="filter-chip">已定位第 {{ appliedFilters.pageNumber }} 页</span>
              <span v-if="appliedFilters.keyword" class="filter-chip">含“{{ appliedFilters.keyword }}”</span>
              <span>共 {{ traceTotal }} 条</span>
            </p>
          </div>
        </form>

        <div v-if="tracesLoading" class="state-panel">正在翻找这几页的痕迹…</div>
        <template v-else>
          <div class="trace-list">
            <article
              v-for="trace in traces"
              :key="`${trace.type}-${trace.id}`"
              class="trace-card"
              :class="{ located: appliedFilters.pageNumber === primaryPageOf(trace) }"
            >
              <div class="trace-card-heading">
                <div>
                  <span class="trace-type">{{ TRACE_LABELS[trace.type] }}</span>
                  <strong>{{ traceRange(trace) }}</strong>
                </div>
                <div class="button-row">
                  <button class="text-button" type="button" @click="openEdit(trace)">编辑</button>
                  <button class="text-button danger-text" type="button" @click="deleteTrace(trace)">删除</button>
                </div>
              </div>
              <p class="preserve-text">{{ traceBody(trace) }}</p>
              <p class="muted">创建 {{ formatDateTime(trace.createdAt) }} · 更新 {{ formatDateTime(trace.updatedAt) }}</p>
            </article>
            <p v-if="traces.length === 0" class="empty-inline">
              {{ hasActiveFilter ? '没有符合当前过滤的痕迹，清除定位后再看看。' : '这个分类还没有留下痕迹。' }}
            </p>
          </div>
          <nav v-if="traceTotal > TRACE_PAGE_SIZE" class="pagination" aria-label="痕迹分页">
            <button class="button button-quiet" type="button" :disabled="tracePage <= 1" @click="goToTracePage(tracePage - 1)">
              上一页
            </button>
            <span>第 {{ tracePage }} / {{ traceLastPage }} 页 · 共 {{ traceTotal }} 条</span>
            <button
              class="button button-quiet"
              type="button"
              :disabled="tracePage >= traceLastPage"
              @click="goToTracePage(tracePage + 1)"
            >
              下一页
            </button>
          </nav>
        </template>
      </div>
    </section>
  </section>
  <section v-else class="empty-state card">
    <h1>书目不可用</h1>
    <ErrorNotice :message="error" />
    <RouterLink class="button button-primary" to="/">返回我的书</RouterLink>
  </section>
</template>
