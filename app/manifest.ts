import type { MetadataRoute } from "next";

// Web app manifest — colors taken from the page's accent palette.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ysite · 즐겨찾기",
    short_name: "ysite",
    description: "내 즐겨찾기를 한 곳에 모아보는 공간",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f5f1",
    theme_color: "#6d5dfc",
    icons: [
      { src: "/web-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/web-icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/web-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
