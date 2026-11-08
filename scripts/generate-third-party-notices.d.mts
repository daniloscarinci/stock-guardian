/** Types for scripts/generate-third-party-notices.mjs, so the guard test can import it. */

/** Where the generated file lives, relative to the project root. */
export const OUTPUT: string;

/** One npm package the application depends on at run time. */
export interface RuntimePackage {
  /** The package name, e.g. `@capacitor/core`. */
  name: string;
  /** The exact version in package-lock.json. */
  version: string;
  /** The key in package-lock.json's `packages` map, e.g. `node_modules/react`. */
  key: string;
}

/** A package together with the licence material that is printed for it. */
export interface NoticeSection extends RuntimePackage {
  /** The licence the package declares in its own package.json. */
  license: string;
  /** The licence text(s) printed for it, joined. Never empty. */
  text: string;
}

/** Every package reachable from package.json `dependencies`, sorted by name. */
export function runtimePackages(root?: string): RuntimePackage[];

/** One section per runtime package, with its licence text. Throws if a text is missing. */
export function noticeSections(root?: string): NoticeSection[];

/** The whole THIRD-PARTY-NOTICES.txt, exactly as it is written to disk. */
export function renderNotices(root?: string): string;
