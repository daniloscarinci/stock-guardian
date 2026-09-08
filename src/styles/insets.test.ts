/**
 * The safe-area insets, checked as text.
 *
 * These assertions read the stylesheets rather than rendering anything, and
 * that is deliberate rather than lazy. The property being defended cannot be
 * observed from inside a test runner: `env(safe-area-inset-*)` is supplied by
 * the platform, is zero in every browser without a notch, and is zero in
 * happy-dom - which does not apply CSS modules at all. A test that rendered the
 * header and read `getComputedStyle` would pass whether or not a single one of
 * these rules existed. So the file is the subject.
 *
 * Two regressions are worth catching, and they are the two this fix exists to
 * prevent:
 *
 *   1. A token defined without its `0px` fallback, or an `env()` called
 *      directly. Either one is invisible on a phone and wrong on a desktop.
 *   2. A token used as a whole value instead of added to one -
 *      `padding-top: var(--inset-top)` in place of
 *      `padding-top: calc(var(--space-3) + var(--inset-top))`. That reads as
 *      correct, works on the phone it was tested on, and quietly deletes the
 *      spacing everywhere the inset is zero.
 *
 * The third block names the elements that actually meet a screen edge. It is
 * coupled to the stylesheets on purpose: if someone rewrites the header's
 * padding, the failure should say that the clock is about to cover it again
 * rather than saying nothing at all.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS_FILE = 'styles/tokens.css';

const EDGES = ['top', 'right', 'bottom', 'left'] as const;

/** Every stylesheet in `src/`, as a path relative to it. */
function stylesheets(dir: string = SRC): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return stylesheets(full);
    return full.endsWith('.css') ? [relative(SRC, full).replaceAll('\\', '/')] : [];
  });
}

function read(file: string): string {
  return readFileSync(join(SRC, file), 'utf8');
}

/** CSS with its comments removed, so prose about a token is never mistaken for one. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface Block {
  readonly selector: string;
  readonly body: string;
}

/**
 * Flattens a stylesheet to its declaration blocks, descending through at-rules
 * so a rule inside `@media (max-width: 60rem)` is returned alongside its
 * unqualified twin rather than hidden behind it.
 */
function blocks(css: string): Block[] {
  const found: Block[] = [];
  let cursor = 0;

  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    if (open === -1) break;

    const selector = css.slice(cursor, open).trim();

    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === '{') depth += 1;
      else if (css[end] === '}') depth -= 1;
      end += 1;
    }
    const body = css.slice(open + 1, end - 1);

    if (selector.startsWith('@')) found.push(...blocks(body));
    else found.push({ selector, body });

    cursor = end;
  }

  return found;
}

/** The bodies of every rule whose selector list names `target`. */
function rulesFor(file: string, target: string): string {
  const matching = blocks(withoutComments(read(file))).filter(({ selector }) =>
    selector
      .split(',')
      .map((part) => part.trim())
      .some((part) => part === target || part.startsWith(`${target}:`)),
  );
  expect(matching, `${file} has no rule for ${target}`).not.toHaveLength(0);
  return matching.map(({ body }) => body).join('\n');
}

/** Individual declarations, split out of a rule body. */
function declarations(body: string): string[] {
  return body
    .split(';')
    .map((declaration) => declaration.trim())
    .filter((declaration) => declaration !== '');
}

describe('the safe-area inset tokens', () => {
  // Comments stripped: the note above the tokens names `env()` while warning
  // against calling it directly, and that sentence is not a declaration.
  const tokens = withoutComments(read(TOKENS_FILE));

  it.each(EDGES)('defines --inset-%s from the platform', (edge) => {
    expect(tokens).toContain(`--inset-${edge}: env(safe-area-inset-${edge}, 0px);`);
  });

  it('falls every inset back to 0px, which is what keeps the desktop unchanged', () => {
    const calls = tokens.match(/env\([^)]*\)/g) ?? [];
    expect(calls).toHaveLength(EDGES.length);
    for (const call of calls) expect(call).toMatch(/,\s*0px\)$/);
  });

  it('defines them on bare :root, so a value exists before any theme is applied', () => {
    // A token defined only inside a theme block is undefined in the other
    // theme, and an undefined token makes the whole calc() invalid - which
    // drops the padding entirely rather than reducing it.
    const themed = tokens.indexOf(":root[data-theme='dark']");
    expect(themed).toBeGreaterThan(-1);
    for (const edge of EDGES) {
      const declared = tokens.indexOf(`--inset-${edge}:`);
      expect(declared).toBeGreaterThan(-1);
      expect(declared).toBeLessThan(themed);
    }
  });
});

