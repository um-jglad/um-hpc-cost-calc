# AI Coding Assistant Instructions

These instructions will help you get up to speed and contribute effectively.
Ensure that you read through them before starting work on the project.
Remember to update the README.md and this file as you make changes to the codebase.

## 1. Project Structure & Entry Points

- Root files:
  - `index.html`: main HTML template
  - `package.json`: scripts and dependencies (`dev`, `build`, `deploy`)
  - `vite.config.js`: configures Vite with `base: '/um-gl-cost-calc/'` for GitHub Pages
- Source code in `src/`:
  - `main.jsx`: renders the app into the DOM
  - `App.jsx`: primary component containing UI, state, and cost logic
  - `sbatchParser.js`: SBATCH parsing helpers used by the import UI
  - `sbatchParser.test.js`: parser unit tests
  - `index.css`: global styles and layout

## 2. Architecture & Data Flow

- **`App.jsx`** holds:
  - **Partition configurations** in the `PARTITION_RATES` constant
  - State management via React `useState` / `useEffect` hooks
  - Input validation helpers (`isValueEmpty`, `isValueOutOfRange`, etc.)
  - Cost calculation (`calculateCost`) using TRES billing formula
  - SBATCH header parsing/import utilities for existing scripts
  - SLURM script generation (`generateSbatchScript`)
- UI is a simple form → compute cost → display breakdown → optional expand for SLURM script

## 3. Key Patterns & Conventions

- **Inline styling** for dynamic elements; use `index.css` for static layout
- **Validation classes**: input receives `warning` or `error` CSS class based on out-of-range values
- **Collapsible sections**: controlled by boolean `showSbatch` and CSS classes `expanded` / `collapsed`
- **SBATCH import**: parser should only read `#SBATCH` lines and ignore unrelated script text
- **SBATCH import directives**: include CPU/GPU forms such as `--cpus-per-gpu`, `--gpus-per-node`, `--gpus-per-task`, `--ntasks-per-node`, `--ntasks-per-gpu`, and surface warnings for ambiguous or mismatched requests
- **Missing partition fallback**: if GPU directives are present but `--partition` is omitted, assume `--partition=gpu` and show an import warning about the assumption
- **GPU/non-GPU mismatch handling**: if GPU directives are present but a non-GPU partition is selected, switch to `--partition=gpu` and warn about the remap
- **Cluster-switch behavior after import**: when a header has been pasted, changing clusters should trigger a reparse for that cluster rather than resetting fields to partition defaults
- **Time clamping**: all runtime inputs clamped to partition limits (e.g., 14 days, 4h debug)

## 4. Developer Workflows

- Runtime requirements:
  - Node.js `20.19+` or `22.12+` (required by Vite 8)
- Local development:
  ```bash
  npm install
  npm run dev    # starts Vite dev server on http://localhost:5173
  ```
- Production build & preview:
  ```bash
  npm run build  # outputs to `dist/`
  npm run preview
  ```
- Deployment to GitHub Pages:
    - push to `main` branch triggers CI/CD workflow
- CI/CD: `.github/workflows/npm-build-vite.yml` runs on push to `main` and deploys to Pages

## 5. External Integrations

- **React & Vite**: minimal configuration via `@vitejs/plugin-react`
- **GitHub Pages**: configured in `package.json` (`gh-pages`) and `vite.config.js` base path
- No backend or API calls; all computation is client-side

## 6. Contribution Notes

- Keep business logic in `App.jsx` self-contained; extract to helper modules only if repeated or for clarity
- SBATCH parser helpers can live in `src/sbatchParser.js` so they are testable independently of UI
- If adding new partitions, update `PARTITION_RATES` and ensure default values and limits are correct
- When modifying SLURM script, maintain existing comment structure and placeholder values (`YOUR_ACCOUNT`, `YOUR_EMAIL`)
- If a feature is implemented or changed, review the  README.md and update it as needed.
