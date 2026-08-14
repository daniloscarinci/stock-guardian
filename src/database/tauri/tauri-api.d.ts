/**
 * Minimal declaration for `@tauri-apps/api/core`.
 *
 * The package is NOT a dependency of this project, on purpose. The desktop
 * driver dynamically imports it and nothing else does, so installing it would
 * add a package to the browser build's dependency tree for code that build can
 * never reach - and the whole point of keeping the runtime dependency list at
 * five is that every entry earns its place.
 *
 * Setting up the desktop build means running `npm install @tauri-apps/api` (see
 * docs/BUILD.md). At that point this file becomes redundant and should be
 * deleted, so the real types apply.
 */
declare module '@tauri-apps/api/core' {
  export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}
