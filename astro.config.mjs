import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://harder.dev",
  output: "static",
  integrations: [preact(), sitemap()],
  markdown: {
    shikiConfig: {
      theme: "tokyo-night"
    }
  }
});
