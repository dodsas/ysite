import { cookies } from "next/headers";
import { AUTH_COOKIE, authMode, readSessionCookie } from "@/lib/auth";
import { listBookmarks, listCategories, getVersion, userVersionKey } from "@/lib/db";
import HomeClient from "./home-client";

// Per-user, cookie-gated content — never static. Rendering on the server means
// the HTML already contains the user's bookmarks, so there is no client-side
// auth check or empty flash on (re)load.
export const dynamic = "force-dynamic";

export default async function Page() {
  const cookieStore = await cookies();
  const session = await readSessionCookie(cookieStore.get(AUTH_COOKIE)?.value);

  const mode = authMode();

  if (!session) {
    return (
      <HomeClient
        initialUser={null}
        initialBookmarks={[]}
        initialCategories={[]}
        initialVersion={null}
        authMode={mode}
      />
    );
  }

  const userId = session.user.id;
  // On a transient DB error, fall back to empty + null version so the client's
  // background revalidation (version mismatch) reloads, rather than 500ing.
  let bookmarks: Awaited<ReturnType<typeof listBookmarks>> = [];
  let categories: Awaited<ReturnType<typeof listCategories>> = [];
  let version: number | null = null;
  try {
    [bookmarks, categories, version] = await Promise.all([
      listBookmarks(userId),
      listCategories(userId),
      getVersion(userVersionKey(userId)),
    ]);
  } catch {
    /* keep fallbacks; HomeClient revalidates on mount */
  }

  return (
    <HomeClient
      initialUser={session.user}
      initialBookmarks={bookmarks}
      initialCategories={categories}
      initialVersion={version}
      authMode={mode}
    />
  );
}
