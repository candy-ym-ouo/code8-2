import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookDetailPage from './BookDetailPage.vue';
import type { Annotation, Book, DogEar, Trace } from '../types/domain';

const traceStore = vi.hoisted(() => ({ items: [] as Trace[], deleted: [] as Trace[] }));

const bookFixture: Book = {
  id: 'book-1',
  title: '跳页测试书',
  author: '作者',
  publisher: null,
  publicationYear: null,
  isbn: null,
  pageCount: 300,
  coverUrl: null,
  status: 'READING',
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  traceSummary: { dogEars: 0, annotations: 0, rereadMarks: 0 }
};

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { bookId: 'book-1' } }),
  useRouter: () => ({ push: vi.fn() })
}));

vi.mock('../api', () => {
  const remove = (id: string) => {
    const index = traceStore.items.findIndex((trace) => trace.id === id);
    if (index !== -1) traceStore.deleted.push(...traceStore.items.splice(index, 1));
  };
  const restore = (id: string) => {
    const index = traceStore.deleted.findIndex((trace) => trace.id === id);
    if (index === -1) throw new Error('not found');
    const [trace] = traceStore.deleted.splice(index, 1);
    if (!trace) throw new Error('not found');
    traceStore.items.push(trace);
    return trace;
  };
  return {
    booksApi: {
      get: vi.fn(async () => ({ book: { ...bookFixture } })),
      traces: vi.fn(async () => ({
        items: [...traceStore.items],
        pagination: { page: 1, pageSize: 100, total: traceStore.items.length }
      })),
      reflections: vi.fn(async () => ({ items: [] })),
      updateStatus: vi.fn(),
      delete: vi.fn()
    },
    traceApi: {
      createDogEar: vi.fn(),
      createAnnotation: vi.fn(),
      createReread: vi.fn(),
      updateDogEar: vi.fn(),
      updateAnnotation: vi.fn(),
      updateReread: vi.fn(),
      deleteDogEar: vi.fn(async (id: string) => remove(id)),
      deleteAnnotation: vi.fn(async (id: string) => remove(id)),
      deleteReread: vi.fn(async (id: string) => remove(id)),
      restoreDogEar: vi.fn(async (id: string) => ({ dogEar: restore(id) })),
      restoreAnnotation: vi.fn(async (id: string) => ({ annotation: restore(id) })),
      restoreReread: vi.fn(async (id: string) => ({ rereadMark: restore(id) }))
    },
    reflectionApi: { update: vi.fn(), delete: vi.fn(), restore: vi.fn() },
    timelineApi: {
      list: vi.fn(async () => ({ items: [], pagination: { page: 1, pageSize: 100, total: 0 } }))
    }
  };
});

function dogEar(id: string, pageNumber: number, createdAt = '2026-01-01T00:00:00.000Z'): DogEar {
  return {
    id,
    bookId: 'book-1',
    type: 'DOG_EAR',
    pageNumber,
    reason: `折角原因 ${id}`,
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
    content: `批注内容 ${id}`,
    version: 1,
    createdAt,
    updatedAt: createdAt
  };
}

function seedSample(): void {
  traceStore.items = [
    dogEar('d1', 5, '2026-01-01T08:00:00.000Z'),
    dogEar('d2', 12, '2026-01-02T08:00:00.000Z'),
    annotation('a1', 12, 14, '2026-01-03T08:00:00.000Z')
  ];
  traceStore.deleted = [];
}

async function mountPage() {
  const wrapper = mount(BookDetailPage, { global: { stubs: { RouterLink: true } } });
  await flushPromises();
  return wrapper;
}

async function jumpTo(wrapper: Awaited<ReturnType<typeof mountPage>>, page: string) {
  await wrapper.find('.trace-jump-field input').setValue(page);
  await wrapper.find('.trace-jump').trigger('submit');
  await flushPromises();
}

