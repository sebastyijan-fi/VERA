# Changelog

All notable changes to the VERA project will be documented in this file.

## [Unreleased] - Phase 7a Deployment

### Added

- **New CLI**: Introduced the `vera` command-line interface in `@vera/node`.
  - `vera run`: Starts a full VERA node.
  - `vera init`: Generates a default `vera.config.toml`.
- **Networking Layer**: Implemented `@vera/net` for P2P communication and block synchronization.
- **Configuration System**: TOML-based configuration support with environment variable overrides.
- **Docker Support**: Added multi-stage `Dockerfile` and optimized `.dockerignore` for containerized node deployment.
- **Standardized Infrastructure**: All packages now use ESM (`type: module`), consistent metadata, and AGPL-3.0 licensing.

### Fixed

- Standardized `exports` in all `package.json` files for clean public APIs.
- Resolved build inconsistencies across workspace packages using `tsup` and `tsconfig.build.json`.
- Fixed type-only imports and unused declaration errors in core networking and engine modules.

### Changed

- Standardized license to **AGPL-3.0-only** across all core VERA packages.
- Migrated all packages to ESM-first architecture.
