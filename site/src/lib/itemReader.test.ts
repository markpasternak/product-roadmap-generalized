import { describe, expect, it } from "vitest";
import { itemReaderContent } from "./itemReader";
import { buildPublishedModel } from "./published/model";
import { itemsFromApi } from "./edit/liveItems";
import { projectBoard } from "./edit/project";
import { projectForShare } from "./share/project";
import { itemSchema } from "./schema";
import { EMPTY_ITEM_HISTORY } from "./itemHistory";

const body =
  "# Example\n\nLead-in prose.\n\n## One-liner\nA **formatted** summary.\n\n## Open questions\nFirst question.\n\n## Who it's for\nCreative teams.\n\n## Custom section\n![Diagram](https://example.com/diagram.png)\n\n## Custom section\nSecond custom section.\n\n## Links\nMore context.\n\n- Reference: https://example.com\n\n## Resources\nAdditional resource prose.\n\n## Empty\n\n## Placeholder\nTo fill in.\n";
const data = itemSchema.parse({
  id: "CM-057",
  title: "Example",
  product: "Creative Manager",
  horizon: "Later",
  stage: "Discovery",
  owner: "PM",
  visibility: "Public",
});
const source = {
  items: [
    {
      id: data.id,
      filePath: "content/items/creative-manager/CM-057-example.md",
      data,
      body,
    },
  ],
  documents: [],
};
const options = {
  base: "/roadmap/",
  audience: "internal" as const,
  historyForPath: () => EMPTY_ITEM_HISTORY,
};

describe("complete item reading content", () => {
  it("preserves original order, custom and repeated headings, image-only sections and resource prose", () => {
    const item = buildPublishedModel(source, options).boardItems[0];
    const content = itemReaderContent(item);
    expect(content.introduction).toBe("A **formatted** summary.");
    expect(content.preamble).toBe("Lead-in prose.");
    expect(content.sections.map((s) => s.heading)).toEqual([
      "Open questions",
      "Who it's for",
      "Custom section",
      "Custom section",
      "Links",
      "Resources",
    ]);
    expect(content.sections[2].markdown).toContain("![Diagram]");
    expect(content.sections[4].markdown).toContain("More context.");
    expect(content.sections[5].markdown).toBe("Additional resource prose.");
  });
  it("keeps complete content after API refresh and local draft projection", () => {
    const published = buildPublishedModel(source, options).boardItems[0];
    const api = itemsFromApi(
      [
        {
          id: data.id,
          path: source.items[0].filePath,
          frontmatter: Object.fromEntries(
            Object.entries(data).map(([key, value]) => [key, String(value)]),
          ),
          body,
        },
      ],
      "/roadmap/",
    )[0];
    expect(itemReaderContent(api)).toEqual(itemReaderContent(published));
    const [draft] = projectBoard([published], {
      updated: [
        {
          id: data.id,
          frontmatter: {},
          body: `${body}\n## Draft note\nNew context.`,
          bodySet: true,
        },
      ],
      created: [],
      deletedIds: [],
      reorder: {},
    });
    expect(itemReaderContent(draft).sections.at(-1)?.markdown).toBe(
      "New context.",
    );
  });
  it("keeps public filtering and recipient projection ahead of complete rendering", () => {
    const publicItem = buildPublishedModel(source, {
      ...options,
      audience: "public",
    }).boardItems[0];
    expect(JSON.stringify(publicItem)).not.toMatch(
      /First question|Second custom section/,
    );
    expect(
      itemReaderContent(publicItem).sections.map((s) => s.heading),
    ).toContain("Who it's for");
    const internal = buildPublishedModel(source, options).boardItems[0];
    expect(JSON.stringify(projectForShare(internal))).not.toMatch(
      /readingBody|First question|Additional resource prose/,
    );
    expect(
      itemReaderContent(internal, true).sections.map((s) => s.heading),
    ).not.toContain("Open questions");
  });
});
