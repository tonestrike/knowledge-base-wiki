# TypeScript

Strict mode everywhere, with a few exotic options that influence day-to-day code. Configs live in [`@tooling/tsconfig`](../../packages/tooling/tsconfig).

## Table of contents

- [Variants](#variants)
- [Strict-mode posture](#strict-mode-posture)
- [Exotic options worth knowing](#exotic-options-worth-knowing)
- [Imports](#imports)

## Variants

| Variant | Use for |
|---|---|
| `base.json` | Internal packages (no emit) |
| `library.json` | Internal packages that DO emit (rare; only if published) |
| `react.json` | React frontends |
| `worker.json` | Cloudflare Workers (adds Workers types) |

Each package's `tsconfig.json` extends one of these and adds package-specific overrides.

## Strict-mode posture

The base config enables:

| Option | Effect |
|---|---|
| `strict: true` | All standard strict checks |
| `noUncheckedIndexedAccess: true` | `arr[0]` is `T \| undefined`, not `T` |
| `noImplicitOverride: true` | `override` keyword required for overrides |
| `noFallthroughCasesInSwitch: true` | Each `case` must `break`/`return` |
| `useUnknownInCatchVariables: true` | `catch (e)` types `e` as `unknown` |
| `verbatimModuleSyntax: true` | `import type` is required for type-only imports |
| `allowImportingTsExtensions: true` | Import paths can end in `.ts` (Bun-native) |

`exactOptionalPropertyTypes` is OFF (it makes `T \| undefined` overly noisy in practice).

## Exotic options worth knowing

- **`verbatimModuleSyntax`** — Use `import type { Foo } from '...'` for types. The compiler won't infer it for you; biome's `useImportType` rule catches violations.
- **`allowImportingTsExtensions`** — All imports include the `.ts` extension. This is Bun's native style and matches what gets emitted (no extension rewriting).
- **`noUncheckedIndexedAccess`** — Catches a common class of bugs where you index into an array assuming it's non-empty. The fix is either a runtime check or `array.at(0)?` for safe access.

## Imports

### Type-only imports

```ts
import type { Clock } from '@package/shared-kernel';
import { systemClock } from '@package/shared-kernel';
```

### Workspace siblings

Always by package name, never relative:

```ts
import { coreContract } from '@package/contracts/core';   // good
import { coreContract } from '../../packages/contracts/src/core/index.ts';  // bad
```

### Relative imports within a package

Always include `.ts`:

```ts
import { healthSignal } from '../domain/health.ts';
```

### Subpath exports

Packages can expose multiple entry points via `exports`:

```jsonc
{
  "exports": {
    ".": "./src/index.ts",
    "./core": "./src/core/index.ts"
  }
}
```

Then consumers can do `import { x } from '@package/contracts/core'`.

## Don't

- Don't write `any`. biome flags it as an error. Use `unknown` and narrow.
- Don't add `// @ts-ignore` or `// @ts-expect-error` without a comment explaining the constraint and a plan to remove.
- Don't disable strict options per-file. If a particular file genuinely needs different rules, that's a design smell — surface it.
