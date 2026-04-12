import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Eye, FileText, RefreshCw, Rocket, Save, Search, Upload, Wand2 } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import { LoadingState } from '../components/LoadingState';
import { ErrorState } from '../components/ErrorState';
import { extractMarkdownFromImport } from '../utils/richTextToMarkdown';

interface ReviewItem {
  code: string;
  message: string;
  recommendation: string;
  category?: string;
  severity?: string;
}

interface ReviewReport {
  decision: 'approved' | 'rejected';
  overallScore: number;
  seoScore: number;
  geoScore: number;
  aeoScore: number;
  formatScore?: number;
  blockers: ReviewItem[];
  recommendations: ReviewItem[];
  summary: string;
  editorial_review?: {
    status: 'available' | 'unavailable' | 'error';
    summary: string;
    provider: string | null;
    model: string | null;
    verdict: string;
    confidence: string;
    citationPotential: number;
    aeoStrength: number;
    frameworkAlignment: number;
    pageType: string;
    retrievalGoal: string;
    blockers: Array<{ title: string; detail: string }>;
    improvements: Array<{ title: string; recommendation: string }>;
    priorityRewrites: {
      title?: string;
      answerBlock?: string;
      faq?: string;
    };
    error?: string;
  };
}

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  answer_summary: string;
  target_query: string;
  target_intent: string;
  primary_keyword: string;
  hero_image_url: string | null;
  body_markdown: string;
  author_name: string;
  status: 'draft' | 'published' | 'archived';
  review_status: 'unreviewed' | 'approved' | 'rejected';
  review_report: ReviewReport | null;
  tags: string[];
  published_at: string | null;
  updated_at: string;
}

interface BlogFormState {
  title: string;
  slug: string;
  excerpt: string;
  answer_summary: string;
  target_query: string;
  target_intent: string;
  primary_keyword: string;
  hero_image_url: string;
  body_markdown: string;
  author_name: string;
  tags: string;
}

interface BlogAutofillDraft {
  title: string;
  slug: string;
  excerpt: string;
  answer_summary: string;
  target_query: string;
  target_intent: string;
  primary_keyword: string;
  tags: string[];
  source: string;
}

const EMPTY_FORM: BlogFormState = {
  title: '',
  slug: '',
  excerpt: '',
  answer_summary: '',
  target_query: '',
  target_intent: 'informational',
  primary_keyword: '',
  hero_image_url: '',
  body_markdown: '',
  author_name: '',
  tags: '',
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-AU', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formFromPost(post: BlogPost): BlogFormState {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    answer_summary: post.answer_summary,
    target_query: post.target_query,
    target_intent: post.target_intent,
    primary_keyword: post.primary_keyword,
    hero_image_url: post.hero_image_url || '',
    body_markdown: post.body_markdown,
    author_name: post.author_name,
    tags: post.tags.join(', '),
  };
}

function createPayload(form: BlogFormState) {
  return {
    ...form,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean),
  };
}

function normalizeComparablePost(post: BlogPost | null) {
  if (!post) return null;
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    answer_summary: post.answer_summary,
    target_query: post.target_query,
    target_intent: post.target_intent,
    primary_keyword: post.primary_keyword,
    hero_image_url: post.hero_image_url || '',
    body_markdown: post.body_markdown,
    author_name: post.author_name,
    tags: [...post.tags],
  };
}