describe('every stylesheet that honours an inset', () => {
  it('reaches the platform through the tokens and never through env() directly', () => {
    const direct = stylesheets()
      .filter((file) => file !== TOKENS_FILE)
      .filter((file) => withoutComments(read(file)).includes('env('));
    expect(direct).toEqual([]);
  });

  it('adds an inset to the spacing that was there, never replaces it', () => {
    const replacements: string[] = [];

    for (const file of stylesheets()) {
      if (file === TOKENS_FILE) continue;
      for (const block of blocks(withoutComments(read(file)))) {
        for (const declaration of declarations(block.body)) {
          if (!declaration.includes('var(--inset-')) continue;
          // calc() is the whole point: it is what makes the inset additive.
          if (declaration.includes('calc(')) continue;
          replacements.push(`${file}  ${block.selector} { ${declaration} }`);
        }
      }
    }

    expect(replacements).toEqual([]);
  });
});

describe('the elements that meet a screen edge', () => {
  const EDGE_RULES = [
    // The application shell. The header is the element the report was about: it
    // is sticky at top: 0, so with no inset it sits under the clock.
    { file: 'app/Layout.module.css', target: '.header', edges: ['top', 'right', 'left'] },
    // Full height in both layouts, and the leftmost thing on screen in both.
    { file: 'app/Layout.module.css', target: '.sidebar', edges: ['top', 'bottom', 'left'] },
    // Scrolls to the bottom of the screen wherever there is no quick bar.
    { file: 'app/Layout.module.css', target: '.content', edges: ['right', 'bottom', 'left'] },
    // Pinned over the gesture area, its buttons running the full width.
    { file: 'app/Layout.module.css', target: '.quickBar', edges: ['right', 'bottom', 'left'] },
    // The whole viewport with no header above it: startup, and the crash screen.
    { file: 'app/StartupScreen.module.css', target: '.screen', edges: EDGES },
    // Centred on a desktop, a bottom sheet on a phone; held inside the safe area.
    { file: 'components/ui/Dialog.module.css', target: '.dialog', edges: EDGES },
    // The dialog's actions sit exactly where the gesture bar is.
    { file: 'components/ui/Dialog.module.css', target: '.footer', edges: ['bottom'] },
    // And the body carries that bottom edge itself in a dialog with no footer -
    // the voice sheet, whose send button is the last thing in the scroll box.
    {
      file: 'components/ui/Dialog.module.css',
      target: '.body',
      edges: ['right', 'bottom', 'left'],
    },
    // The skip link pins itself to the top-left corner.
    { file: 'styles/base.css', target: '.sr-only-focusable', edges: ['top', 'left'] },
  ] as const;

  it.each(EDGE_RULES)('$target in $file keeps clear of $edges', ({ file, target, edges }) => {
    const body = rulesFor(file, target);
    for (const edge of edges) expect(body).toContain(`var(--inset-${edge})`);
  });

  it('grows the header box by the top inset as well as its padding', () => {
    // Padding alone would keep the old height and push the menu button and the
    // language select down into the bottom border instead of making room above
    // them. This is the half of the header fix that is easy to leave out.
    const minHeight = declarations(rulesFor('app/Layout.module.css', '.header')).filter(
      (declaration) => declaration.startsWith('min-height:'),
    );
    expect(minHeight).toHaveLength(1);
    expect(minHeight[0]).toContain('var(--inset-top)');
  });
});
