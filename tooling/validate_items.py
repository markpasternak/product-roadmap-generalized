#!/usr/bin/env python3
"""Validate every roadmap item markdown file. Exits non-zero on any problem so it
can gate a pull request in CI.

Per file: id present, well-formed (PREFIX-NNN), and unique; title and owner
present; product / horizon / stage from the allowed sets; id prefix matches the
product; filename starts with the id; file lives in the product's folder.
"""
from datetime import date
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ITEMS_DIR = os.path.join(REPO, "content", "items")
PRODUCT_DIR = {
    "Music App": "music-app",
    "Podcasts & Audiobooks": "podcasts-audiobooks",
    "Spotify for Artists": "spotify-for-artists",
    "Ads Platform": "ads-platform",
    "Core Platform & Data": "core-platform-data",
}
PREFIX = {
    "Music App": "MUSIC",
    "Podcasts & Audiobooks": "TALK",
    "Spotify for Artists": "ARTISTS",
    "Ads Platform": "ADS",
    "Core Platform & Data": "PLATFORM",
}
HORIZONS = {"Candidates", "Now", "Next", "Later", "Completed"}
LEVELS = {"Low", "Medium", "High"}
VISIBILITIES = {"Internal", "Public"}
STAGES = {"Discovery", "Validation", "Shaping", "Committed", "Building", "Pilot", "Shipped", "Parked"}
ID_RE = re.compile(r"^(MUSIC|TALK|ARTISTS|ADS|PLATFORM)-\d{3}$")
COVER_POSITION_RE = re.compile(r"^(?:100|\d{1,2})% (?:100|\d{1,2})%$")
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"}


def parse_fm(txt):
    m = re.match(r"^---\n(.*?)\n---", txt, re.S)
    fm = {}
    if m:
        for line in m.group(1).splitlines():
            k, sep, v = line.partition(":")
            if sep:
                fm[k.strip()] = v.strip()
    return fm


YAML_INDICATOR_CHARS = set("-?:,[]{}#&*!|>'\"%@`")
YAML_SCALAR_LOOKALIKE_RE = re.compile(r"^-?[0-9]+(\.[0-9]+)?$|^(true|false|null|yes|no|on|off)$", re.I)


def yaml_scalar_problem(field, raw):
    """Mirrors edit-service/frontmatter.go's needsYAMLQuoting: a value the writer
    would have quoted, found unquoted on disk, is a real YAML parse hazard. Text
    fields that look like a number/bool are flagged too — js-yaml types those,
    and the site's Zod schema then fails the build long after CI went green."""
    v = raw.strip()
    if v.startswith(('"', "'")):
        return None
    if YAML_SCALAR_LOOKALIKE_RE.match(v):
        if field in ("title", "owner", "tags"):
            return f"{field} '{v}' parses as a number/boolean, not text — quote it or rename it"
        return None
    if not v:
        return None
    if v[0] in YAML_INDICATOR_CHARS:
        return f"{field} '{v}' starts with a YAML indicator character — quote it"
    if ": " in v or v.endswith(":"):
        return f"{field} '{v}' contains ':' — quote it"
    if " #" in v:
        return f"{field} '{v}' contains ' #', which YAML reads as a comment — quote it"
    return None


PLACEHOLDER_RE = re.compile(r"^to fill in\.?$", re.I)


def placeholder_sections(txt):
    """Section headings whose body is still the template placeholder ('To fill in.').
    The site hides these at render time; listed here so they get filled in or removed."""
    body = re.sub(r"^---\n.*?\n---", "", txt, flags=re.S)
    found = []
    heading, content = None, []
    for line in body.splitlines() + ["## _end_"]:
        m = re.match(r"^##\s+(.*)", line)
        if m:
            if heading:
                text = re.sub(r"[-*_`\s]+", " ", " ".join(content)).strip()
                if PLACEHOLDER_RE.match(text):
                    found.append(heading)
            heading, content = m.group(1).strip(), []
        elif heading is not None:
            content.append(line)
    return found


