# Jelly Study

An interactive 3D playground for gummy fruit. Add, stretch, slice, recolor, and stack soft-body fruit pieces.

## Browser support

Full physics requires WebGPU and a compatible GPU adapter. Unsupported browsers show an explicitly labeled CPU-rendered still preview; camera, color, and scene editing remain available.

## Run locally

Use Node.js 22.12+ (or Node.js 24) and pnpm 10.26.1:

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm test
```

## Update GitHub Pages

```sh
pnpm build
```

Commit both the source changes and rebuilt `docs/` directory. GitHub Pages serves the `docs/` directory from the default branch. The build defaults to the `/jelly-study/` base path. For another repository name, set `BASE_PATH=/your-repository/` when building.

The `docs/` output is intentionally tracked so publishing does not require a custom GitHub Actions workflow or a runtime server.

## Rights note

This project adapts externally supplied source code. The new bear design, materials, and interface do **not** establish rights to the underlying code. Confirm permission to use the original code—or replace it with independently authored code—before publishing or distributing the app. The supplied reference image is not embedded in the app.
