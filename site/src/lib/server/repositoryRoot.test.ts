import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { repositoryRoot } from "./repositoryRoot";

describe("repositoryRoot", () => {
  it("finds managed assets from the site build and test working directories", () => {
    const root = repositoryRoot();
    expect(existsSync(resolve(root, "content/assets"))).toBe(true);
  });
});
