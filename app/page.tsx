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
const IconRefresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>
);

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const looksLikeUrl = (s: string) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}/i.test(s.trim());

export default function Home() {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCat, setActiveCat] = useState<number | "all" | "none">("all");
  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverCat, setDragOverCat] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [fetchingTitle, setFetchingTitle] = useState(false);
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  // search term -> opposite-language form (Papago); "" means none/unavailable.
  const [transMap, setTransMap] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const dragDepth = useRef(0);
  const lastFetchedUrl = useRef("");
  const fetchedMeta = useRef<{ url: string; favicon: string }>({ url: "", favicon: "" });
  // Finder-style "slow double click" detector for renaming.
  const lastTitleClick = useRef<{ id: number | null; t: number }>({ id: null, t: 0 });

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  /* ---------- load ---------- */
  const load = useCallback(async () => {
    try {
      const [bRes, cRes] = await Promise.all([
        fetch("/api/bookmarks"),
        fetch("/api/categories"),
      ]);
      const bData = await bRes.json();
      const cData = await cRes.json();
      setBookmarks(bData.bookmarks ?? []);
      setCategories(cData.categories ?? []);
    } catch {
      showToast("목록을 불러오지 못했어요");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    load();
  }, [load]);

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
        fetchedMeta.current = { url: u, favicon: data.favicon || "" };
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
          favicon: fetchedMeta.current.url === u ? fetchedMeta.current.favicon : "",
          categoryId: typeof activeCat === "number" ? activeCat : null,
        }),
      });
      if (!res.ok) throw new Error();
      setUrl("");
      setTitle("");
      setTitleTouched(false);
      lastFetchedUrl.current = "";
      await load();
      showToast("즐겨찾기를 추가했어요");
    } catch {
      showToast("추가에 실패했어요");
    } finally {
      setAdding(false);
    }
  }, [url, title, activeCat, load, showToast]);

  /* ---------- delete ---------- */
  const remove = useCallback(
    async (id: number) => {
      setBookmarks((prev) => prev.filter((b) => b.id !== id));
      try {
        await fetch(`/api/bookmarks/${id}`, { method: "DELETE" });
      } catch {
        showToast("삭제에 실패했어요");
        load();
      }
    },
    [load, showToast],
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
        setNewCatName("");
        setNewCatOpen(false);
      } catch {
        showToast("카테고리 생성에 실패했어요");
      }
    },
    [showToast],
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
        await fetch(`/api/categories/${id}`, { method: "DELETE" });
      } catch {
        showToast("카테고리 삭제에 실패했어요");
        load();
      }
    },
    [showToast, load],
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
        await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
        const name = categories.find((c) => c.id === categoryId)?.name ?? "";
        showToast(`'${name}'(으)로 분류했어요`);
      } catch {
        showToast("분류 지정에 실패했어요");
        load();
      }
    },
    [categories, showToast, load],
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
        await fetch(`/api/bookmarks/${bookmarkId}/categories`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categoryId }),
        });
      } catch {
        showToast("분류 해제에 실패했어요");
        load();
      }
    },
    [showToast, load],
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
      } catch {
        showToast("이름 변경에 실패했어요");
        load();
      }
    },
    [draft, showToast, load],
  );

  const cancelEdit = useCallback(() => setEditingId(null), []);

  // Re-fetch every bookmark's real site icon.
  const refreshIcons = useCallback(async () => {
    setRefreshing(true);
    showToast("아이콘 갱신 중…");
    try {
      const res = await fetch("/api/bookmarks/refresh-icons", { method: "POST" });
      const data = await res.json();
      await load();
      showToast(`아이콘 ${data.updated ?? 0}/${data.total ?? 0}개 갱신 완료`);
    } catch {
      showToast("아이콘 갱신에 실패했어요");
    } finally {
      setRefreshing(false);
    }
  }, [load, showToast]);

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
        await load();
        showToast(`${data.inserted ?? items.length}개를 가져왔어요`);
      } catch {
        showToast("가져오기에 실패했어요 (파일이 너무 클 수 있어요)");
      }
    },
    [activeCat, load, showToast],
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

  /* ---------- KO<->EN search expansion (Papago) ---------- */
  useEffect(() => {
    const q = search.trim().toLowerCase();
    if (!q || transMap[q] !== undefined) return;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/translate?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setTransMap((prev) => ({
          ...prev,
          [q]: (data.translated || "").toLowerCase(),
        }));
      } catch {
        setTransMap((prev) => ({ ...prev, [q]: "" }));
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [search, transMap]);

  /* ---------- filtered ---------- */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const alt = transMap[q];
    const terms = [q, alt].filter((t): t is string => !!t);
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
          <p className="hero-sub">
            URL만 붙여넣으면 제목을 자동으로 가져와요. 브라우저에서 내보낸 북마크
            HTML 파일은 화면에 끌어다 놓기만 하면 됩니다.
          </p>
        </div>
        <div className="hero-count">
          <b>{bookmarks.length}</b>
          saved
        </div>
      </header>

      {/* composer */}
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
        <button
          className={`icon-refresh${refreshing ? " spinning" : ""}`}
          onClick={refreshIcons}
          disabled={refreshing}
          title="모든 항목의 사이트 아이콘을 다시 찾아 갱신"
        >
          <IconRefresh />
          아이콘 갱신
        </button>
        <span className="toolbar-label">
          {searchAlt && (
            <span className="trans-badge" title="한↔영 치환 검색 적용됨">
              ↔ {searchAlt}
            </span>
          )}
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
                  <Favicon src={b.favicon} host={label} isHtml={isHtml} />
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

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function Favicon({
  src,
  host,
  isHtml,
}: {
  src: string;
  host: string;
  isHtml?: boolean;
}) {
  const [ok, setOk] = useState(true);
  return (
    <div className={`card-fav${isHtml ? " is-html" : ""}`}>
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
