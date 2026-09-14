/** Removes decorative leading symbols and collapses whitespace: "  ↳ Buttons" → "Buttons". */
export const displayName = (name: string): string =>
  name
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .trim() || name.trim();

/** Lowercase, ASCII, hyphen-separated file name segment. */
export const slugify = (name: string): string =>
  displayName(name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "untitled";

/** Key used to match a user-supplied page name against Figma page names, ignoring decoration and case. */
export const matchKey = (name: string): string =>
  displayName(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/** Pages made only of dashes, dots, bullets and similar are layout separators in the page list. */
export const isSeparatorPage = (name: string): boolean => matchKey(name) === "";

/** Returns `base`, or `base-2`, `base-3`… if already taken, and records the result. */
export function uniqueName(taken: Set<string>, base: string): string {
  let candidate = base;
  for (let n = 2; taken.has(candidate); n++) candidate = `${base}-${n}`;
  taken.add(candidate);
  return candidate;
}

export const padIndex = (index: number, width = 2): string => String(index).padStart(width, "0");
