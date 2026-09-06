import { describe, it, expect } from "vitest";
import {
  attachResource,
  resourcePlacements,
  repositoryAssetPath,
  replaceResourceReferences,
  removeResourcePlacement,
} from "./resources";
import { renderRichMarkdown } from "./richMarkdown";

const original = "../../assets/ast_one/rev_first/image.png";
const replacement = "../../assets/ast_one/rev_second/image.png";

describe("portable resource references", () => {
  it("accepts only confined, versioned file paths", () => {
    expect(repositoryAssetPath(original)).toBe(
      "content/assets/ast_one/rev_first/image.png",
    );
    for (const path of [
      "../../assets/ast_one/rev_one/../secret",
      "/assets/ast_one/rev_one/%2e%2e%2fsecret",
      "//evil/assets/ast_one/rev_one/x.png",
    ])
      expect(repositoryAssetPath(path)).toBeNull();
  });
  it("finds inline, reference-style and linked images while ignoring code examples", () => {
    const body = `## What ships\n\n[![Caption](${original})](https://example.com)\n\n![Again][file]\n\n\`${original}\`\n\n\`\`\`\`md\n![Example](${original})\n\`\`\`\n\`\`\`\`\n\n[file]: ${original}\n`;
    expect(
      resourcePlacements(body)
        .filter((p) => p.image)
        .map((p) => p.label),
    ).toEqual(["Caption", "Again"]);
    const updated = replaceResourceReferences(body, original, replacement);
    expect(updated).toContain(
      `[![Caption](${replacement})](https://example.com)`,
    );
    expect(updated).toContain(`![Again](${replacement})`);
    expect(updated).toContain(`![Example](${original})`);
  });
  it("keeps existing legacy links editable without rewriting the document", () => {
    const body =
      "## Links\n\n- PRD: ../../prds/creative.md\n- Design: https://example.com/design\n";
    const placements = resourcePlacements(body);
    expect(placements.map((p) => [p.label, p.href])).toEqual([
      ["PRD", "../../prds/creative.md"],
      ["Design", "https://example.com/design"],
    ]);
    expect(removeResourcePlacement(body, placements[0])).toBe(
      "## Links\n\n- Design: https://example.com/design\n",
    );
  });
  it("adds resources outside fenced headings and before the next real section", () => {
    const body =
      "## Why it matters\n\n```md\n## Resources\n```\n\n## Resources\n\n- [Old](https://example.com)\n\n## Progress\n\nNext step\n";
    const result = attachResource(body, "New", original);
    expect(result.indexOf("[New]")).toBeGreaterThan(result.indexOf("[Old]"));
    expect(result.indexOf("[New]")).toBeLessThan(result.indexOf("## Progress"));
    expect(result).toContain("```md\n## Resources\n```");
  });
  it("does not replace unrelated external links", () => {
    const body = "[A](https://a.test) [B](https://b.test)";
    expect(replaceResourceReferences(body, "https://a.test", replacement)).toBe(
      body,
    );
  });
  it("renders GFM, resolves assets with a base path and blocks active markup", () => {
    const html = renderRichMarkdown(
      `![Helpful description](${original})\n\n- [x] Ready\n\n<script>alert(1)</script>\n\n[Bad](javascript:alert)`,
      "/roadmap/",
    );
    expect(html).toContain('src="/roadmap/assets/ast_one/rev_first/image.png"');
    expect(html).toContain('alt="Helpful description"');
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
    expect(
      renderRichMarkdown(`[![Image](${original})](https://example.com)`),
    ).toMatch(/<a [^>]+><span[^>]*><img/);
  });
});