def main():
    errors = []
    warnings = []
    seen = {}
    for root, _, files in os.walk(ITEMS_DIR):
        for f in sorted(files):
            if not f.endswith(".md"):
                continue
            path = os.path.join(root, f)
            rel = os.path.relpath(path, REPO)
            txt = open(path).read()
            fm = parse_fm(txt)
            for section in placeholder_sections(txt):
                warnings.append(f"{rel}: '## {section}' is still 'To fill in.' (hidden on the site)")

            def err(msg):
                errors.append(f"{rel}: {msg}")

            for field, raw in fm.items():
                problem = yaml_scalar_problem(field, raw)
                if problem:
                    err(problem)

            rid = fm.get("id", "")
            product = fm.get("product", "")
            if not rid:
                err("missing id")
                continue
            if not ID_RE.match(rid):
                err(f"malformed id '{rid}' (want PREFIX-NNN)")
            if rid in seen:
                err(f"duplicate id '{rid}' (also in {seen[rid]})")
            else:
                seen[rid] = rel
            if not fm.get("title"):
                err("missing title")
            if not fm.get("owner"):
                err("missing owner")
            if product not in PRODUCT_DIR:
                err(f"invalid product '{product}'")
            if fm.get("horizon") not in HORIZONS:
                err(f"invalid horizon '{fm.get('horizon')}'")
            if fm.get("stage") not in STAGES:
                err(f"invalid stage '{fm.get('stage')}'")
            if fm.get("order") and not fm["order"].isdigit():
                err(f"order '{fm['order']}' is not a positive integer")
            for lvl in ("impact", "effort"):
                if fm.get(lvl) and fm[lvl] not in LEVELS:
                    err(f"invalid {lvl} '{fm[lvl]}' (want Low/Medium/High)")
            for field in ("startDate", "endDate"):
                value = fm.get(field, "")
                if value:
                    try:
                        if date.fromisoformat(value).isoformat() != value:
                            raise ValueError()
                    except ValueError:
                        err(f"{field} must be a valid date (YYYY-MM-DD)")
            if fm.get("startDate") and fm.get("endDate") and fm["endDate"] < fm["startDate"]:
                err("endDate must be on or after startDate")
            cover = fm.get("cover", "")
            if cover:
                cover_path = os.path.normpath(os.path.join(os.path.dirname(path), cover))
                assets_root = os.path.join(REPO, "content", "assets") + os.sep
                if not cover_path.startswith(assets_root) or not os.path.isfile(cover_path):
                    err("cover must reference an existing managed resource")
                elif os.path.splitext(cover_path)[1].lower() not in IMAGE_EXTENSIONS:
                    err("cover must be an image resource")
            position = fm.get("coverPosition", "")
            if position and not COVER_POSITION_RE.match(position):
                err("coverPosition must contain horizontal and vertical percentages")
            if position and not cover:
                err("coverPosition requires cover")
            framing = fm.get("coverFraming", "")
            if framing:
                try:
                    framing_value = float(framing)
                    if framing_value < -1 or framing_value > 1:
                        raise ValueError()
                except ValueError:
                    err("coverFraming must be a number from -1 to 1")
            if framing and not cover:
                err("coverFraming requires cover")
            visibility = fm.get("visibility", "Internal")
            if visibility not in VISIBILITIES:
                err(f"invalid visibility '{visibility}' (want Internal/Public)")
            if not f.startswith(f"{rid}-"):
                err(f"filename should start with '{rid}-'")
            if product in PRODUCT_DIR and os.path.dirname(path) != os.path.join(ITEMS_DIR, PRODUCT_DIR[product]):
                err(f"wrong folder for product '{product}' (expected content/items/{PRODUCT_DIR[product]}/)")
            if product in PREFIX and not rid.startswith(PREFIX[product] + "-"):
                err(f"id prefix should match product '{product}' (expected {PREFIX[product]}-…)")

    if warnings:
        print(f"⚠ {len(warnings)} placeholder section(s) (non-blocking):")
        for w in warnings:
            print(f"  - {w}")
    if errors:
        print(f"✗ {len(errors)} problem(s) across roadmap items:")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)
    print(f"✓ {len(seen)} roadmap items valid.")


if __name__ == "__main__":
    main()
