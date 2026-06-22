"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bookmark, Category } from "@/lib/db";
import {
  htmlTitle,
  isBookmarkExport,
  parseBookmarkHtml,
} from "@/lib/parseBookmarks";

/* ---------- small inline icons ---------- */
const IconLink = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>
);
const IconPlus = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
);
const IconSearch = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
);
const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
);
const IconFile = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg>
);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Favicons go through Google's service so the browser never requests
// internal/LAN hosts directly (avoids Chrome's local-network prompt).
function googleFavicon(url: string): string {
  const host = hostOf(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

// Intranet hosts that public favicon services can't reach: ship the icon as a
// same-origin static asset (no network request to the LAN host → no prompt).
const LOCAL_FAVICONS: { test: (host: string) => boolean; src: string }[] = [
  { test: (h) => h.includes("konawiki"), src: "/icons/konawiki.ico" },
];

function resolveFavicon(url: string): string {
  const host = hostOf(url);
  for (const f of LOCAL_FAVICONS) if (f.test(host)) return f.src;
  return googleFavicon(url);
}

const looksLikeUrl = (s: string) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(s.trim());

// Browser-side KO<->EN translation fallback. Runs from the user's IP, so it
// avoids the rate limits that block the worker's shared datacenter IP.
// MyMemory is keyless and CORS-enabled.
async function clientTranslate(q: string): Promise<string> {
  const source = /[가-힣]/.test(q) ? "ko" : "en";
  const target = source === "ko" ? "en" : "ko";
  try {
    const r = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=${source}|${target}`,
    );
    const d = await r.json();
    const t: string = d?.responseData?.translatedText ?? "";
    // MyMemory echoes errors (e.g. "PLEASE SELECT...") in the text field.
    if (/^[A-Z' .]+$/.test(t) && /PLEASE|INVALID|LIMIT|QUERY/i.test(t)) return "";
    return t;
  } catch {
    return "";
  }
}

// Download a URL while reporting progress. Uses X-Raw-Bytes (uncompressed
// length) as the denominator; falls back to indeterminate (null) if unknown.
async function fetchWithProgress(
  url: string,
  onProgress: (ratio: number | null) => void,
): Promise<Blob> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  const totalHdr =
    res.headers.get("X-Raw-Bytes") || res.headers.get("Content-Length");
  const total = totalHdr ? parseInt(totalHdr, 10) : 0;
  if (!res.body) {
    onProgress(1);
    return res.blob();
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(total ? Math.min(1, received / total) : null);
    }
  }
  onProgress(1);
  return new Blob(chunks as BlobPart[], { type: "text/html" });
}

/* ---------- local cache (single-user, version-gated) ---------- */
const CACHE_KEY = "ysite-cache-v1";
const PREFS_KEY = "ysite-prefs-v1"; // UI prefs: composer open, view mode
type CacheShape = { version: number; bookmarks: Bookmark[]; categories: Category[] };

function readCache(): CacheShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (
      typeof d.version === "number" &&
      Array.isArray(d.bookmarks) &&
      Array.isArray(d.categories)
    ) {
      return d as CacheShape;
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

/* ---------- search similarity ---------- */
// Strip a simple English plural so "mails" also matches "mail". Fast (string
// ops only); substring already covers singular→plural the other direction.
function stem(t: string): string {
  if (t.length > 4 && t.endsWith("es")) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s")) return t.slice(0, -1);
  return t;
}
function buildTerms(q: string, alt: string): string[] {
  const set = new Set<string>();
  for (const raw of [q, alt]) {
    if (!raw) continue;
    set.add(raw);
    const s = stem(raw);
    if (s.length >= 2) set.add(s);
  }
  return [...set];
}

/* ---------- translation cache (client hash table) ---------- */
const TRANS_CACHE_KEY = "ysite-trans-v1";
function readTransCache(): { version: number; map: Record<string, string> } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TRANS_CACHE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (typeof d.version === "number" && d.map && typeof d.map === "object") {
      return d as { version: number; map: Record<string, string> };
    }
  } catch {
    /* ignore corrupt cache */
  }
  return null;
}

export default function Home() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<number | "all" | "none">("all");
  const [composerOpen, setComposerOpen] = useState(false); // add-link form collapsed by default
  const [viewMode, setViewMode] = useState<"card" | "list">("card");
  const prefsLoaded = useRef(false);
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCat, setDragOverCat] = useState<number | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  // search term -> opposite-language form; "" means none/unavailable.
  const [transMap, setTransMap] = useState<Record<string, string>>({});
  const [tversion, setTversion] = useState<number | null>(null);
  const transMapRef = useRef<Record<string, string>>({});
  // q -> { translated, hits } accumulated since the last upload.
  const pendingTrans = useRef<Map<string, { t: string; hits: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [editingTrans, setEditingTrans] = useState(false);
  const [transDraft, setTransDraft] = useState("");
  const transEscRef = useRef(false);
  // Detail view for stored HTML pages (content downloaded on demand).
  const [detail, setDetail] = useState<{ id: number; title: string } | null>(null);
  const [detailUrl, setDetailUrl] = useState("");
  const [detailProgress, setDetailProgress] = useState<number | null>(0);
  const detailUrlRef = useRef("");
  const dragDepth = useRef(0);
  const lastFetchedUrl = useRef("");
  // Finder-style "slow double click" detector for renaming.
  const lastTitleClick = useRef<{ id: number | null; t: number }>({ id: null, t: 0 });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  // Mutations return the new data version; keep ours in sync so a same-browser
  // change doesn't trigger a needless full reload next visit.
  const applyVersion = useCallback((v: unknown) => {
    if (typeof v === "number") setVersion(v);
  }, []);

  /* ---------- UI prefs (composer open, view mode) ---------- */
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (typeof p.composerOpen === "boolean") setComposerOpen(p.composerOpen);
      if (p.viewMode === "list" || p.viewMode === "card") setViewMode(p.viewMode);
    } catch {
      /* defaults */
    }
    prefsLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!prefsLoaded.current) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ composerOpen, viewMode }));
    } catch {
      /* non-fatal */
    }
  }, [composerOpen, viewMode]);

  /* ---------- full load (only on cache miss / version mismatch) ---------- */
  const load = useCallback(async () => {
    try {
      const [bRes, cRes, vRes] = await Promise.all([
        fetch("/api/bookmarks"),
        fetch("/api/categories"),
        fetch("/api/version"),
      ]);
      const bData = await bRes.json();
      const cData = await cRes.json();
      const vData = await vRes.json();
      setBookmarks(bData.bookmarks ?? []);
      setCategories(cData.categories ?? []);
      setVersion(typeof vData.version === "number" ? vData.version : 0);
    } catch {
      showToast("목록을 불러오지 못했어요");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // On mount: render cached data instantly, then check the version (one tiny
  // read) and only do a full reload if it changed (e.g. edited in another tab).
  useEffect(() => {
    const cached = readCache();
    if (cached) {
      setBookmarks(cached.bookmarks);
      setCategories(cached.categories);
      setVersion(cached.version);
      setLoading(false);
    }
    (async () => {
      try {
        const v = await fetch("/api/version").then((r) => r.json());
        if (!cached || cached.version !== v.version) await load();
        else setLoading(false);
      } catch {
        if (!cached) setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the working set so the next load is instant.
  useEffect(() => {
    if (version == null) return;
    try {
      localStorage.setItem(
        CACHE_KEY,
        JSON.stringify({ version, bookmarks, categories }),
      );
    } catch {
      /* storage full / unavailable — non-fatal */
    }
  }, [version, bookmarks, categories]);

  /* ---------- translation hash table sync ---------- */
  // keep a ref mirror so unload/timeout handlers read the latest map
  useEffect(() => {
    transMapRef.current = transMap;
  }, [transMap]);

  // On mount: hydrate the translation cache from localStorage, then async-load
  // the server table (only replacing when its version changed). Non-blocking.
  useEffect(() => {
    const cached = readTransCache();
    if (cached) {
      setTransMap((prev) => ({ ...cached.map, ...prev }));
      setTversion(cached.version);
    }
    (async () => {
      try {
        const data = await fetch("/api/translations").then((r) => r.json());
        if (typeof data.version === "number" && data.version !== cached?.version) {
          const map: Record<string, string> = {};
          for (const e of data.entries ?? []) map[e.q] = e.translated ?? "";
          setTransMap((prev) => ({ ...map, ...prev }));
          setTversion(data.version);
        }
      } catch {
        /* offline / unavailable — cache still works */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the hash table locally whenever it changes.
  useEffect(() => {
    if (tversion == null) return;
    try {
      localStorage.setItem(
        TRANS_CACHE_KEY,
        JSON.stringify({ version: tversion, map: transMap }),
      );
    } catch {
      /* non-fatal */
    }
  }, [transMap, tversion]);

  // Upload accumulated translations/hits in a batch (every 10 min + on exit).
  const flushTrans = useCallback(async () => {
    if (pendingTrans.current.size === 0) return;
    const entries = [...pendingTrans.current].map(([q, v]) => ({
      q,
      translated: v.t,
      hits: v.hits,
    }));
    pendingTrans.current = new Map();
    try {
      const data = await fetch("/api/translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      }).then((r) => r.json());
      if (typeof data.version === "number") setTversion(data.version);
    } catch {
      /* dropped — will re-accumulate on future searches */
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(flushTrans, 10 * 60 * 1000);
    // On exit, fire-and-forget via sendBeacon (survives page teardown).
    const onExit = () => {
      if (pendingTrans.current.size === 0) return;
      const entries = [...pendingTrans.current].map(([q, v]) => ({
        q,
        translated: v.t,
        hits: v.hits,
      }));
      pendingTrans.current = new Map();
      try {
        navigator.sendBeacon(
          "/api/translations",
          new Blob([JSON.stringify({ entries })], { type: "application/json" }),
        );
      } catch {
        /* ignore */
      }
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") onExit();
    };
    window.addEventListener("pagehide", onExit);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", onExit);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [flushTrans]);

  /* ---------- auto title fetch (debounced) ---------- */
  useEffect(() => {
    if (titleTouched) return;
    const u = url.trim();
    if (!looksLikeUrl(u) || u === lastFetchedUrl.current) return;

    const t = window.setTimeout(async () => {
      setFetchingTitle(true);
      lastFetchedUrl.current = u;
      try {
        const res = await fetch(`/api/title?url=${encodeURIComponent(u)}`);
        const data = await res.json();
        if (!titleTouched && data.title) setTitle(data.title);
      } catch {
        /* ignore — user can type a title manually */
      } finally {
        setFetchingTitle(false);
      }
    }, 650);
    return () => window.clearTimeout(t);
  }, [url, titleTouched]);

  /* ---------- add single ---------- */
  const addBookmark = useCallback(async () => {
    const u = url.trim();
    if (!looksLikeUrl(u)) {
      showToast("올바른 URL을 입력해 주세요");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: u,
          title: title.trim(),
          categoryId: typeof activeCat === "number" ? activeCat : null,
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setUrl("");
      setTitle("");
      setTitleTouched(false);
      lastFetchedUrl.current = "";
      if (Array.isArray(data.bookmarks)) {
        setBookmarks((prev) => [...data.bookmarks, ...prev]);
      }
      applyVersion(data.version);
      showToast("즐겨찾기를 추가했어요");
    } catch {
      showToast("추가에 실패했어요");
    } finally {
      setAdding(false);
    }
  }, [url, title, activeCat, applyVersion, showToast]);

  /* ---------- delete ---------- */
  const remove = useCallback(
    async (id: number) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      try {
        const res = await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
        applyVersion((await res.json()).version);
      } catch {
        showToast("삭제에 실패했어요");
        load();
      }
    },
    [applyVersion, load, showToast],
  );

  /* ---------- categories ---------- */
  const createCategory = useCallback(
    async (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      try {
        const res = await fetch("/api/categories", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: trimmed }),
        });
        const data = await res.json();
        if (data.category) {
          setCategories((prev) => [...prev, data.category]);
          setActiveCat(data.category.id);
        }
        applyVersion(data.version);
        setNewCatName("");
        setNewCatOpen(false);
      } catch {
        showToast("카테고리 생성에 실패했어요");
      }
    },
    [applyVersion, showToast],
  );

  const deleteCategory = useCallback(
    async (id: number) => {
      setCategories((prev) => prev.filter((c) => c.id !== id));
      setBookmarks((prev) =>
        prev.map((b) => ({
          ...b,
          categories: b.categories.filter((c) => c !== id),
        })),
      );
      setActiveCat((cur) => (cur === id ? "all" : cur));
      try {
        const res = await fetch(`/api/categories/${id}`, { method: "DELETE" });
        applyVersion((await res.json()).version);
      } catch {
        showToast("카테고리 삭제에 실패했어요");
        load();
      }
    },
    [applyVersion, showToast, load],
  );

  // Add a category to a bookmark (drag a card onto a category chip).
  const addCat = useCallback(
    async (bookmarkId: number, categoryId: number) => {
      let changed = false;
      setBookmarks((prev) =>
        prev.map((b) => {
          if (b.id !== bookmarkId || b.categories.includes(categoryId)) return b;
          changed = true;
          return { ...b, categories: [...b.categories, categoryId] };
        }),
      );
      if (!changed) return;
      try {
        const res = await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
        applyVersion((await res.json()).version);
        const name = categories.find((c) => c.id === categoryId)?.name ?? "";
        showToast(`'${name}'(으)로 분류했어요`);
      } catch {
        showToast("분류 지정에 실패했어요");
        load();
      }
    },
    [categories, applyVersion, showToast, load],
  );

  const removeCat = useCallback(
    async (bookmarkId: number, categoryId: number) => {
      setBookmarks((prev) =>
        prev.map((b) =>
          b.id === bookmarkId
            ? { ...b, categories: b.categories.filter((c) => c !== categoryId) }
            : b,
        ),
      );
      try {
        const res = await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
        applyVersion((await res.json()).version);
      } catch {
        showToast("분류 해제에 실패했어요");
        load();
      }
    },
    [applyVersion, showToast, load],
  );

  /* ---------- rename (inline title edit) ---------- */
  const beginEdit = useCallback((b: Bookmark) => {
    setEditingId(b.id);
    setDraft(b.title);
  }, []);

  // Two clicks on the title within 1s enter edit mode (doesn't navigate).
  const handleTitleClick = useCallback(
    (e: React.MouseEvent, b: Bookmark) => {
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      const last = lastTitleClick.current;
      if (last.id === b.id && now - last.t < 1000) {
        lastTitleClick.current = { id: null, t: 0 };
        beginEdit(b);
      } else {
        lastTitleClick.current = { id: b.id, t: now };
      }
    },
    [beginEdit],
  );

  const saveTitle = useCallback(
    async (id: number) => {
      const title = draft.trim();
      setEditingId(null);
      setBookmarks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, title } : b)),
      );
      try {
        const res = await fetch(`/api/bookmarks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) throw new Error();
        applyVersion((await res.json()).version);
      } catch {
        showToast("이름 변경에 실패했어요");
        load();
      }
    },
    [draft, applyVersion, showToast, load],
  );

  const cancelEdit = useCallback(() => setEditingId(null), []);

  /* ---------- stored-page detail (on-demand download + progress) ---------- */
  const closeDetail = useCallback(() => {
    if (detailUrlRef.current) {
      URL.revokeObjectURL(detailUrlRef.current);
      detailUrlRef.current = "";
    }
    setDetail(null);
    setDetailUrl("");
    setDetailProgress(0);
  }, []);

  const openDetail = useCallback(
    async (b: Bookmark) => {
      if (detailUrlRef.current) {
        URL.revokeObjectURL(detailUrlRef.current);
        detailUrlRef.current = "";
      }
      setDetailUrl("");
      setDetailProgress(0);
      setDetail({ id: b.id, title: b.title || "저장된 페이지" });
      try {
        const blob = await fetchWithProgress(`/view/${b.id}`, (r) =>
          setDetailProgress(r),
        );
        const objUrl = URL.createObjectURL(blob);
        detailUrlRef.current = objUrl;
        setDetailUrl(objUrl);
      } catch {
        showToast("페이지를 불러오지 못했어요");
        setDetail(null);
      }
    },
    [showToast],
  );

  // Esc closes the detail view.
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, closeDetail]);

  /* ---------- import html files ---------- */
  const importFiles = useCallback(
    async (files: FileList | File[]) => {
      const htmlFiles = Array.from(files).filter(
        (f) => f.type === "text/html" || /\.html?$/i.test(f.name),
      );
      if (htmlFiles.length === 0) {
        showToast("HTML 파일이 아니에요");
        return;
      }

      type Item =
        | { url: string; title: string }
        | { kind: "html"; title: string; content: string };
      const items: Item[] = [];
      for (const f of htmlFiles) {
        const text = await f.text();
        if (isBookmarkExport(text)) {
          // browser bookmark export → extract its links
          items.push(...parseBookmarkHtml(text));
        } else {
          // a standalone page → store the whole document
          const title = htmlTitle(text) || f.name.replace(/\.html?$/i, "");
          items.push({ kind: "html", title, content: text });
        }
      }
      if (items.length === 0) {
        showToast("파일에서 가져올 내용을 찾지 못했어요");
        return;
      }
      showToast("가져오는 중…");
      try {
        const res = await fetch("/api/bookmarks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookmarks: items,
            categoryId: typeof activeCat === "number" ? activeCat : null,
          }),
        });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (Array.isArray(data.bookmarks)) {
          setBookmarks((prev) => [...data.bookmarks, ...prev]);
        }
        applyVersion(data.version);
        showToast(`${data.inserted ?? items.length}개를 가져왔어요`);
      } catch {
        showToast("가져오기에 실패했어요 (파일이 너무 클 수 있어요)");
      }
    },
    [activeCat, applyVersion, showToast],
  );

  /* ---------- window drag & drop ---------- */
  useEffect(() => {
    const onEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const onLeave = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current -= 1;
      if (dragDepth.current <= 0) {
        dragDepth.current = 0;
        setDragging(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      if (e.dataTransfer?.files?.length) importFiles(e.dataTransfer.files);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [importFiles]);

  /* ---------- KO<->EN search expansion + hit tracking ---------- */
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q) return;
    const t = window.setTimeout(async () => {
      let translated = transMapRef.current[q];
      if (translated === undefined) {
        // Not in the hash table → translate (server first, then browser).
        let res = "";
        try {
          const r = await fetch(`/api/translate?q=${encodeURIComponent(q)}`);
          res = (await r.json()).translated || "";
        } catch {
          /* fall through */
        }
        if (!res) res = await clientTranslate(q);
        translated = (res || "").toLowerCase();
        setTransMap((prev) => ({ ...prev, [q]: translated as string }));
      }
      // Record a hit (cached or fresh) for the next batched upload.
      const cur = pendingTrans.current.get(q);
      pendingTrans.current.set(q, { t: translated, hits: (cur?.hits ?? 0) + 1 });
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  /* ---------- filtered ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const alt = transMap[q] ?? "";
    const terms = buildTerms(q, alt);
    return bookmarks.filter((b) => {
      const inCat =
        activeCat === "all"
          ? true
          : activeCat === "none"
            ? b.categories.length === 0
            : b.categories.includes(activeCat);
      if (!inCat) return false;
      if (!q) return true;
      const hay = `${b.title}\n${b.url}\n${b.description}`.toLowerCase();
      return terms.some((t) => hay.includes(t));
    });
  }, [bookmarks, search, activeCat, transMap]);

  const searchAlt = transMap[search.trim().toLowerCase()] || "";

  // User-curated translation: save the edited word straight into the hash table.
  const saveTranslation = useCallback(
    async (q: string, value: string) => {
      setEditingTrans(false);
      const key = q.trim().toLowerCase();
      const v = value.trim().toLowerCase();
      if (!key) return;
      if ((transMapRef.current[key] ?? "") === v) return; // unchanged
      setTransMap((prev) => ({ ...prev, [key]: v }));
      try {
        const data = await fetch("/api/translations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries: [{ q: key, translated: v, hits: 1 }] }),
        }).then((r) => r.json());
        if (typeof data.version === "number") setTversion(data.version);
        showToast("번역을 저장했어요");
      } catch {
        showToast("번역 저장에 실패했어요");
      }
    },
    [showToast],
  );

  // Counts per category for the chip badges.
  const counts = useMemo(() => {
    const map = new Map<number | "none", number>();
    let none = 0;
    for (const b of bookmarks) {
      if (b.categories.length === 0) none += 1;
      for (const cid of b.categories) map.set(cid, (map.get(cid) ?? 0) + 1);
    }
    map.set("none", none);
    return map;
  }, [bookmarks]);

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <span className="hero-eyebrow">✦ my bookmarks</span>
          <h1 className="hero-title">
            흩어진 링크를 <span className="accent">한 곳에</span>
          </h1>
          {/*<p className="hero-sub">*/}
          {/*  URL만 붙여넣으면 제목을 자동으로 가져와요. <br/>*/}
          {/*  HTML 파일은 화면에 끌어다 놓기만 하면 됩니다.*/}
          {/*</p>*/}
        </div>
        <div className="hero-count">
          <b>{bookmarks.length}</b>
          saved
        </div>
      </header>

      {/* composer (collapsed by default) */}
      <button
        type="button"
        className={`composer-toggle${composerOpen ? " open" : ""}`}
        onClick={() => setComposerOpen((o) => !o)}
        aria-expanded={composerOpen}
      >
        <IconPlus />
        <span>링크 추가</span>
        <span className="composer-chevron">{composerOpen ? "▲" : "▼"}</span>
      </button>
      {composerOpen && (
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          addBookmark();
        }}
      >
        <div className="composer-row">
          <div className={`field ${fetchingTitle ? "fetching" : ""}`}>
            <IconLink />
            <input
              className="input"
              type="text"
              inputMode="url"
              placeholder="https://example.com  또는  example.com"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field title-field">
            <input
              className="input"
              type="text"
              placeholder={fetchingTitle ? "제목 가져오는 중…" : "제목 (자동 입력)"}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setTitleTouched(true);
              }}
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={adding}>
            <IconPlus />
            {adding ? "추가 중…" : "추가"}
          </button>
        </div>
        <p className="composer-hint">
          <IconFile />
          파일을 끌어다 놓으면 추가돼요. 카드를 위 카테고리로 끌면 분류되고, 한 항목에
          여러 카테고리를 지정할 수 있어요.
        </p>
      </form>
      )}

      {/* category bar */}
      <div className="catbar">
        <button
          className={`chip${activeCat === "all" ? " active" : ""}`}
          onClick={() => setActiveCat("all")}
        >
          전체 <span className="chip-count">{bookmarks.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className={`chip${activeCat === c.id ? " active" : ""}${
              draggingId !== null ? " droppable" : ""
            }${dragOverCat === c.id ? " drop-over" : ""}`}
            onClick={() => setActiveCat(c.id)}
            onDragOver={(e) => {
              if (draggingId !== null) {
                e.preventDefault();
                setDragOverCat(c.id);
              }
            }}
            onDragLeave={() => setDragOverCat((cur) => (cur === c.id ? null : cur))}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggingId !== null) addCat(draggingId, c.id);
              setDragOverCat(null);
            }}
          >
            {c.name} <span className="chip-count">{counts.get(c.id) ?? 0}</span>
            <span
              className="chip-del"
              title="카테고리 삭제"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`'${c.name}' 카테고리를 삭제할까요? (분류만 해제됩니다)`))
                  deleteCategory(c.id);
              }}
            >
              ×
            </span>
          </button>
        ))}
        {(counts.get("none") ?? 0) > 0 && (
          <button
            className={`chip${activeCat === "none" ? " active" : ""}`}
            onClick={() => setActiveCat("none")}
          >
            미분류 <span className="chip-count">{counts.get("none") ?? 0}</span>
          </button>
        )}
        {newCatOpen ? (
          <input
            className="newcat-input"
            autoFocus
            placeholder="카테고리 이름 + Enter"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") createCategory(newCatName);
              else if (e.key === "Escape") {
                setNewCatName("");
                setNewCatOpen(false);
              }
            }}
            onBlur={() => {
              if (newCatName.trim()) createCategory(newCatName);
              else setNewCatOpen(false);
            }}
          />
        ) : (
          <button
            className="chip chip-add"
            onClick={() => setNewCatOpen(true)}
          >
            + 새 카테고리
          </button>
        )}
      </div>

      {/* toolbar */}
      <div className="toolbar">
        <div className="search">
          <IconSearch />
          <input
            type="text"
            placeholder="제목·주소로 검색"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="view-toggle" role="group" aria-label="보기 방식">
          <button
            type="button"
            className={viewMode === "card" ? "active" : ""}
            onClick={() => setViewMode("card")}
            title="카드 보기"
          >
            ▦
          </button>
          <button
            type="button"
            className={viewMode === "list" ? "active" : ""}
            onClick={() => setViewMode("list")}
            title="리스트 보기"
          >
            ≣
          </button>
        </div>
        <span className="toolbar-label">
          {search.trim() &&
            (editingTrans ? (
              <input
                className="trans-edit"
                autoFocus
                value={transDraft}
                placeholder="번역어 입력"
                onChange={(e) => setTransDraft(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveTranslation(search.trim().toLowerCase(), transDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    transEscRef.current = true;
                    setEditingTrans(false);
                  }
                }}
                onBlur={() => {
                  if (transEscRef.current) {
                    transEscRef.current = false;
                    return;
                  }
                  saveTranslation(search.trim().toLowerCase(), transDraft);
                }}
              />
            ) : (
              <button
                type="button"
                className="trans-badge"
                title="클릭해서 번역어 수정 (해시테이블에 저장)"
                onClick={() => {
                  setTransDraft(searchAlt);
                  setEditingTrans(true);
                }}
              >
                ↔ {searchAlt || "번역 추가"}
              </button>
            ))}
          {search ? `${filtered.length}개 표시` : `전체 ${bookmarks.length}개`}
        </span>
      </div>

      {/* grid */}
      {loading ? (
        <div className="grid skeleton-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon">{search ? "🔍" : "🔖"}</div>
          <h3>{search ? "검색 결과가 없어요" : "아직 즐겨찾기가 없어요"}</h3>
          <p>
            {search
              ? "다른 키워드로 검색해 보세요."
              : "위에 URL을 붙여넣거나 북마크 파일을 끌어다 놓아 보세요."}
          </p>
        </div>
      ) : viewMode === "list" ? (
        <div className="list">
          {filtered.map((b) => {
            const isHtml = b.kind === "html";
            const href = isHtml ? `/view/${b.id}` : b.url;
            const label = isHtml ? "저장된 페이지" : hostOf(b.url);
            return (
              <a
                key={b.id}
                className={`row${draggingId === b.id ? " dragging" : ""}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                draggable
                onClick={(e) => {
                  if (isHtml && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    openDetail(b);
                  }
                }}
                onDragStart={(e) => {
                  setDraggingId(b.id);
                  e.dataTransfer.effectAllowed = "link";
                  e.dataTransfer.setData("text/plain", String(b.id));
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverCat(null);
                }}
              >
                <Favicon
                  src={isHtml ? "" : resolveFavicon(b.url)}
                  host={label}
                  isHtml={isHtml}
                  compact
                />
                <span className="row-title">{b.title || label}</span>
                {isHtml && <span className="row-tag">HTML</span>}
                <button
                  className="row-del"
                  title="삭제"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const name = b.title || label;
                    if (confirm(`'${name}'을(를) 삭제할까요?`)) remove(b.id);
                  }}
                >
                  <IconTrash />
                </button>
              </a>
            );
          })}
        </div>
      ) : (
        <div className="grid">
          {filtered.map((b) => {
            const isHtml = b.kind === "html";
            const href = isHtml ? `/view/${b.id}` : b.url;
            const label = isHtml ? "저장된 페이지" : hostOf(b.url);
            return (
              <a
                key={b.id}
                className={`card${draggingId === b.id ? " dragging" : ""}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                draggable
                onClick={(e) => {
                  // Stored pages open in an in-site detail view (downloaded on
                  // demand). Ctrl/⌘-click still opens the raw page in a new tab.
                  if (isHtml && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    openDetail(b);
                  }
                }}
                onDragStart={(e) => {
                  setDraggingId(b.id);
                  e.dataTransfer.effectAllowed = "link";
                  e.dataTransfer.setData("text/plain", String(b.id));
                }}
                onDragEnd={() => {
                  setDraggingId(null);
                  setDragOverCat(null);
                }}
              >
                <button
                  className="card-del"
                  title="삭제"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const name = b.title || label;
                    if (confirm(`'${name}'을(를) 삭제할까요?`)) remove(b.id);
                  }}
                >
                  <IconTrash />
                </button>
                <div className="card-head">
                  <Favicon
                    src={isHtml ? "" : resolveFavicon(b.url)}
                    host={label}
                    isHtml={isHtml}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div className="card-host">
                      {isHtml && <span className="card-tag">HTML</span>}
                      {label}
                    </div>
                  </div>
                </div>
                {editingId === b.id ? (
                  <input
                    className="title-edit"
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle(b.id);
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        cancelEdit();
                      }
                    }}
                    onBlur={() => saveTitle(b.id)}
                  />
                ) : (
                  <div
                    className="card-title editable"
                    title="두 번 클릭하여 이름 변경"
                    onClick={(e) => handleTitleClick(e, b)}
                  >
                    {b.title || label}
                  </div>
                )}
                {b.description && <p className="card-desc">{b.description}</p>}
                <div className="card-foot">
                  {b.categories.length > 0 ? (
                    b.categories.map((cid) => {
                      const c = categories.find((x) => x.id === cid);
                      if (!c) return null;
                      return (
                        <span key={cid} className="cat-tag">
                          {c.name}
                          <span
                            className="cat-tag-del"
                            title="분류 해제"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              removeCat(b.id, cid);
                            }}
                          >
                            ×
                          </span>
                        </span>
                      );
                    })
                  ) : (
                    <span className="cat-hint">⠿ 카테고리로 끌어 분류</span>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* drag overlay */}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-inner">
            <div className="big">📥</div>
            <h2>여기에 놓으세요</h2>
            <p>북마크 파일은 링크로, HTML 페이지는 통째로 저장합니다</p>
          </div>
        </div>
      )}

      {/* stored-page detail view */}
      {detail && (
        <div className="detail-overlay" onClick={closeDetail}>
          <div className="detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="detail-head">
              <span className="detail-title">{detail.title}</span>
              <div className="detail-actions">
                <a
                  className="detail-btn"
                  href={`/view/${detail.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  새 탭 ↗
                </a>
                <button className="detail-btn" onClick={closeDetail}>
                  닫기 ✕
                </button>
              </div>
            </div>
            {detailUrl ? (
              <iframe
                className="detail-frame"
                src={detailUrl}
                sandbox="allow-scripts allow-popups allow-forms"
                title={detail.title}
              />
            ) : (
              <div className="detail-loading">
                <div className="detail-spinner" />
                <div className="detail-pct">
                  {detailProgress == null
                    ? "다운로드 중…"
                    : `다운로드 중… ${Math.round((detailProgress ?? 0) * 100)}%`}
                </div>
                <div className="detail-bar">
                  <div
                    className={`detail-bar-fill${detailProgress == null ? " indet" : ""}`}
                    style={
                      detailProgress == null
                        ? undefined
                        : { width: `${Math.round(detailProgress * 100)}%` }
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Favicon({
  src,
  host,
  isHtml,
  compact,
}: {
  src: string;
  host: string;
  isHtml?: boolean;
  compact?: boolean;
}) {
  const [ok, setOk] = useState(true);
  return (
    <div
      className={`card-fav${isHtml ? " is-html" : ""}${compact ? " is-compact" : ""}`}
    >
      {isHtml ? (
        <IconFile />
      ) : src && ok ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" onError={() => setOk(false)} />
      ) : (
        <span>{host.charAt(0).toUpperCase()}</span>
      )}
    </div>
  );
}
