import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function repositoryRoot() {
  const candidates = [
    process.env.GITHUB_WORKSPACE,
    process.env.INIT_CWD,
    resolve(process.cwd(), ".."),
    process.cwd(),
  ].filter((candidate): candidate is string => !!candidate);

  return candidates.find((candidate) =>
    existsSync(resolve(candidate, "content/assets")),
  ) ?? resolve(process.cwd(), "..");
}
