import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRoot } from "./repositoryRoot";

describe("repositoryRoot", () => {
  it("finds roadmap content from the site build and test working directories", () => {
    const root = repositoryRoot();
    expect(existsSync(resolve(root, "content/items"))).toBe(true);
  });
});