describe('BookDetailPage 痕迹摘要过滤与跳页定位', () => {
  beforeEach(() => {
    seedSample();
    Element.prototype.scrollIntoView = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows digest counts and page groups derived from the traces', async () => {
    const wrapper = await mountPage();
    const chips = wrapper.findAll('.digest-chip');
    expect(chips.map((chip) => chip.text())).toEqual(['全部 3', '折角 2', '批注 1', '重读 0']);
    expect(wrapper.find('.digest-pages').text()).toBe('覆盖 2 页');
    expect(wrapper.findAll('.page-group').map((group) => group.attributes('data-page-group'))).toEqual(['5', '12']);
    expect(wrapper.find('[data-page-group="12"]').text()).toContain('2 条痕迹');
  });

  it('filters the trace list when a digest chip is selected', async () => {
    const wrapper = await mountPage();
    await wrapper.findAll('.digest-chip')[2]?.trigger('click');
    expect(wrapper.findAll('.page-group').map((group) => group.attributes('data-page-group'))).toEqual(['12']);
    expect(wrapper.text()).toContain('批注内容 a1');
    expect(wrapper.text()).not.toContain('折角原因 d1');

    await wrapper.findAll('.digest-chip')[1]?.trigger('click');
    expect(wrapper.findAll('.page-group').map((group) => group.attributes('data-page-group'))).toEqual(['5', '12']);
    expect(wrapper.text()).not.toContain('批注内容 a1');
  });

  it('locates an exact page and the nearest page when there is no trace', async () => {
    const wrapper = await mountPage();
    await jumpTo(wrapper, '12');
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('12');
    expect(wrapper.find('.jump-hint').text()).toBe('已定位到第 12 页');

    await jumpTo(wrapper, '7');
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('12');
    expect(wrapper.find('.jump-hint').text()).toBe('第 7 页没有痕迹，已定位到最近的第 12 页');
    expect((wrapper.find('.trace-jump-field input').element as HTMLInputElement).value).toBe('12');
  });

  it('steps between pages with traces using previous and next buttons', async () => {
    const wrapper = await mountPage();
    const [prev, next] = wrapper.findAll('.trace-jump .button-quiet');
    expect(prev?.attributes('disabled')).toBeDefined();
    expect(next?.attributes('disabled')).toBeDefined();

    await jumpTo(wrapper, '5');
    expect(prev?.attributes('disabled')).toBeDefined();
    await next?.trigger('click');
    await flushPromises();
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('12');

    await wrapper.findAll('.trace-jump .button-quiet')[0]?.trigger('click');
    await flushPromises();
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('5');
  });

  it('refreshes counts, order and location after deletion and restore', async () => {
    const wrapper = await mountPage();
    await jumpTo(wrapper, '12');

    const group12 = wrapper.find('[data-page-group="12"]');
    const deleteButtons = group12.findAll('.danger-text');
    expect(deleteButtons).toHaveLength(2);

    // 删除第 12 页的批注后，该页还有折角，定位保留，计数减一
    await deleteButtons[0]?.trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.digest-chip')[0]?.text()).toBe('全部 2');
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('12');

    // 再删除该页的折角，第 12 页没有痕迹了，定位同步取消
    await wrapper.find('[data-page-group="12"] .danger-text').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.digest-chip')[0]?.text()).toBe('全部 1');
    expect(wrapper.find('[data-page-group="12"]').exists()).toBe(false);
    expect(wrapper.find('.page-group.located').exists()).toBe(false);
    expect(wrapper.find('.jump-hint').text()).toBe('第 12 页的痕迹已变化，定位已取消');

    // 撤销删除后计数恢复，并重新定位到恢复的页
    await wrapper.find('.success-notice .text-button').trigger('click');
    await flushPromises();
    expect(wrapper.findAll('.digest-chip')[0]?.text()).toBe('全部 2');
    expect(wrapper.find('.page-group.located').attributes('data-page-group')).toBe('12');
    expect(wrapper.find('.jump-hint').text()).toBe('已定位到第 12 页');
  });

  it('keeps jumping fast with many dog ears by rendering groups incrementally', async () => {
    traceStore.items = Array.from({ length: 40 }, (_, index) =>
      dogEar(`d${index + 1}`, index + 1, '2026-01-01T08:00:00.000Z')
    );
    const wrapper = await mountPage();

    expect(wrapper.findAll('.page-group')).toHaveLength(15);
    expect(wrapper.find('[data-page-group="35"]').exists()).toBe(false);
    expect(wrapper.find('.show-more-row .button').text()).toBe('显示更多（还有 25 页）');

    await jumpTo(wrapper, '35');
    const located = wrapper.find('.page-group.located');
    expect(located.exists()).toBe(true);
    expect(located.attributes('data-page-group')).toBe('35');
    expect(wrapper.find('.show-more-row .button').text()).toBe('显示更多（还有 5 页）');

    await wrapper.find('.show-more-row .button').trigger('click');
    await flushPromises();
    expect(wrapper.find('.show-more-row').exists()).toBe(false);
    expect(wrapper.findAll('.page-group')).toHaveLength(40);
  });
});
