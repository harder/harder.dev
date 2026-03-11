import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.json" }),
  schema: z.object({
    name: z.string(),
    url: z.url(),
    order: z.number().int().nonnegative(),
    summary: z.string(),
    details: z.array(z.string()).default([])
  })
});

export const collections = { projects };
