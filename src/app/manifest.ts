import type { MetadataRoute } from "next";

// Makes Stookii an installable app (PWA). Once this is live, staff open the link
// in Chrome / Edge / Safari and choose "Install" / "Add to Home Screen" — it
// lands on their device with its own icon and opens full-screen, no browser bar.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Stookii — ON Mart",
    short_name: "Stookii",
    description: "Point of sale, cash management and stock for ON Mart.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f6f8fc",
    theme_color: "#2549e8",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
