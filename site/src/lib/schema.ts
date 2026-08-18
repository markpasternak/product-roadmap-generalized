// Content-collection schemas + the canonical enum constants used across the site.
import { z } from 'zod';

export const PRODUCTS = [
  'Music App',
  'Podcasts & Audiobooks',
  'Spotify for Artists',
  'Ads Platform',
  'Core Platform & Data',
] as const;
export const HORIZONS = ['Candidates', 'Now', 'Next', 'Later', 'Completed'] as const;
export const STAGES = [
  'Discovery', 'Validation', 'Shaping', 'Committed', 'Building', 'Pilot', 'Shipped', 'Parked',
] as const;
export const LEVELS = ['Low', 'Medium', 'High'] as const;
export const VISIBILITIES = ['Internal', 'Public'] as const;
export const EXTERNAL_VISIBILITIES = ['Internal only', 'Customer-safe', 'Public'] as const;

export type Product = (typeof PRODUCTS)[number];
export type Horizon = (typeof HORIZONS)[number];
export type Stage = (typeof STAGES)[number];
export type Level = (typeof LEVELS)[number];
export type Visibility = (typeof VISIBILITIES)[number];
export type ExternalVisibility = (typeof EXTERNAL_VISIBILITIES)[number];

export const itemSchema = z.object({
  id: z.string(),
  title: z.string(),
  product: z.enum(PRODUCTS),
  horizon: z.enum(HORIZONS),
  stage: z.enum(STAGES),
  owner: z.string(),
  tags: z.string().optional(),
  impact: z.enum(LEVELS).optional(),
  effort: z.enum(LEVELS).optional(),
  order: z.coerce.number().default(999),
  visibility: z.enum(VISIBILITIES).default('Internal'),
  // External sharing metadata. Copy stays canonical; public/share surfaces hide
  // internal-only detail sections rather than using parallel customer-facing copy.
  external_visibility: z.enum(EXTERNAL_VISIBILITIES).default('Internal only'),
});
export type ItemFrontmatter = z.infer<typeof itemSchema>;

// Docs (PRD / technical-design / research) carry a lighter, varied frontmatter.
export const docSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  roadmap_item: z.string().optional(),
  owner: z.string().optional(),
  status: z.string().optional(),
  related: z.array(z.string()).optional(),
  visibility: z.enum(VISIBILITIES).default('Internal'),
  updated: z.coerce.date().optional(),
});
export type DocFrontmatter = z.infer<typeof docSchema>;
