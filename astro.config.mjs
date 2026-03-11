import { defineConfig, fontProviders } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://harder.dev",
  output: "static",
  integrations: [preact(), sitemap()],
  fonts: [
    {
      name: "Space Grotesk",
      cssVariable: "--font-space-grotesk",
      provider: fontProviders.google(),
      weights: [400, 500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["sans-serif"]
    },
    {
      name: "Chakra Petch",
      cssVariable: "--font-chakra-petch",
      provider: fontProviders.google(),
      weights: [500, 600, 700],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["sans-serif"]
    },
    {
      name: "IBM Plex Mono",
      cssVariable: "--font-ibm-plex-mono",
      provider: fontProviders.google(),
      weights: [400, 500],
      styles: ["normal"],
      subsets: ["latin"],
      fallbacks: ["monospace"]
    }
  ],
  markdown: {
    shikiConfig: {
      theme: "tokyo-night"
    }
  }
});