function mergeAutofillIntoForm(
  current: BlogFormState,
  draft: BlogAutofillDraft,
  options: { overwrite?: boolean; keepExistingSlug?: boolean } = {}
) {
  const overwrite = options.overwrite ?? false;
  const keepExistingSlug = options.keepExistingSlug ?? false;
  return {
    ...current,
    title: overwrite || !current.title.trim() ? (draft.title || current.title) : current.title,
    slug: keepExistingSlug
      ? current.slug
      : ((overwrite || !current.slug.trim()) ? (draft.slug || current.slug) : current.slug),
    excerpt: overwrite || !current.excerpt.trim() ? (draft.excerpt || current.excerpt) : current.excerpt,
    answer_summary: overwrite || !current.answer_summary.trim()
      ? (draft.answer_summary || current.answer_summary)
      : current.answer_summary,
    target_query: overwrite || !current.target_query.trim()
      ? (draft.target_query || current.target_query)
      : current.target_query,
    target_intent: overwrite || current.target_intent === 'informational'
      ? (draft.target_intent || current.target_intent)
      : current.target_intent,
    primary_keyword: overwrite || !current.primary_keyword.trim()
      ? (draft.primary_keyword || current.primary_keyword)
      : current.primary_keyword,
    tags: overwrite || !current.tags.trim() ? (draft.tags.join(', ') || current.tags) : current.tags,
  };
}

