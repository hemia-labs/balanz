# Balanz Changesets

Run `bun run changeset` for each publishable change. Select `api`, `web`, or both;
the fixed group versions API and web together. Neither package is published to npm.

Merge functional PRs into `main`; the release workflow opens/updates
`changeset-release/balanz`. Merge that version PR to publish `balanz-vX.Y.Z`,
its GitHub Release and the two container images. The worker uses the API image.
The first release aligns the existing API `0.0.1` and web `0.1.0` versions.
PM2 on `develop` continues independently until container deployment is approved.
