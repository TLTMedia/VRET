# Git Refactor Proposal: Feature-Based Structure

The repository has grown organically from an A-Frame/Three.js experiment into a Babylon.js and Next.js-based VRM integration suite. To improve maintainability and speed up development, we propose the following restructuring and branching strategy.

## 1. Directory Restructuring (Phase 1)
Clear the root directory by categorizing files into functional sub-directories.

- **`/legacy-archive`**: Move all A-Frame/Three.js `.html` and `js/*.js` files here. These are valuable for reference but are no longer active targets.
- **`/packages` or `/projects`**:
  - **`babylon-vrm-plugin`**: The core logic currently in the root and `src/`.
  - **`bjse-editor-integration`**: The code from `BJSE_project` and `NewBJSE_project`.
- **`/assets`**:
  - Centralize `models/`, `vrma/`, and `audio/`.
  - Use **Git LFS** for `.vrm` and `.vrma` files to keep the main repo clones fast.
- **`/tools`**: Consolidate Python and Node utility scripts (like `vrm_to_vrm1.py`).

## 2. Feature Branching Workflow
Instead of long-running development on `main` or `babvrm`, adopt a "Branch-per-Feature" model.

### Branch Naming Conventions:
- `feat/feature-name`: New functional components (e.g., `feat/facial-expressions`).
- `fix/bug-name`: Targeted bug fixes.
- `chore/cleanup`: Refactoring and directory reorganization.
- `research/topic`: Experimental code (e.g., `research/web-gpu-vrm`).

### The "Integration" Branch:
- Keep `main` as the stable production/deployment branch.
- Use `develop` or a temporary feature-track branch (like the current `babvrm`) to stage multiple features before they hit `main`.

## 3. Consolidation of Babylon Logic
Currently, `src/`, `BJSE_project/src/`, and `NewBJSE_project/src/` contain overlapping logic for `VrmLoader`, `Actor`, and `VrmaPlayer`.

- **Strategy**: Move shared logic into a single internal library (e.g., `packages/vrm-core`) and import it into the specific projects.
- **Benefit**: Fixes in the loader benefit the standalone player and the BJSE editor simultaneously.

## 4. Automation & CI/CD
- **Linting & Formatting**: Add project-wide Prettier/ESLint configs to stop formatting diffs from cluttering commits.
- **Automated Checks**: Run `vrm_verify_vrm1_expressions.py` or similar scripts as part of a GitHub Action on PRs to ensure asset integrity.

## 5. Transition Plan
1. **Freeze `main`**: Tag the current state as `v0.1.0-legacy`.
2. **Execute Cleanup**: Move legacy files and consolidate `src/`.
3. **Branch Switch**: Start the next task (e.g., "lipsync improvements") on a dedicated branch `feat/lipsync-v2` instead of working directly on the project's heavy-payload branches.
