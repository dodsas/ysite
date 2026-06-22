import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ysite · 즐겨찾기",
  description: "내 즐겨찾기를 한 곳에 모아보는 공간",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