export function Blog() {
  const { get, post, put, loading, setError } = useApi();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [postsLoadError, setPostsLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<BlogFormState>(EMPTY_FORM);
  const [previewHtml, setPreviewHtml] = useState('');
  const [busyAction, setBusyAction] = useState<'save' | 'autofill' | 'review' | 'preview' | 'publish' | 'unpublish' | null>(null);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const markdownFileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedPost = useMemo(
    () => posts.find((postItem) => postItem.id === selectedId) || null,
    [posts, selectedId]
  );

  const fetchPosts = useCallback(async () => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    const query = params.toString();
    const data = await get<{ posts: BlogPost[] }>(`/blog/posts${query ? `?${query}` : ''}`);
    setPosts(data.posts);
  }, [get, search]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (search.trim()) params.set('search', search.trim());
        const query = params.toString();
        const data = await get<{ posts: BlogPost[] }>(`/blog/posts${query ? `?${query}` : ''}`);
        if (cancelled) return;
        setPosts(data.posts);
        setPostsLoadError(null);
      } catch (loadError) {
        if (!cancelled) {
          setPosts([]);
          setPostsLoadError(loadError instanceof Error ? loadError.message : 'Failed to load blog posts');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, search]);

  useEffect(() => {
    if (!selectedId) {
      setForm(EMPTY_FORM);
      setPreviewHtml('');
      setSlugTouched(false);
      setShowMetadata(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const data = await get<{ post: BlogPost }>(`/blog/posts/${selectedId}`);
        if (cancelled) return;
        setForm(formFromPost(data.post));
        setPreviewHtml('');
        setSlugTouched(true);
        setShowMetadata(Boolean(
          data.post.answer_summary ||
          data.post.target_query ||
          data.post.primary_keyword ||
          data.post.hero_image_url ||
          data.post.tags.length
        ));
      } catch {
        if (!cancelled) {
          setPreviewHtml('');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [get, selectedId]);

  const setField = <K extends keyof BlogFormState>(field: K, value: BlogFormState[K]) => {
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (field === 'title' && !slugTouched) {
        next.slug = slugify(String(value));
      }
      return next;
    });
  };

  const runAutofill = useCallback(async ({
    markdown,
    overwrite = false,
  }: {
    markdown?: string;
    overwrite?: boolean;
  } = {}) => {
    const bodyMarkdown = (markdown ?? form.body_markdown).trim();
    if (!bodyMarkdown) {
      setNotice({ type: 'error', text: 'Paste or import an article first so the editor has something to infer from.' });
      return;
    }

    setBusyAction('autofill');
    setNotice(null);
    try {
      const data = await post<{ draft: BlogAutofillDraft }>('/blog/posts/autofill', {
        title: form.title,
        body_markdown: bodyMarkdown,
      });
      setForm((current) => mergeAutofillIntoForm(current, data.draft, {
        overwrite,
        keepExistingSlug: slugTouched && current.slug.trim().length > 0,
      }));
      setShowMetadata(true);
      setNotice({
        type: 'success',
        text: overwrite
          ? 'Metadata refreshed from the article draft.'
          : 'Filled the missing metadata fields from the article draft.',
      });
    } catch (autofillError) {
      setNotice({
        type: 'error',
        text: autofillError instanceof Error ? autofillError.message : 'Failed to infer metadata from article draft.',
      });
    } finally {
      setBusyAction(null);
    }
  }, [form.body_markdown, form.title, post, slugTouched]);

  const applyImportedMarkdown = useCallback((markdown: string, sourceLabel: string) => {
    const normalized = markdown.trim();
    if (!normalized) {
      setNotice({ type: 'error', text: `No usable markdown found in ${sourceLabel}.` });
      return;
    }

    setForm((current) => ({ ...current, body_markdown: normalized }));
    setNotice({ type: 'success', text: `${sourceLabel} imported into markdown.` });
    void runAutofill({ markdown: normalized, overwrite: true });
  }, [runAutofill]);

  const handleMarkdownFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const raw = await file.text();
      const markdown = extractMarkdownFromImport(raw, file.type);
      applyImportedMarkdown(markdown, file.name);
    } catch (importError) {
      setNotice({
        type: 'error',
        text: importError instanceof Error ? importError.message : 'Failed to import file.',
      });
    } finally {
      event.target.value = '';
    }
  };

  const handleBodyPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData('text/html');
    if (!html.trim()) {
      return;
    }

    const markdown = extractMarkdownFromImport(html, 'text/html');
    if (!markdown) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    const start = target.selectionStart ?? form.body_markdown.length;
    const end = target.selectionEnd ?? form.body_markdown.length;
    const prefix = form.body_markdown.slice(0, start);
    const suffix = form.body_markdown.slice(end);
    const needsLeadingNewline = prefix.length > 0 && !prefix.endsWith('\n');
    const needsTrailingNewline = suffix.length > 0 && !suffix.startsWith('\n');
    const insertion = `${needsLeadingNewline ? '\n\n' : ''}${markdown}${needsTrailingNewline ? '\n\n' : ''}`;

    setField('body_markdown', `${prefix}${insertion}${suffix}`);
    setNotice({ type: 'success', text: 'Converted rich-text paste into markdown.' });
    if (prefix.length === 0 && suffix.length === 0) {
      void runAutofill({ markdown, overwrite: true });
    }
  };

  const payload = useMemo(() => createPayload(form), [form]);
  const hasUnsavedChanges = useMemo(() => {
    const comparablePost = normalizeComparablePost(selectedPost);
    if (!selectedId) {
      return Object.values(payload).some((value) => Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0);
    }
    if (!comparablePost) return false;
    return JSON.stringify(payload) !== JSON.stringify(comparablePost);
  }, [payload, selectedId, selectedPost]);

  const saveCurrent = async () => {
    setBusyAction('save');
    setNotice(null);
    setError(null);
    try {
      const data = selectedId
        ? await put<{ post: BlogPost }>(`/blog/posts/${selectedId}`, payload)
        : await post<{ post: BlogPost }>('/blog/posts', payload);
      await fetchPosts();
      setSelectedId(data.post.id);
      setForm(formFromPost(data.post));
      setShowMetadata(Boolean(
        data.post.answer_summary ||
        data.post.target_query ||
        data.post.primary_keyword ||
        data.post.hero_image_url ||
        data.post.tags.length
      ));
      setNotice({ type: 'success', text: 'Draft saved.' });
      return data.post;
    } catch (saveError) {
      setNotice({ type: 'error', text: saveError instanceof Error ? saveError.message : 'Failed to save draft' });
      throw saveError;
    } finally {
      setBusyAction(null);
    }
  };

  const handleReview = async () => {
    try {
      const postRecord = !selectedId || hasUnsavedChanges ? await saveCurrent() : selectedPost;
      if (!postRecord) return;
      setBusyAction('review');
      setNotice(null);
      const data = await post<{ post: BlogPost; report: ReviewReport }>(`/blog/posts/${postRecord.id}/review`, {});
      await fetchPosts();
      setSelectedId(data.post.id);
      setForm(formFromPost(data.post));
      setShowMetadata(true);
      setNotice({
        type: data.report.decision === 'approved' ? 'success' : 'error',
        text: data.report.decision === 'approved' ? 'Review approved this post.' : 'Review rejected this post. Fix blockers and retry.',
      });
    } catch (reviewError) {
      setNotice({ type: 'error', text: reviewError instanceof Error ? reviewError.message : 'Review failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePreview = async () => {
    setBusyAction('preview');
    setNotice(null);
    try {
      const data = await post<{ html: string }>('/blog/posts/preview', payload);
      setPreviewHtml(data.html);
    } catch (previewError) {
      setNotice({ type: 'error', text: previewError instanceof Error ? previewError.message : 'Preview failed' });
    } finally {
      setBusyAction(null);
    }
  };

  const handlePublishToggle = async (nextAction: 'publish' | 'unpublish') => {
    if (!selectedId) return;
    if (nextAction === 'publish' && hasUnsavedChanges) {
      try {
        const saved = await saveCurrent();
        if (!saved) return;
        setNotice({ type: 'error', text: 'Draft changed. Review the saved version again before publishing.' });
        return;
      } catch {
        return;
      }
    }
    setBusyAction(nextAction);
    setNotice(null);
    try {
      const data = await post<{ post: BlogPost }>(`/blog/posts/${selectedId}/${nextAction}`, {});
      await fetchPosts();
      setForm(formFromPost(data.post));
      setSelectedId(data.post.id);
      setShowMetadata(Boolean(
        data.post.answer_summary ||
        data.post.target_query ||
        data.post.primary_keyword ||
        data.post.hero_image_url ||
        data.post.tags.length
      ));
      setNotice({ type: 'success', text: nextAction === 'publish' ? 'Post published.' : 'Post moved back to draft.' });
    } catch (actionError) {
      setNotice({ type: 'error', text: actionError instanceof Error ? actionError.message : 'Publish action failed' });
    } finally {
      setBusyAction(null);
    }
  };

  if (loading && posts.length === 0) {
    return <LoadingState message="Loading blog posts..." />;
  }

  if (postsLoadError && posts.length === 0) {
    return <ErrorState message={`Error loading blog posts: ${postsLoadError}`} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <BookOpen className="w-7 h-7 text-rose-400" />
          Blog Publishing
        </h1>
        <p className="text-slate-400 text-sm mt-1">Create markdown posts, run SEO/GEO/AEO review, and publish approved articles.</p>
        {selectedId && hasUnsavedChanges ? (
          <p className="text-amber-300 text-sm mt-2">You have unsaved edits. Review will save them first. Publish will stop until the saved draft passes review again.</p>
        ) : null}
      </div>

      {notice && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${
          notice.type === 'success'
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
        }`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
        <section className="card rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search posts..."
                className="w-full pl-10 pr-3 py-2 bg-slate-800/50 border border-slate-700 rounded-lg text-sm text-slate-200"
              />
            </div>
            <button
              onClick={() => {
                setSelectedId(null);
                setForm(EMPTY_FORM);
                setPreviewHtml('');
                setSlugTouched(false);
                setShowMetadata(false);
                setNotice(null);
              }}
              className="px-3 py-2 bg-rose-500/20 text-rose-300 rounded-lg text-sm font-medium hover:bg-rose-500/30"
            >
              New
            </button>
          </div>

          <div className="space-y-2">
            {posts.length === 0 ? (
              <p className="text-sm text-slate-500">No blog posts yet.</p>
            ) : (
              posts.map((postItem) => (
                <button
                  key={postItem.id}
                  onClick={() => setSelectedId(postItem.id)}
                  className={`w-full text-left rounded-xl border p-3 transition-colors ${
                    selectedId === postItem.id
                      ? 'border-rose-500/50 bg-rose-500/10'
                      : 'border-slate-700/50 bg-slate-900/30 hover:bg-slate-800/50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-white line-clamp-2">{postItem.title}</p>
                    <span className={`text-[10px] uppercase tracking-wide ${
                      postItem.status === 'published' ? 'text-emerald-300' : 'text-slate-500'
                    }`}>
                      {postItem.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{postItem.slug}</p>
                  <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
                    <span>{postItem.review_status}</span>
                    <span>{formatDate(postItem.published_at || postItem.updated_at)}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="card rounded-xl p-5 space-y-5">
            <div className="flex flex-wrap items-center gap-3 justify-between">
              <div>
                <h2 className="text-lg font-semibold text-white">{selectedId ? 'Edit Post' : 'New Post'}</h2>
                <p className="text-sm text-slate-400">Markdown-first publishing with deterministic review.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={saveCurrent}
                  disabled={busyAction !== null}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  Save Draft
                </button>
                <button
                  onClick={handlePreview}
                  disabled={busyAction !== null}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </button>
                <button
                  onClick={handleReview}
                  disabled={busyAction !== null}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${busyAction === 'review' ? 'animate-spin' : ''}`} />
                  Run Review
                </button>
                {selectedPost?.status === 'published' ? (
                  <button
                    onClick={() => handlePublishToggle('unpublish')}
                    disabled={busyAction !== null}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Rocket className="w-4 h-4" />
                    Unpublish
                  </button>
                ) : (
                  <button
                    onClick={() => handlePublishToggle('publish')}
                    disabled={busyAction !== null || selectedPost?.review_status !== 'approved'}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500 text-white hover:bg-rose-600 disabled:opacity-50"
                  >
                    <Rocket className="w-4 h-4" />
                    Publish
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="space-y-1 md:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-xs uppercase tracking-wide text-slate-500">Article Markdown</span>
                    <p className="mt-1 text-xs text-slate-500">
                      Paste the article once. The editor will draft the title, excerpt, answer summary, query, keyword, and tags from it.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={markdownFileInputRef}
                      type="file"
                      accept=".md,.markdown,.txt,.html,.htm,text/markdown,text/plain,text/html"
                      onChange={handleMarkdownFileImport}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => markdownFileInputRef.current?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import File
                    </button>
                    <button
                      type="button"
                      onClick={() => void runAutofill({ overwrite: true })}
                      disabled={busyAction !== null}
                      className="inline-flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                    >
                      <Wand2 className="h-3.5 w-3.5" />
                      Autofill Fields
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Rich text pasted here is converted into markdown automatically. Embed media with <code>@[youtube Video title](https://www.youtube.com/watch?v=...)</code> or <code>@[audio Clip title](https://cdn.example.com/file.mp3)</code>.
                </p>
                <textarea
                  value={form.body_markdown}
                  onChange={(event) => setField('body_markdown', event.target.value)}
                  onPaste={handleBodyPaste}
                  rows={18}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono text-sm"
                />
              </label>

              <label className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">Title</span>
                <input value={form.title} onChange={(event) => setField('title', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">Slug</span>
                <input
                  value={form.slug}
                  onChange={(event) => {
                    setSlugTouched(true);
                    setField('slug', slugify(event.target.value));
                  }}
                  className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100"
                />
              </label>
              <label className="space-y-1">
                <span className="text-xs uppercase tracking-wide text-slate-500">Author</span>
                <input value={form.author_name} onChange={(event) => setField('author_name', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
              </label>
              <div className="rounded-lg border border-slate-700/70 bg-slate-900/30 px-3 py-2">
                <p className="text-xs uppercase tracking-wide text-slate-500">Workflow</p>
                <p className="mt-1 text-sm text-slate-300">Paste the article, let Autofill draft the metadata, then only correct what looks off.</p>
              </div>
              <label className="space-y-1 md:col-span-2">
                <span className="text-xs uppercase tracking-wide text-slate-500">Excerpt</span>
                <textarea value={form.excerpt} onChange={(event) => setField('excerpt', event.target.value)} rows={2} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
              </label>

              <div className="md:col-span-2 rounded-xl border border-slate-700/70 bg-slate-900/30">
                <button
                  type="button"
                  onClick={() => setShowMetadata((current) => !current)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <div>
                    <p className="text-sm font-medium text-white">Search metadata</p>
                    <p className="text-xs text-slate-500">Auto-filled from the article. Open this when you need to adjust the generated SEO/AEO fields.</p>
                  </div>
                  <span className="text-xs text-slate-400">{showMetadata ? 'Hide' : 'Show'}</span>
                </button>
                {showMetadata ? (
                  <div className="grid grid-cols-1 gap-4 border-t border-slate-700/70 px-4 py-4 md:grid-cols-2">
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Answer Summary</span>
                      <textarea value={form.answer_summary} onChange={(event) => setField('answer_summary', event.target.value)} rows={3} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Target Query</span>
                      <input value={form.target_query} onChange={(event) => setField('target_query', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Target Intent</span>
                      <select value={form.target_intent} onChange={(event) => setField('target_intent', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100">
                        <option value="informational">Informational</option>
                        <option value="commercial">Commercial</option>
                        <option value="comparison">Comparison</option>
                        <option value="navigational">Navigational</option>
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Primary Keyword</span>
                      <input value={form.primary_keyword} onChange={(event) => setField('primary_keyword', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Tags</span>
                      <input value={form.tags} onChange={(event) => setField('tags', event.target.value)} placeholder="seo, gifting, personalized songs" className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
                    </label>
                    <label className="space-y-1 md:col-span-2">
                      <span className="text-xs uppercase tracking-wide text-slate-500">Hero Image URL</span>
                      <input value={form.hero_image_url} onChange={(event) => setField('hero_image_url', event.target.value)} className="w-full px-3 py-2 bg-slate-900/50 border border-slate-700 rounded-lg text-slate-100" />
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
            <div className="card rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-rose-400" />
                <h3 className="text-white font-semibold">Review Gate</h3>
              </div>
              {selectedPost?.review_report ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Decision</p>
                      <p className={`mt-1 text-sm font-semibold ${selectedPost.review_report.decision === 'approved' ? 'text-emerald-300' : 'text-rose-300'}`}>
                        {selectedPost.review_report.decision}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Overall</p>
                      <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.overallScore}</p>
                    </div>
                    <div className="rounded-lg bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">SEO</p>
                      <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.seoScore}</p>
                    </div>
                    <div className="rounded-lg bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">GEO / AEO</p>
                      <p className="mt-1 text-sm font-semibold text-white">
                        {Math.round((selectedPost.review_report.geoScore + selectedPost.review_report.aeoScore) / 2)}
                      </p>
                    </div>
                    <div className="rounded-lg bg-slate-900/50 p-3">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Format</p>
                      <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.formatScore ?? '—'}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-white mb-2">Blockers</p>
                    {selectedPost.review_report.blockers.length === 0 ? (
                      <p className="text-sm text-emerald-300">No hard blockers.</p>
                    ) : (
                      <div className="space-y-2">
                        {selectedPost.review_report.blockers.map((item) => (
                          <div key={item.code} className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                            <p className="text-sm text-rose-200 font-medium">{item.message}</p>
                            <p className="text-xs text-rose-100/80 mt-1">{item.recommendation}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="text-sm font-medium text-white mb-2">Recommendations</p>
                    <div className="space-y-2">
                      {selectedPost.review_report.recommendations.length === 0 ? (
                        <p className="text-sm text-slate-500">No deterministic recommendations.</p>
                      ) : (
                        selectedPost.review_report.recommendations.map((item) => (
                          <div key={item.code} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                            <p className="text-sm text-slate-200 font-medium">{item.message}</p>
                            <p className="text-xs text-slate-400 mt-1">{item.recommendation}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-700/60 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-white">LLM Editorial Review</p>
                      <span className="text-xs text-slate-500">
                        {selectedPost.review_report.editorial_review?.provider
                          ? `${selectedPost.review_report.editorial_review.provider} · ${selectedPost.review_report.editorial_review.model}`
                          : selectedPost.review_report.editorial_review?.status || 'unavailable'}
                      </span>
                    </div>
                    {selectedPost.review_report.editorial_review ? (
                      <div className="space-y-3">
                        <p className="text-sm text-slate-300">{selectedPost.review_report.editorial_review.summary}</p>
                        {selectedPost.review_report.editorial_review.status === 'available' ? (
                          <>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-lg bg-slate-900/50 p-3">
                                <p className="text-xs uppercase tracking-wide text-slate-500">Citation</p>
                                <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.editorial_review.citationPotential}/10</p>
                              </div>
                              <div className="rounded-lg bg-slate-900/50 p-3">
                                <p className="text-xs uppercase tracking-wide text-slate-500">AEO</p>
                                <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.editorial_review.aeoStrength}/10</p>
                              </div>
                              <div className="rounded-lg bg-slate-900/50 p-3">
                                <p className="text-xs uppercase tracking-wide text-slate-500">Framework</p>
                                <p className="mt-1 text-sm font-semibold text-white">{selectedPost.review_report.editorial_review.frameworkAlignment}/10</p>
                              </div>
                            </div>

                            <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                              <p className="text-xs uppercase tracking-wide text-slate-500">Editorial Verdict</p>
                              <p className="mt-1 text-sm font-medium text-white">{selectedPost.review_report.editorial_review.verdict}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                {selectedPost.review_report.editorial_review.pageType} · {selectedPost.review_report.editorial_review.retrievalGoal} · confidence {selectedPost.review_report.editorial_review.confidence}
                              </p>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-white mb-2">Editorial Blockers</p>
                              {selectedPost.review_report.editorial_review.blockers.length === 0 ? (
                                <p className="text-sm text-slate-500">No editorial blockers called out.</p>
                              ) : (
                                <div className="space-y-2">
                                  {selectedPost.review_report.editorial_review.blockers.map((item, index) => (
                                    <div key={`${item.title}-${index}`} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                                      <p className="text-sm text-slate-200 font-medium">{item.title}</p>
                                      <p className="text-xs text-slate-400 mt-1">{item.detail}</p>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div>
                              <p className="text-sm font-medium text-white mb-2">Editorial Improvements</p>
                              <div className="space-y-2">
                                {selectedPost.review_report.editorial_review.improvements.map((item, index) => (
                                  <div key={`${item.title}-${index}`} className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                                    <p className="text-sm text-slate-200 font-medium">{item.title}</p>
                                    <p className="text-xs text-slate-400 mt-1">{item.recommendation}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div>
                              <p className="text-sm font-medium text-white mb-2">Priority Rewrites</p>
                              <div className="space-y-2">
                                {selectedPost.review_report.editorial_review.priorityRewrites.title ? (
                                  <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Title</p>
                                    <p className="text-sm text-slate-200 mt-1">{selectedPost.review_report.editorial_review.priorityRewrites.title}</p>
                                  </div>
                                ) : null}
                                {selectedPost.review_report.editorial_review.priorityRewrites.answerBlock ? (
                                  <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                                    <p className="text-xs uppercase tracking-wide text-slate-500">Answer Block</p>
                                    <p className="text-sm text-slate-200 mt-1 whitespace-pre-wrap">{selectedPost.review_report.editorial_review.priorityRewrites.answerBlock}</p>
                                  </div>
                                ) : null}
                                {selectedPost.review_report.editorial_review.priorityRewrites.faq ? (
                                  <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3">
                                    <p className="text-xs uppercase tracking-wide text-slate-500">FAQ</p>
                                    <p className="text-sm text-slate-200 mt-1 whitespace-pre-wrap">{selectedPost.review_report.editorial_review.priorityRewrites.faq}</p>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          </>
                        ) : (
                          <p className="text-xs text-slate-500">
                            {selectedPost.review_report.editorial_review.error || 'Editorial review did not run.'}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No editorial review yet.</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">Run review to score the draft and get publish guidance.</p>
              )}
            </div>

            <div className="card rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-white font-semibold">Preview</h3>
                {previewHtml ? <span className="text-xs text-slate-500">Server-rendered preview</span> : null}
              </div>
              {previewHtml ? (
                <iframe title="Blog preview" srcDoc={previewHtml} className="w-full min-h-[720px] rounded-lg border border-slate-700 bg-white" />
              ) : (
                <p className="text-sm text-slate-500">Click Preview to render the current draft as a public article page.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
