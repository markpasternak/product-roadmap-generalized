// Astro adapter. Published transformations also run without Astro in content jobs.
import { getCollection } from "astro:content";
import { getVisibleDocCollections } from "./docs";
import { AUDIENCE } from "./audience";
import { itemHistoryForPath } from "./itemHistory.server";
import { buildPublishedModel } from "./published/model";

export async function buildBoardItems(base: string) {
  return buildPublishedModel({
    items: await getCollection("items"),
    documents: await getVisibleDocCollections(),
  }, { base, audience: AUDIENCE, historyForPath: itemHistoryForPath }).boardItems;
}
