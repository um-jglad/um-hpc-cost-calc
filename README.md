# UM HPC Cost Calculator

A modern web application for calculating job costs on the University of Michigan Great Lakes and Armis2 High Performance Computing clusters.

## Features

- Accurate rate calculations using published rates and TRES weights
- Multiple clusters: Great Lakes and Armis2
- Multiple partitions per cluster (standard, largemem, gpu, and more)
- Real-time cost updates as you adjust parameters
- Import from existing SLURM headers by pasting `#SBATCH` directives
- Import feedback for missing required directives, parse errors, and ignored lines
- Responsive design for desktop and mobile
- Detailed breakdown of resources and dominant billing factor

### Great Lakes partitions

- Standard/Debug (CPU=2505, Memory=358)
- Large Memory (CPU=7704, Memory=185)
- GPU (CPU=1370, Memory=304, GPU=27391)
- SPGPU (CPU=4520, Memory=377, GPU=18079)
- GPU MIG40 (CPU=3424, Memory=221, GPU=27391)

### Armis2 partitions

- Standard/Debug (derived weights CPU≈2900, Memory≈414)
- Large Memory (derived weights CPU≈8037, Memory≈299)
- GPU (derived weights CPU≈2900, Memory≈414, GPU≈28157)

> [!NOTE]
> Billing weights were pulled using `scontrol` on 07/01/2025.

## Getting Started

### Prerequisites

- Node.js (version 20.19+ or 22.12+)
- npm or yarn

### Installation

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the development server:

   ```bash
   npm run dev
   ```

3. Open your browser and navigate to `http://localhost:5173`

### Building for Production

 
```bash
npm run build
```

 
The built files will be in the `dist` directory.

### Running Tests

```bash
npm test
```

Parser unit tests live in `src/sbatchParser.test.js`.

## Usage

1. **Select Cluster**: Choose Great Lakes or Armis2
2. **Select Job Type**: Choose between Single Core, Multicore, or Array job
   - **Single Core Job**: Limited to 1 core (1 node, 1 task, 1 core)
   - **Multicore Job**: For jobs requiring multiple cores with shared memory
   - **Array Job**: For multiple independent jobs with identical resource requirements
3. **Select Partition**: Choose the appropriate partition for your job
4. **Configure Resources**:
   - Set the number of CPU cores needed (automatically set to 1 for Single Core jobs)
   - Specify memory requirements
   - For GPU partitions, set the number of GPUs
   - For Array jobs, set the number of jobs in the array
5. **Set Runtime**: Enter the expected job duration (days, hours, minutes, seconds)
6. **View Cost**: The estimated cost will be calculated automatically, including detailed breakdown
7. **Generate SLURM Script**: Expand the SLURM script section to view and copy an example batch script
8. **Import Existing Header (Optional)**: Paste `#SBATCH` lines from an existing script and click **Parse Header** to populate fields
  - The import panel is collapsed by default; use **Show Import Tool** to expand it
  - Use **Load Example Header** to populate a sample import template quickly

### SBATCH Header Import

The parser reads only lines beginning with `#SBATCH` and ignores all other script text.

Required directives for applying an import:

- `--time`
- CPU/task sizing (`--ntasks`, `--ntasks-per-node`, `--ntasks-per-gpu`, `--cpus-per-task`, and/or `--cpus-per-gpu`)
- Memory (`--mem`, `--mem-per-cpu`, or `--mem-per-gpu`)

Supported directives currently used for estimation:

- `--partition`, `-p`
- `--cpus-per-task`, `-c`
- `--cpus-per-gpu`
- `--ntasks`, `-n`
- `--nodes`, `-N`
- `--ntasks-per-node`
- `--ntasks-per-gpu`
- `--mem`
- `--mem-per-cpu`
- `--mem-per-gpu`
- `--time`, `-t`
- `--gres` (GPU parsing)
- `--gpus`
- `--gpus-per-node`
- `--gpus-per-task`
- `--array`

Notes:

- If `--partition` is omitted, the importer defaults to `standard` for the currently selected cluster.
- If `--mem`, `--mem-per-cpu`, and/or `--mem-per-gpu` are combined, `--mem` takes precedence, then `--mem-per-cpu`, then `--mem-per-gpu`.
- `--array` throttles like `%10` are ignored for cost because they limit concurrency, not total tasks.
- If GPU directives are present but the selected partition is not GPU-capable, a warning is shown advising you to remove GPU directives or switch to a GPU partition.
- Unsupported `#SBATCH` directives are ignored and reported in warnings.

## Cost Calculation

The calculator uses the official Great Lakes TRES billing weights and calculates costs as follows:

- **Billing Formula**:  
  `billing = max(cpu_weight × cores, mem_weight × memory_GB, gpu_weight × gpus)`  
  (weights depend on partition; see above)
- **Cost Formula**:  
  `cost = (total_minutes × billing) ÷ 10,000,000`

The dominant resource (CPU, memory, or GPU) determines the billing for each job. The calculator displays a detailed breakdown of each component and which factor is dominant.

For Armis2, weights are derived to match published per-minute rates for baseline configurations:

- standard/debug: 1 core & 7 GB ≈ $0.000290046/min
- largemem: 1 core & 26.89 GB ≈ $0.000803704/min
- gpu: 1 GPU with 5 cores & 15 GB ≈ $0.002815741/min
If you have exact TRES weights, update them in `CLUSTER_CONFIG.armis2` in `src/App.jsx`.

## Important Notes

- Costs shown are **maximum estimates** and don't account for:
  - UMRCP (University of Michigan Research Computing Package) allocations
  - Unit cost-sharing programs
  - Other funding sources

- For accurate billing information, always use the official `my_job_estimate` command on Great Lakes or Armis2

- This calculator now uses the same TRES billing weights and formulas as the official system for maximum accuracy.

## Rates Source

Rates are based on the official service rates:

- Great Lakes: <https://its.umich.edu/advanced-research-computing/high-performance-computing/great-lakes/rates>
- Armis2: <https://its.umich.edu/advanced-research-computing/high-performance-computing/armis2/rates>

Partition limits and node capacities used in defaults:

- Great Lakes:
  - [Defaults, Limits, and Storage](https://documentation.its.umich.edu/arc-hpc/greatlakes/user-guide/defaults-limits)
  - [Configuration](https://documentation.its.umich.edu/node/4976)
- Armis2:
  - [Defaults, Limits, and Storage](https://documentation.its.umich.edu/node/5165)
  - [Configuration](https://documentation.its.umich.edu/node/5028)