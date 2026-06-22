export type ParsedBookmark = { url: string; title: string };

/** A browser bookmark *export* uses the Netscape-Bookmark doctype. */
export function isBookmarkExport(html: string): boolean {
  return /<!DOCTYPE\s+NETSCAPE-Bookmark-file/i.test(html.slice(0, 2048));
}

/** Read the <title> of a standalone HTML document (browser-side). */
export function htmlTitle(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.querySelector("title")?.textContent ?? "").trim();
}

/**
 * Parse a browser-exported (Netscape) bookmark HTML file into a flat,
 * de-duplicated list of links. Folder structure is ignored.
 * Runs in the browser (uses DOMParser).
 */
export function parseBookmarkHtml(html: string): ParsedBookmark[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  const seen = new Set<string>();
  const out: ParsedBookmark[] = [];

  for (const a of anchors) {
    const href = a.getAttribute("href")?.trim() ?? "";
    if (!/^https?:\/\//i.test(href)) continue;
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ url: href, title: (a.textContent ?? "").trim() });
  }
  return out;
}
