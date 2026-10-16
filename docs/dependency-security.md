# Development dependency advisory status

## Bounded maintenance, 2026-10-15

The seven advisories documented on 2026-10-13 have been addressed by updating the two direct development dependencies from the official npm registry (`https://registry.npmjs.org`). The earlier cancelled install did not change the lockfile; this update was performed locally and was not relocated into CI.

- Vite: **7.1.12 → 7.3.7**, exact pin retained. This is the current npm-recommended fix on the [supported Vite 7.3 branch](https://vite.dev/releases), avoiding an unrelated Vite 8 migration. [Release](https://github.com/vitejs/vite/releases/tag/v7.3.7).
- Happy DOM: **20.0.10 → 20.8.9**, the minimum release fixing both documented advisories. The declared range now starts at `^20.8.9`; `npm ci` installs the exact 20.8.9 lockfile entry. This does not claim an upstream LTS commitment for Happy DOM 20. [Release](https://github.com/capricorn86/happy-dom/releases/tag/v20.8.9).
- The dependency-tree changes are confined to those packages and their required dependencies: Vite's esbuild becomes 0.28.2 (including its platform packages); Happy DOM adds `entities` 7.0.1, `ws` 8.22.0 and `@types/ws` 8.18.2. Other existing locked package versions are unchanged. Production dependency entries, the exact `clipper2-ts` 2.0.1-18 pin and the private adapter are unchanged.

## Exact advisory scope

The affected ranges below describe the old installed major versions, not every upstream version range. Maintainer advisories and npm's live advisory feed were checked on 2026-10-15.

| Package / advisory                                                                                                    | Affected range relevant here                     | First fixed version on that major | Risk                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Vite [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9), CVE-2026-39365                         | `>=7.0.0 <=7.3.1`                                | 7.3.2                             | Optimized-dependency source-map traversal can disclose parseable `.map` files outside the allowed directory.                           |
| Vite [GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r), CVE-2026-39364                         | `>=7.1.0 <=7.3.1`                                | 7.3.2                             | Query suffixes can bypass the development-server file deny list.                                                                       |
| Vite [GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583), CVE-2026-39363                         | `>=7.0.0 <=7.3.1`                                | 7.3.2                             | Development-server WebSocket module requests can bypass filesystem restrictions.                                                       |
| Vite / bundled launch-editor [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3), CVE-2026-53632 | Vite `>=7.0.0 <=7.3.4`; launch-editor `<=2.14.0` | Vite 7.3.5; launch-editor 2.14.1  | A malicious website can trigger Windows UNC access through an active editor-opening middleware and disclose an NTLMv2 credential hash. |
| Vite [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff), CVE-2026-53571                         | `>=7.0.0 <=7.3.4`                                | 7.3.5                             | NTFS alternate streams or Windows short paths can bypass the development-server file deny list.                                        |
| Happy DOM [GHSA-w4gp-fjgq-3q4g](https://github.com/advisories/GHSA-w4gp-fjgq-3q4g), CVE-2026-34226                    | `<20.8.9`                                        | 20.8.9                            | Credentialed cross-origin fetch can send page-origin cookies to the request destination.                                               |
| Happy DOM [GHSA-6q6h-j7hj-3r64](https://github.com/advisories/GHSA-6q6h-j7hj-3r64), CVE-2026-33943                    | `>=15.10.0 <=20.8.7`                             | 20.8.8                            | Untrusted module export expressions can execute when Happy DOM JavaScript evaluation is explicitly enabled.                            |

## Actual paths and exposure boundary

`npm ls vite happy-dom --all` resolves one direct copy each at `node_modules/vite` and `node_modules/happy-dom`. The old Vite distribution bundled launch-editor 2.11.1 in `node_modules/vite/dist/node/chunks/config.js`; the updated distribution bundles 2.14.2. `npm ls launch-editor` does not list that bundled code as a separate package, so installing or overriding a separate launch-editor dependency would not repair this path.

Vite is used by the development server and production build. Happy DOM is imported only by synthetic DOM tests. Neither is imported by the shipped geometry core or bundled desktop application; the headless CLI uses the geometry/runtime dependencies, not these development tools. Development-only does not mean harmless: Vite runs on a developer or CI host and Happy DOM runs in the test process.

Keep development servers bound to loopback and use only trusted repository code and fixtures. The Windows UNC issue also requires avoiding attacker-controlled pages while a vulnerable local server runs; loopback binding alone was not a complete mitigation. Current tests supply no user credentials, stub application fetch in synthetic editor tests, and do not enable Happy DOM module-script evaluation for untrusted HTML. CI opens only this repository's editor, uses `contents: read`, does not persist checkout credentials and does not publish a release.

## Validation and residual limits

The fresh npm audit before updating reported two high-severity affected dependency entries, covering the seven advisories above. A fresh full `npm audit --json` after updating reports **0 known vulnerabilities** in this npm dependency tree (2026-10-15). That result is a point-in-time advisory-feed check, not a whole-project security audit or a guarantee that unknown vulnerabilities do not exist.

Use `npm ci`, `npm run check` and `npm run test:e2e` against this lockfile. The Windows workflow additionally checks Rust tests, the native font smoke test and unsigned NSIS packaging. Exact-commit CI is required before calling this maintenance checkpoint verified; a successful dependency audit alone does not satisfy those checks. Native WebView2/IME and interrupted native open/save/close acceptance remain separate desktop work, as described in [verification](verification.md).

This maintenance does not audit application logic, Rust dependencies, the operating system, signing, externally resolved Tauri CLI tooling or future registry contents. No authentication, permissions, security settings, workflow or release policy was changed.
