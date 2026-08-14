import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

/**
 * Type-aware, at `recommendedTypeChecked` rather than `strictTypeChecked`.
 *
 * That is a deliberate choice, not laziness. The strict preset's
 * `no-unnecessary-type-conversion` and `no-unnecessary-condition` reason from
 * the *declared* types, and this codebase declares row shapes at trust
 * boundaries - `interface ItemRow { id: string }` is a claim about what SQLite
 * returned, not a guarantee. Running the strict preset's autofix removed those
 * defensive conversions along with a deliberate, documented cast, and broke the
 * typecheck while every test still passed. Rules that confidently delete
 * defensive code at a boundary are worse than no rules there.
 *
 * What is kept are the rules that catch things a human misses: a promise nobody
 * awaited, an object stringified into "[object Object]", a hook dependency
 * forgotten. Plus the project-specific bans at the bottom, which forbid the
 * three ways a well-meaning change could destroy user data or break the offline
 * guarantee.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'src-tauri/**',
      'src/data/*.generated.ts',
      'backup/**',
      'fixtures/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.es2024 },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Template literals build every message and much of the SQL. Numbers in
      // them are fine; a nullish or an object is a bug waiting to be read.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: false, allowNullish: false },
      ],

      // A floating promise here means a write that may never happen, with
      // nothing to tell the user.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/await-thenable': 'error',

      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports' },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      /*
       * Off, with reasons.
       *
       * `require-await`: the SqlDriver interface requires every method to return
       * a Promise, deliberately - a synchronous interface cannot be implemented
       * over a worker. The in-process driver therefore has async methods with
       * nothing to await, which is the interface working as designed.
       */
      '@typescript-eslint/require-await': 'off',

      /*
       * `set-state-in-effect` and `refs` target React Compiler idioms this
       * codebase does not use. Every instance flagged is either data fetching
       * (setting state after an await IS the operation) or resetting a form when
       * a dialog opens with a different item. Both are correct.
       */
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',

      /*
       * `unbound-method`: the transaction guard deliberately passes driver
       * methods as values. They are closures over a driver object, not class
       * methods with a `this` to lose.
       */
      '@typescript-eslint/unbound-method': 'off',

      /*
       * `no-unnecessary-type-assertion`: its autofix already removed load-bearing
       * casts from this codebase once - including the deliberate, documented one
       * in sqlite-init.ts that exists precisely because the published types omit
       * the parameters we need. It reasons from declared types, and the casts it
       * objects to are at engine boundaries where the declared type is a claim.
       */
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',

      /*
       * `no-redundant-type-constituents`: `TranslationKey | string` is
       * deliberate. The union gives autocomplete over every real key while still
       * accepting the keys built at runtime (`priority.${n}`), which is worth
       * more than the theoretical purity of the type.
       */
      '@typescript-eslint/no-redundant-type-constituents': 'off',

      // ---- Project-specific guards ----------------------------------------

      'no-restricted-syntax': [
        'error',
        {
          // Wipes every database in the OPFS pool. It exists for tests and for
          // nothing else; reaching for it to "fix" a corrupt database would
          // destroy the user's only copy.
          selector: "CallExpression > MemberExpression[property.name='wipeFiles']",
          message:
            'wipeFiles() destroys every database in the pool. Quarantine and offer a restore ' +
            'instead - see the recovery ladder in sqlite.worker.ts.',
        },
        {
          // Same category of mistake, delivered as a config flag.
          selector: "Property[key.name='clearOnInit'][value.value=true]",
          message:
            'clearOnInit: true erases stored data on start-up. It is valid only in a test.',
        },
        {
          // The opfs VFS needs SharedArrayBuffer and therefore COOP/COEP headers,
          // which a static host cannot set. It would work locally and fail for
          // every real user - the hardest kind of bug to catch late.
          selector: "MemberExpression[property.name='OpfsDb']",
          message:
            'OpfsDb requires cross-origin isolation, which a static host cannot provide. ' +
            'Use installOpfsSAHPoolVfs - see docs/ARCHITECTURE.md.',
        },
        {
          selector: "MemberExpression[object.name='document'][property.name='write']",
          message: 'document.write is never the answer.',
        },
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message:
            'The original application interpolated user text into innerHTML and shipped a ' +
            'stored-XSS hole that survived reloads. Render text as text.',
        },
      ],
    },
  },

  // Tests exercise the paths production code is forbidden from taking.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', 'src/test/**', 'src/database/driver/memory.driver.ts'],
    rules: {
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
    },
  },

  // Build scripts are plain Node, outside the app's tsconfig. The spread comes
  // first: it carries its own languageOptions and would otherwise overwrite the
  // globals set below it, leaving every Node built-in reported as undefined.
  {
    files: ['scripts/**/*.mjs', '*.config.js', 'eslint.config.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
      parserOptions: { projectService: false },
    },
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      // Scripts print progress; that is their interface.
      'no-console': 'off',
    },
  },

  // The service worker and the SQLite worker run in a worker scope.
  {
    files: ['src/sw.ts', 'src/database/worker/sqlite.worker.ts'],
    languageOptions: { globals: { ...globals.worker } },
  },
);
