import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ysite · 즐겨찾기",
  description: "내 즐겨찾기를 한 곳에 모아보는 공간",
  // iOS "add to home screen" → standalone web app
  appleWebApp: { capable: true, title: "ysite", statusBarStyle: "default" },
  // legacy iOS flag (older Safari still keys off the apple-prefixed name)
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: "#6d5dfc",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        {/* Runs before hydration: if a session is cached, mark the document so
            CSS can suppress the prerendered "checking login" splash. Returning
            (auto-login) users go straight to the app instead of flashing it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(localStorage.getItem('ysite-auth-v1'))document.documentElement.classList.add('has-auth')}catch(e){}",
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
