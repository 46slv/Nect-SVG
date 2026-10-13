# Development dependency advisory status

2026-10-13 audit identified two affected **development-only** packages in the current lockfile:

- Vite 7.1.12: optimized-dependency map traversal ([GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)); deny-list query bypass ([GHSA-v2wj-q39q-566r](https://github.com/advisories/GHSA-v2wj-q39q-566r)); dev-server WebSocket arbitrary read ([GHSA-p9ff-h696-f583](https://github.com/advisories/GHSA-p9ff-h696-f583)); Windows launch-editor UNC credential disclosure ([GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)); Windows alternate-path deny bypass ([GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)). Audit recommends Vite 7.3.7.
- Happy DOM 20.0.10: cross-origin fetch credential handling ([GHSA-w4gp-fjgq-3q4g](https://github.com/advisories/GHSA-w4gp-fjgq-3q4g)); unsafe module export-name compilation ([GHSA-6q6h-j7hj-3r64](https://github.com/advisories/GHSA-6q6h-j7hj-3r64)). Advisory-fixed target: 20.8.9 or later.

The dependency update did **not** complete because its network approval was cancelled before decision. Package versions and lockfile remain unchanged; this is an open security maintenance item, not a successful update. Do not expose the development server publicly or treat this branch as release-ready.

Limited validation remains reasonable in the isolated CI job: the dev server binds loopback, Chrome opens only this repository's editor, tests use repository-authored source/fixtures, Happy DOM fetch is stubbed, no third-party pages or imported remote modules are executed, no user credentials are supplied, and checkout does not persist Git credentials. The workflow has only contents:read and does not publish a release. This containment does not fix the packages.

Vite and Happy DOM are not imported by the shipped geometry core or bundled desktop application. The headless CLI imports Paper.js and OpenType.js, not these development dependencies. Nevertheless, upgrades and a fresh audit are required before final delivery. The next dependency update must use the supported approved network path; do not relocate the cancelled install into CI as a workaround.
