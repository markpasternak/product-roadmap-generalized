import type { ItemVM } from "./filters";
import { parseSections } from "./edit/sections";
import { inlineMdToText, isPlaceholder } from "./items";
import { isStoryHeading } from "./sectionHeadings";
import { markdownLabel, resourcePlacements } from "./resources";

export type ReadingSection = {
  heading: string;
  text: string;
  markdown?: string;
};

/** Preserve authored order and repeated/custom headings. Presentation shares retain
 * their explicit content selection; complete readers use the audience-filtered body. */
export function itemReaderContent(item: ItemVM, presentation = false) {
  if (presentation || item.readingBody === undefined) {
    const sections: ReadingSection[] = item.sections.filter(
      (s) => !presentation || isStoryHeading(s.heading),
    );
    return {
      introduction: item.oneliner,
      preamble: "",
      sections: item.outcome
        ? [{ heading: "Target outcome", text: item.outcome }, ...sections]
        : sections,
      hasSource: false,
    };
  }
  // Older source files use "- Label: path" instead of Markdown links. Keep the
  // surrounding prose and order while resolving those references into usable links.
  let body = item.readingBody;
  for (const placement of resourcePlacements(body).reverse()) {
    if (!placement.raw.startsWith(`${placement.label}:`)) continue;
    const link = item.links.find(
      (link) =>
        link.target === placement.href && link.label === placement.label,
    );
    if (!link) continue;
    const label = markdownLabel(
      link.title ? `${link.label}: ${link.title}` : link.label,
    );
    const href = link.href
      .replace(/>/g, "%3E")
      .replace(/</g, "%3C")
      .replace(/[\r\n]/g, "");
    body =
      body.slice(0, placement.start) +
      `[${label}](<${href}>)` +
      body.slice(placement.end);
  }
  const parsed = parseSections(body);
  const sections = parsed.sections.filter(
    (s) => s.body.trim() && !isPlaceholder(s.body),
  );
  const introductionIndex = sections.findIndex(
    (s) => s.heading === "One-liner",
  );
  const introduction =
    introductionIndex < 0 ? "" : sections[introductionIndex].body.trim();
  return {
    introduction,
    // The page title is already rendered as its heading. Preserve any other lead-in prose.
    preamble: parsed.preamble.replace(/^\s*# [^\n]*(?:\n|$)/, "").trim(),
    sections: sections
      .filter((_, index) => index !== introductionIndex)
      .map((s) => ({
        heading: s.heading,
        text: inlineMdToText(s.body),
        markdown: s.body.trim(),
      })),
    hasSource: true,
  };
}
