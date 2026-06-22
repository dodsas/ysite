export type PageMeta = {
  title: string;
  description: string;
  favicon: string;
};

/** Normalize user input into a fetchable absolute URL (adds https:// if missing). */
export function normalizeUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .trim();
}

function pick(html: string, regexes: RegExp[]): string {
  for (const re of regexes) {
    const m = html.match(re);
    if (m?.[1]) return decodeEntities(m[1]);
  }
  return "";
}

/**
 * Find the icon the site actually declares in its <head>
 * (<link rel="icon">, "shortcut icon", "apple-touch-icon"), resolved to an
 * absolute URL. Prefers apple-touch-icon and larger `sizes`. "" if none.
 */
export function extractIcon(head: string, baseUrl: string): string {
  const tags = head.match(/<link\b[^>]*>/gi) ?? [];
  let best = "";
  let bestScore = -1;
  for (const tag of tags) {
    const rel = (tag.match(/\brel=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase();
    const isIcon = /(^|\s)(shortcut\s+)?icon(\s|$)/.test(rel);
    const isApple = rel.includes("apple-touch-icon");
    if (!isIcon && !isApple) continue;

    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim();
    if (!href) continue;

    let score = isApple ? 1000 : 100;
    const sizes = tag.match(/\bsizes=["']([^"']+)["']/i)?.[1];
    const n = sizes ? parseInt(sizes, 10) : NaN;
    if (!Number.isNaN(n)) score += Math.min(n, 512);
    if (/\.svg(\?|$)/i.test(href)) score += 20; // crisp at any size

    if (score > bestScore) {
      try {
        best = new URL(href, baseUrl).toString();
        bestScore = score;
      } catch {
        /* skip unparseable href */
      }
    }
  }
  return best;
}

/** Fetch a URL server-side and extract title / description / favicon. */
export async function fetchPageMeta(url: string): Promise<PageMeta> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let html = "";
  let finalUrl = url;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ysite-bookmarks/1.0; +https://github.com/dodsas/ysite)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    finalUrl = res.url || url;
    // Only read the first ~256KB — <head> lives at the top.
    const buf = await res.arrayBuffer();
    html = new TextDecoder("utf-8").decode(buf.slice(0, 262144));
  } catch {
    return { title: "", description: "", favicon: faviconFor(url) };
  } finally {
    clearTimeout(timeout);
  }

  const head = html.split(/<\/head>/i)[0] ?? html;

  const title =
    pick(head, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]) || "";

  const description = pick(head, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i,
  ]);

  // The site's own icon first; Google's service only as a fallback.
  const favicon = extractIcon(head, finalUrl) || faviconFor(url);

  return { title, description, favicon };
}

/** Google's favicon service — fallback when the site declares no icon. */
export function faviconFor(url: string): string {
  try {
    const host = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=64`;
  } catch {
    return "";
  }
}
