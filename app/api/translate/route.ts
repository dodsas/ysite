import { NextRequest, NextResponse } from "next/server";

// Translates a search term into the opposite language (KO<->EN) so the UI can
// match e.g. "token" against "토큰" and vice versa.
//
// Provider is auto-selected from whichever credentials are set (priority):
//   DEEPL_API_KEY                         -> DeepL          (recommended)
//   GOOGLE_TRANSLATE_API_KEY              -> Google v2
//   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET -> Naver Open API (Papago, legacy)
//   NCP_API_KEY_ID / NCP_API_KEY          -> NCP Papago     (discontinued)

const hasHangul = (s: string) => /[가-힣]/.test(s);

// Per-instance cache so repeated searches don't re-hit the API.
const cache = new Map<string, string>();

type Result = { translated: string; configured: boolean };

async function translate(q: string, target: "ko" | "en"): Promise<Result> {
  // --- DeepL ---------------------------------------------------------------
  const deepl = process.env.DEEPL_API_KEY?.trim();
  if (deepl) {
    const endpoint = deepl.endsWith(":fx")
      ? "https://api-free.deepl.com/v2/translate"
      : "https://api.deepl.com/v2/translate";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${deepl}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        text: q,
        target_lang: target.toUpperCase(),
      }).toString(),
    });
    const data = res.ok ? await res.json() : null;
    return {
      translated: data?.translations?.[0]?.text ?? "",
      configured: true,
    };
  }

  // --- Google Cloud Translation v2 -----------------------------------------
  const google = process.env.GOOGLE_TRANSLATE_API_KEY?.trim();
  if (google) {
    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${google}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, target, format: "text" }),
      },
    );
    const data = res.ok ? await res.json() : null;
    return {
      translated: data?.data?.translations?.[0]?.translatedText ?? "",
      configured: true,
    };
  }

  // --- Naver / NCP Papago (legacy) -----------------------------------------
  const naverId = process.env.NAVER_CLIENT_ID;
  const naverSecret = process.env.NAVER_CLIENT_SECRET;
  const ncpId = process.env.NCP_API_KEY_ID;
  const ncpSecret = process.env.NCP_API_KEY;
  const papago: { endpoint: string; headers: Record<string, string> } | null =
    naverId && naverSecret
      ? {
          endpoint: "https://openapi.naver.com/v1/papago/n2mt",
          headers: {
            "X-Naver-Client-Id": naverId,
            "X-Naver-Client-Secret": naverSecret,
          },
        }
      : ncpId && ncpSecret
        ? {
            endpoint: "https://naveropenapi.apigw.ntruss.com/nmt/v1/translation",
            headers: {
              "X-NCP-APIGW-API-KEY-ID": ncpId,
              "X-NCP-APIGW-API-KEY": ncpSecret,
            },
          }
        : null;
  if (papago) {
    const source = target === "ko" ? "en" : "ko";
    const res = await fetch(papago.endpoint, {
      method: "POST",
      headers: {
        ...papago.headers,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      },
      body: new URLSearchParams({ source, target, text: q }).toString(),
    });
    const data = res.ok ? await res.json() : null;
    return {
      translated: data?.message?.result?.translatedText ?? "",
      configured: true,
    };
  }

  // --- MyMemory (keyless, no card — default when nothing else is set) -------
  if (process.env.DISABLE_TRANSLATE !== "1") {
    const source = target === "ko" ? "en" : "ko";
    const params = new URLSearchParams({ q, langpair: `${source}|${target}` });
    const email = process.env.MYMEMORY_EMAIL?.trim();
    if (email) params.set("de", email); // raises the daily quota
    const res = await fetch(
      `https://api.mymemory.translated.net/get?${params.toString()}`,
    );
    const data = res.ok ? await res.json() : null;
    const text: string = data?.responseData?.translatedText ?? "";
    // MyMemory echoes errors in the text field; treat those as "no match".
    const looksError = /^[A-Z' ]+$/.test(text) && /PLEASE|INVALID|LIMIT/i.test(text);
    return { translated: looksError ? "" : text, configured: true };
  }

  return { translated: "", configured: false };
}

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ q, translated: "" });

  if (cache.has(q)) {
    return NextResponse.json({ q, translated: cache.get(q) });
  }

  const target = hasHangul(q) ? "en" : "ko"; // translate into the other language
  try {
    const { translated, configured } = await translate(q, target);
    if (configured) cache.set(q, translated);
    return NextResponse.json({ q, translated, target, configured });
  } catch {
    return NextResponse.json({ q, translated: "" });
  }
}
