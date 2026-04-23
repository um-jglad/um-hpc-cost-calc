import React, { useState, useEffect, useRef } from 'react';
import {
  EXAMPLE_SBATCH_HEADER,
  parseArrayTaskCount,
  parseGres,
  parseGpuCountSpec,
  parseMemoryDirectiveToGb,
  parseNodesMinCount,
  parsePositiveInteger,
  parseSbatchHeader,
  parseTimeDirectiveToSeconds,
  resolvePartition
} from './sbatchParser';
// GitHub icon link fixed in the top-right is rendered inline

// Cluster partition configurations with TRES billing weights
// NOTE: Great Lakes weights were sourced from GL on 2025-07-01.
//       Armis2 weights are derived to match published per-minute rates using typical defaults.
const CLUSTER_CONFIG = {
  greatlakes: {
    label: 'Great Lakes',
    partitions: {
      standard: {
        name: 'Standard',
        defaultCores: 1,
        defaultMemoryPerCore: 7, // GB
        maxCores: 36,
        maxMemory: 180, // GB
        hasGPU: false,
        description: 'General purpose compute partition',
        billing: { cpu_weight: 2505, mem_weight: 358, gpu_weight: 0 }
      },
      debug: {
        name: 'Debug',
        defaultCores: 1,
        defaultMemoryPerCore: 7, // GB
        maxCores: 8,
        maxMemory: 40, // GB
        hasGPU: false,
        description: 'Debug partition for testing jobs (max 4 hours)',
        billing: { cpu_weight: 2505, mem_weight: 358, gpu_weight: 0 }
      },
      viz: {
        name: 'Visualization',
        defaultCores: 1,
        defaultMemoryPerCore: 7, // GB
        maxCores: 40,
        maxMemory: 180, // GB
        hasGPU: false,
        description: 'Visualization partition (max 2 hours)',
        billing: { cpu_weight: 2505, mem_weight: 358, gpu_weight: 0 }
      },
      largemem: {
        name: 'Large Memory',
        defaultCores: 1,
        defaultMemoryPerCore: 42, // GB (rounded from 41.75)
        maxCores: 36,
        maxMemory: 1503, // GB
        hasGPU: false,
        description: 'High memory nodes for memory-intensive jobs',
        billing: { cpu_weight: 7704, mem_weight: 185, gpu_weight: 0 }
      },
      gpu: {
        name: 'GPU',
        defaultCores: 20,
        defaultMemoryPerCore: 5, // GB (rounded from 4.5, 90GB / 20 cores)
        maxCores: 40,
        maxMemory: 180, // GB
        hasGPU: true,
        description: 'GPU-accelerated computing with V100 GPUs',
        billing: { cpu_weight: 1370, mem_weight: 304, gpu_weight: 27391 }
      },
      gpu_mig40: {
        name: 'MIG40 GPU',
        defaultCores: 8,
        defaultMemoryPerCore: 16, // GB (rounded from 15.625, 125GB / 8 cores)
        maxCores: 64,
        maxMemory: 1000, // GB
        hasGPU: true,
        description: 'GPU partition with 1/2 A100 GPU (40GB each)',
        billing: { cpu_weight: 3424, mem_weight: 221, gpu_weight: 27391 }
      },
      spgpu: {
        name: 'SPGPU',
        defaultCores: 4,
        defaultMemoryPerCore: 12, // GB (48GB / 4 cores)
        maxCores: 32,
        maxMemory: 372, // GB
        hasGPU: true,
        description: 'SPGPU partition with A40 GPUs',
        billing: { cpu_weight: 4520, mem_weight: 377, gpu_weight: 18079 }
      }
    }
  },
  armis2: {
    label: 'Armis2',
    partitions: {
      standard: {
        name: 'Standard',
        defaultCores: 1,
        defaultMemoryPerCore: 7, // baseline used in published rate table
        maxCores: 24, // per-node cores
        maxMemory: 123, // GB (rounded from 122.8 requestable)
        hasGPU: false,
        description: 'General purpose compute partition on Armis2',
        // Derived to match ~$0.000290046/min for 1 core & 7 GB
        billing: { cpu_weight: 2900, mem_weight: 414, gpu_weight: 0 }
      },
      debug: {
        name: 'Debug',
        defaultCores: 1,
        defaultMemoryPerCore: 7,
        maxCores: 8,
        maxMemory: 40,
        hasGPU: false,
        description: 'Debug partition for testing jobs',
        billing: { cpu_weight: 2900, mem_weight: 414, gpu_weight: 0 }
      },
      largemem: {
        name: 'Large Memory',
        defaultCores: 1,
        defaultMemoryPerCore: 27, // GB (rounded from 26.89)
        maxCores: 36,
        maxMemory: 1542, // GB requestable
        hasGPU: false,
        description: 'High memory nodes (1.5 TB) on Armis2',
        // Derived to match ~$0.000803704/min for 1 core & 26.89 GB
        billing: { cpu_weight: 8037, mem_weight: 299, gpu_weight: 0 }
      },
      gpu: {
        name: 'GPU',
        defaultCores: 5,
        defaultMemoryPerCore: 3, // 5 cores -> 15 GB baseline
        maxCores: 40, // up to V100 node
        maxMemory: 184, // GB (rounded from 184.3 requestable on V100)
        hasGPU: true,
        description: 'GPU partition (TitanV and V100 nodes)',
        // Derived to match ~$0.002815741/min for 1 GPU, 5 cores, 15 GB
        billing: { cpu_weight: 2900, mem_weight: 414, gpu_weight: 28157 },
        gpuTypes: {
          v100: { label: 'V100', maxCores: 40, maxMemory: 184 },
          titanv: { label: 'Titan V', maxCores: 16, maxMemory: 123 }
        },
        defaultGpuType: 'v100'
      }
    }
  }
};

function App() {
  const [cluster, setCluster] = useState('greatlakes');
  const [jobType, setJobType] = useState('standard');
  const [partition, setPartition] = useState('standard');
  const [cores, setCores] = useState(1);
  const [memory, setMemory] = useState(7);
  const [gpus, setGpus] = useState(0);
  const [gpuType, setGpuType] = useState('');
  const [days, setDays] = useState(0);
  const [hours, setHours] = useState(1);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [isArrayJob, setIsArrayJob] = useState(false);
  const [arrayJobCount, setArrayJobCount] = useState(1);
  const [showSbatch, setShowSbatch] = useState(false);
  const [showSbatchImport, setShowSbatchImport] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [sbatchHeaderInput, setSbatchHeaderInput] = useState('');
  const [sbatchImportFeedback, setSbatchImportFeedback] = useState(null);
  const isApplyingSbatchImportRef = useRef(false);
  const sbatchRef = useRef(null);

  // Initialize theme from localStorage
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    setIsDarkMode(shouldUseDark);
    document.documentElement.setAttribute('data-theme', shouldUseDark ? 'dark' : 'light');
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    const newTheme = !isDarkMode;
    setIsDarkMode(newTheme);
    const themeValue = newTheme ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', themeValue);
    localStorage.setItem('theme', themeValue);
  };

  // Handle SLURM script toggle with smooth scrolling
  const handleSbatchToggle = () => {
    const newShowSbatch = !showSbatch;
    setShowSbatch(newShowSbatch);
    
    // If expanding the script, scroll to it after a short delay to allow for expansion animation
    if (newShowSbatch && sbatchRef.current) {
      setTimeout(() => {
        sbatchRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
          inline: 'nearest'
        });
      }, 150); // Wait for expansion to start
    }
  };

  // Handle copy to clipboard with feedback
  const handleCopyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generateSbatchScript());
      setIsCopied(true);
      // Reset the copied state after 2 seconds
      setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const handleLoadSbatchExample = () => {
    setSbatchHeaderInput(EXAMPLE_SBATCH_HEADER);
    setSbatchImportFeedback(null);
  };

  const handleClusterChange = (e) => {
    const nextCluster = e.target.value;
    setCluster(nextCluster);
    setPartition('standard');
    setGpuType('');
  };

  const applyParsedSbatchHeader = () => {
    const parsed = parseSbatchHeader(sbatchHeaderInput);
    const errors = [];
    const warnings = [];
    const applied = [];

    if (!parsed.sbatchLineCount) {
      setSbatchImportFeedback({
        status: 'error',
        errors: ['No SBATCH directives found. Paste header lines that begin with #SBATCH.'],
        warnings: [],
        applied: [],
        ignoredDirectives: parsed.ignoredDirectives,
        nonSbatchLineCount: parsed.nonSbatchLineCount
      });
      return;
    }

    const directives = parsed.directives;
    const partitionDirective = directives.partition;
    const timeDirective = directives.time;

    const nodesDirective = directives.nodes;
    const ntasksDirective = directives.ntasks;
    const ntasksPerNodeDirective = directives['ntasks-per-node'];
    const ntasksPerGpuDirective = directives['ntasks-per-gpu'];

    const cpusPerTaskDirective = directives['cpus-per-task'];
    const cpusPerGpuDirective = directives['cpus-per-gpu'];

    const gpusDirective = directives.gpus;
    const gpusPerNodeDirective = directives['gpus-per-node'];
    const gpusPerTaskDirective = directives['gpus-per-task'];

    const memDirective = directives.mem;
    const memPerCpuDirective = directives['mem-per-cpu'];
    const memPerGpuDirective = directives['mem-per-gpu'];

    if (!timeDirective) {
      errors.push('Missing required directive: --time');
    }

    if (!cpusPerTaskDirective && !ntasksDirective && !cpusPerGpuDirective && !ntasksPerNodeDirective && !ntasksPerGpuDirective) {
      errors.push('Missing required CPU/task directives: provide one of --ntasks, --ntasks-per-node, --ntasks-per-gpu, --cpus-per-task, or --cpus-per-gpu.');
    }

    if (!memDirective && !memPerCpuDirective && !memPerGpuDirective) {
      errors.push('Missing required memory directive: provide --mem, --mem-per-cpu, or --mem-per-gpu.');
    }

    const resolvedPartition = partitionDirective
      ? resolvePartition(partitionDirective, CLUSTER_CONFIG, cluster, PARTITION_RATES)
      : { clusterKey: cluster, partitionKey: 'standard' };
    if (partitionDirective && !resolvedPartition) {
      errors.push(`Unable to map partition "${partitionDirective}" to a supported partition in this app.`);
    }

    const parsedSeconds = timeDirective ? parseTimeDirectiveToSeconds(timeDirective) : null;
    if (timeDirective && parsedSeconds === null) {
      errors.push('Unable to parse --time. Supported formats: minutes, MM:SS, HH:MM:SS, D-HH:MM:SS.');
    }

    const nodesInfo = nodesDirective ? parseNodesMinCount(nodesDirective) : null;
    if (nodesDirective && !nodesInfo) {
      errors.push('Invalid --nodes value. Supported examples: 1, 2-4, 1-8:2, or comma lists.');
    }
    if (nodesInfo?.isApproximate) {
      warnings.push('Using minimum node count from --nodes range/list for estimation.');
    }
    const nodeCount = nodesInfo?.count || null;

    const arrayDirective = directives.array;
    const parsedArrayCount = arrayDirective ? parseArrayTaskCount(arrayDirective) : null;
    if (arrayDirective && parsedArrayCount === null) {
      errors.push('Unable to parse --array value. Use forms like 1-100, 0-31, 1,3,5, or 1-100:2.');
    }

    const parsedGpus = gpusDirective ? parseGpuCountSpec(gpusDirective) : null;
    if (gpusDirective && parsedGpus === null) {
      errors.push('Invalid --gpus value. Use [type:]count (for example, 2 or a100:2).');
    }

    const parsedGpusPerNode = gpusPerNodeDirective ? parseGpuCountSpec(gpusPerNodeDirective) : null;
    if (gpusPerNodeDirective && parsedGpusPerNode === null) {
      errors.push('Invalid --gpus-per-node value. Use [type:]count.');
    }

    const parsedGpusPerTask = gpusPerTaskDirective ? parseGpuCountSpec(gpusPerTaskDirective) : null;
    if (gpusPerTaskDirective && parsedGpusPerTask === null) {
      errors.push('Invalid --gpus-per-task value. Use [type:]count.');
    }

    const gresParseResult = parseGres(directives.gres);
    if (directives.gres && gresParseResult.gpus === null && !parsedGpus) {
      warnings.push('Found --gres but could not parse GPU count from it.');
    }

    const ntasks = ntasksDirective ? parsePositiveInteger(ntasksDirective) : null;
    const ntasksPerNode = ntasksPerNodeDirective ? parsePositiveInteger(ntasksPerNodeDirective) : null;
    const ntasksPerGpu = ntasksPerGpuDirective ? parsePositiveInteger(ntasksPerGpuDirective) : null;
    if (ntasksDirective && ntasks === null) {
      errors.push('Invalid --ntasks value. It must be a positive integer.');
    }
    if (ntasksPerNodeDirective && ntasksPerNode === null) {
      errors.push('Invalid --ntasks-per-node value. It must be a positive integer.');
    }
    if (ntasksPerGpuDirective && ntasksPerGpu === null) {
      errors.push('Invalid --ntasks-per-gpu value. It must be a positive integer.');
    }

    let gpuCountFromHeader = parsedGpus || gresParseResult.gpus || null;
    if (gpuCountFromHeader === null && parsedGpusPerNode !== null && nodeCount !== null) {
      gpuCountFromHeader = parsedGpusPerNode * nodeCount;
      warnings.push('Computed total GPUs from --gpus-per-node multiplied by parsed node count.');
    }

    let taskCountFromHeader = ntasks || null;
    if (taskCountFromHeader === null && ntasksPerNode !== null && nodeCount !== null) {
      taskCountFromHeader = ntasksPerNode * nodeCount;
      warnings.push('Computed total tasks from --ntasks-per-node multiplied by parsed node count.');
    }

    if (taskCountFromHeader === null && ntasksPerGpu !== null && gpuCountFromHeader !== null) {
      taskCountFromHeader = ntasksPerGpu * gpuCountFromHeader;
      warnings.push('Computed total tasks from --ntasks-per-gpu multiplied by parsed GPU count.');
    }

    if (gpuCountFromHeader === null && parsedGpusPerTask !== null && taskCountFromHeader !== null) {
      gpuCountFromHeader = parsedGpusPerTask * taskCountFromHeader;
      warnings.push('Computed total GPUs from --gpus-per-task multiplied by parsed task count.');
    }

    if (gpuCountFromHeader === null && ntasks !== null && ntasksPerGpu !== null) {
      gpuCountFromHeader = Math.ceil(ntasks / ntasksPerGpu);
      warnings.push('Computed total GPUs from --ntasks divided by --ntasks-per-gpu (rounded up).');
    }

    const cpusPerTask = cpusPerTaskDirective ? parsePositiveInteger(cpusPerTaskDirective) : null;
    const cpusPerGpu = cpusPerGpuDirective ? parsePositiveInteger(cpusPerGpuDirective) : null;
    if (cpusPerTaskDirective && cpusPerTask === null) {
      errors.push('Invalid --cpus-per-task value. It must be a positive integer.');
    }
    if (cpusPerGpuDirective && cpusPerGpu === null) {
      errors.push('Invalid --cpus-per-gpu value. It must be a positive integer.');
    }

    let totalCoresFromHeader = null;
    if (cpusPerTask !== null) {
      if (taskCountFromHeader === null) {
        taskCountFromHeader = 1;
        warnings.push('No task-count directive found; assuming one task for --cpus-per-task.');
      }
      totalCoresFromHeader = cpusPerTask * taskCountFromHeader;
      if (cpusPerGpu) {
        warnings.push('Using --cpus-per-task/--ntasks for CPU total; --cpus-per-gpu was ignored.');
      }
    } else if (taskCountFromHeader !== null) {
      totalCoresFromHeader = taskCountFromHeader;
      if (!cpusPerGpu && !cpusPerTaskDirective) {
        warnings.push('Assuming one CPU per task because --cpus-per-task was not provided.');
      }
    } else if (cpusPerGpu) {
      if (gpuCountFromHeader !== null && gpuCountFromHeader > 0) {
        totalCoresFromHeader = cpusPerGpu * gpuCountFromHeader;
        warnings.push('Computed CPU cores from --cpus-per-gpu multiplied by parsed GPU count.');
      } else {
        errors.push('Cannot apply --cpus-per-gpu without a GPU count from --gpus or --gres.');
      }
    }

    const parsedMemGb = memDirective ? parseMemoryDirectiveToGb(memDirective) : null;
    if (memDirective && parsedMemGb === null) {
      errors.push('Invalid --mem value. Use a number with optional K/M/G/T/P suffix.');
    }

    const parsedMemPerCpuGb = memPerCpuDirective ? parseMemoryDirectiveToGb(memPerCpuDirective) : null;
    if (memPerCpuDirective && parsedMemPerCpuGb === null) {
      errors.push('Invalid --mem-per-cpu value. Use a number with optional K/M/G/T/P suffix.');
    }

    const parsedMemPerGpuGb = memPerGpuDirective ? parseMemoryDirectiveToGb(memPerGpuDirective) : null;
    if (memPerGpuDirective && parsedMemPerGpuGb === null) {
      errors.push('Invalid --mem-per-gpu value. Use a number with optional K/M/G/T/P suffix.');
    }

    let finalMemGb = null;
    if (parsedMemGb !== null) {
      finalMemGb = parsedMemGb;
      if (memPerCpuDirective || memPerGpuDirective) {
        warnings.push('Multiple memory directives were provided; using --mem for total memory.');
      }
    } else if (parsedMemPerCpuGb !== null && totalCoresFromHeader !== null) {
      finalMemGb = parsedMemPerCpuGb * totalCoresFromHeader;
      warnings.push('Computed total memory from --mem-per-cpu multiplied by parsed CPU count.');
      if (memPerGpuDirective) {
        warnings.push('Using --mem-per-cpu for memory total; --mem-per-gpu was ignored.');
      }
    } else if (parsedMemPerGpuGb !== null && gpuCountFromHeader !== null) {
      finalMemGb = parsedMemPerGpuGb * gpuCountFromHeader;
      warnings.push('Computed total memory from --mem-per-gpu multiplied by parsed GPU count.');
    } else if (parsedMemPerCpuGb !== null && totalCoresFromHeader === null) {
      errors.push('Cannot apply --mem-per-cpu without parsed CPU directives.');
    } else if (parsedMemPerGpuGb !== null && gpuCountFromHeader === null) {
      errors.push('Cannot apply --mem-per-gpu without a parsed GPU count.');
    }

    if (errors.length > 0) {
      setSbatchImportFeedback({
        status: 'error',
        errors,
        warnings,
        applied,
        ignoredDirectives: parsed.ignoredDirectives,
        nonSbatchLineCount: parsed.nonSbatchLineCount
      });
      return;
    }

    isApplyingSbatchImportRef.current = true;

    const nextCluster = resolvedPartition.clusterKey;
    const nextPartition = resolvedPartition.partitionKey;
    if (!partitionDirective) {
      warnings.push('No --partition directive found; defaulting to standard partition.');
    }
    if (nextCluster !== cluster) {
      setCluster(nextCluster);
      warnings.push(`Switched cluster to ${CLUSTER_CONFIG[nextCluster].label} to match parsed partition.`);
      applied.push(`Cluster: ${CLUSTER_CONFIG[nextCluster].label}`);
    }

    setPartition(nextPartition);
    applied.push(`Partition: ${CLUSTER_CONFIG[nextCluster].partitions[nextPartition].name}`);

    const nextCores = Math.max(1, totalCoresFromHeader);
    setCores(nextCores);
    applied.push(`CPU cores: ${nextCores}`);

    const nextMemoryGb = Math.max(1, Math.ceil(finalMemGb));
    setMemory(nextMemoryGb);
    applied.push(`Memory: ${nextMemoryGb} GB`);

    const normalizedSeconds = Math.max(0, Math.floor(parsedSeconds));
    const nextDays = Math.floor(normalizedSeconds / (24 * 3600));
    const remAfterDays = normalizedSeconds % (24 * 3600);
    const nextHours = Math.floor(remAfterDays / 3600);
    const remAfterHours = remAfterDays % 3600;
    const nextMinutes = Math.floor(remAfterHours / 60);
    const nextSeconds = remAfterHours % 60;
    setDays(nextDays);
    setHours(nextHours);
    setMinutes(nextMinutes);
    setSeconds(nextSeconds);
    applied.push(`Runtime: ${timeDirective}`);

    const nextPartitionData = CLUSTER_CONFIG[nextCluster].partitions[nextPartition];
    const gpuCount = gpuCountFromHeader || 0;
    if (!nextPartitionData.hasGPU && gpuCount > 0) {
      warnings.push(`GPU directives requested ${gpuCount} GPU(s), but ${nextPartitionData.name} is not a GPU-capable partition. Remove GPU directives or switch to a GPU partition.`);
    }

    setGpus(gpuCount);
    if (gpuCount > 0) {
      applied.push(`GPUs: ${gpuCount}`);
    }

    if (nextCluster === 'armis2' && nextPartition === 'gpu' && gresParseResult.gpuType) {
      const isSupportedGpuType = ['v100', 'titanv'].includes(gresParseResult.gpuType);
      if (isSupportedGpuType) {
        setGpuType(gresParseResult.gpuType);
        applied.push(`GPU type: ${gresParseResult.gpuType}`);
      } else {
        warnings.push(`Parsed GPU type "${gresParseResult.gpuType}" is not selectable in this calculator.`);
      }
    }

    if (parsedArrayCount) {
      setJobType('array');
      setArrayJobCount(parsedArrayCount);
      setIsArrayJob(true);
      applied.push(`Array tasks: ${parsedArrayCount}`);
      if (arrayDirective.includes('%')) {
        warnings.push('Array throttle (e.g., %10) was ignored for cost because it limits concurrency, not task count.');
      }
    } else {
      const inferredJobType = nextCores > 1 ? 'multicore' : 'standard';
      setJobType(inferredJobType);
      setIsArrayJob(false);
      setArrayJobCount(1);
      applied.push(`Job type: ${inferredJobType === 'multicore' ? 'Multicore' : 'Single Core'}`);
    }

    if (parsed.nonSbatchLineCount > 0) {
      warnings.push(`Ignored ${parsed.nonSbatchLineCount} non-SBATCH line(s).`);
    }
    if (parsed.ignoredDirectives.length > 0) {
      warnings.push(`Ignored ${parsed.ignoredDirectives.length} unsupported SBATCH directive(s).`);
    }

    setSbatchImportFeedback({
      status: 'success',
      errors: [],
      warnings,
      applied,
      ignoredDirectives: parsed.ignoredDirectives,
      nonSbatchLineCount: parsed.nonSbatchLineCount
    });
  };

  // Helper function to check if a value is empty or invalid
  const isValueEmpty = (value) => value === '' || value === null || value === undefined || isNaN(value);

  // Helper function to check if a value is out of range
  const isValueOutOfRange = (value, min, max) => {
    if (isValueEmpty(value)) return false;
    const numValue = Number(value);
    return numValue < min || numValue > max;
  };

  // Helper to get current cluster and partition data
  const currentCluster = CLUSTER_CONFIG[cluster];
  const PARTITION_RATES = currentCluster.partitions;

  // Helper function to get the maximum cores for the current partition
  const getMaxCores = () => {
    const p = PARTITION_RATES[partition];
    if (cluster === 'armis2' && partition === 'gpu' && p.gpuTypes && gpuType && p.gpuTypes[gpuType]) {
      return p.gpuTypes[gpuType].maxCores;
    }
    return p.maxCores;
  };

  // Helper function to get the maximum memory for the current partition
  const getMaxMemory = () => {
    const p = PARTITION_RATES[partition];
    if (cluster === 'armis2' && partition === 'gpu' && p.gpuTypes && gpuType && p.gpuTypes[gpuType]) {
      return p.gpuTypes[gpuType].maxMemory;
    }
    return p.maxMemory;
  };

  // Helper function to handle input changes that allow empty values and out-of-range values
  const handleInputChange = (setter, minValue = 0, maxValue = Infinity) => (e) => {
    const value = e.target.value;
    if (value === '') {
      setter('');
    } else {
      const numValue = parseInt(value);
      if (!isNaN(numValue)) {
        // Allow the value to be set even if out of range, so warnings can be shown
        setter(numValue);
      }
    }
  };

  // Helper function to validate total runtime doesn't exceed partition limits
  const validateTotalRuntime = (newDays, newHours, newMinutes, newSeconds) => {
    const totalMinutes = newDays * 24 * 60 + newHours * 60 + newMinutes + newSeconds / 60;
    
    // Get max runtime based on partition
    let maxMinutes;
    if (partition === 'debug') {
      maxMinutes = 4 * 60; // 4 hours
    } else if (partition === 'viz') {
      maxMinutes = 2 * 60; // 2 hours
    } else {
      maxMinutes = 14 * 24 * 60; // 14 days for all other partitions
    }
    
    return totalMinutes <= maxMinutes;
  };

  // Special handler for time inputs that allows out-of-range values for warnings
  const handleTimeInputChange = (setter, currentState, field) => (e) => {
    const value = e.target.value;
    if (value === '') {
      setter('');
      return;
    }
    
    const numValue = parseInt(value);
    if (isNaN(numValue) || numValue < 0) return;
    
    // Allow the value to be set regardless of 14-day limit for warning display
    setter(numValue);
  };

  // Helper function to handle input focus and select text
  const handleInputFocus = (e) => {
    e.target.select();
  };

  // Helper function to prevent scroll wheel from changing number inputs
  const handleInputWheel = (e) => {
    e.target.blur();
  };

  // Update default values when partition changes
  useEffect(() => {
    if (isApplyingSbatchImportRef.current) {
      isApplyingSbatchImportRef.current = false;
      return;
    }

    const partitionData = PARTITION_RATES[partition];
    const defaultCores = jobType === 'standard' ? 1 : partitionData.defaultCores;
    setCores(defaultCores);
    setMemory(Math.round(defaultCores * partitionData.defaultMemoryPerCore));
    setGpus(partitionData.hasGPU ? 1 : 0);
    if (cluster === 'armis2' && partition === 'gpu' && partitionData.defaultGpuType) {
      setGpuType(partitionData.defaultGpuType);
    } else {
      setGpuType('');
    }
  }, [partition, jobType, cluster]);

  // Update job configuration when job type changes
  useEffect(() => {
    if (jobType === 'array') {
      setIsArrayJob(true);
    } else {
      setIsArrayJob(false);
      setArrayJobCount(1);
    }
  }, [jobType]);

  // Calculate total runtime in minutes with safe defaults and clamping for calculations
  const safeValue = (value, defaultValue) => isValueEmpty(value) ? defaultValue : value;
  const clampedCores = Math.max(1, Math.min(getMaxCores(), safeValue(cores, 1)));
  const clampedMemory = Math.max(1, Math.min(getMaxMemory(), safeValue(memory, 1)));
  const clampedGpus = Math.max(0, Math.min(5, safeValue(gpus, 0)));
  const rawDays = safeValue(days, 0);
  const rawHours = safeValue(hours, 0);
  const rawMinutes = safeValue(minutes, 0);
  const rawSeconds = safeValue(seconds, 0);
  const safeArrayJobCount = Math.max(1, safeValue(arrayJobCount, 1));
  
  // Calculate total minutes from raw input
  const totalMinutes = rawDays * 24 * 60 + rawHours * 60 + rawMinutes + rawSeconds / 60;
  
  // Get max runtime based on partition
  let maxMinutes;
  if (partition === 'debug') {
    maxMinutes = 4 * 60; // 4 hours
  } else if (partition === 'viz') {
    maxMinutes = 2 * 60; // 2 hours
  } else {
    maxMinutes = 14 * 24 * 60; // 14 days for all other partitions
  }
  
  // Clamp total runtime to partition maximum for calculations
  const clampedTotalMinutes = Math.min(totalMinutes, maxMinutes);

  // Check if runtime exceeds partition limit
  const exceedsMaxRuntime = totalMinutes > maxMinutes;

  // Calculate cost using TRES billing weights
  const calculateCost = () => {
  const partitionData = PARTITION_RATES[partition];
    
    // Calculate billing using TRES formula with clamped values:
    // billing = int(max(cpu_weight * cpus, mem_weight * mem_gb, gpu_weight * gpus))
    const cpuBilling = partitionData.billing.cpu_weight * clampedCores;
    const memBilling = partitionData.billing.mem_weight * clampedMemory;
    const gpuBilling = partitionData.billing.gpu_weight * clampedGpus;
    
    const billing = Math.floor(Math.max(cpuBilling, memBilling, gpuBilling));
    
    // Calculate cost: cost = (total_minutes * billing) / 10000000
    const baseCost = (clampedTotalMinutes * billing) / 10000000;
    const totalCost = baseCost * (jobType === 'array' ? safeArrayJobCount : 1);

    return {
      total: totalCost,
      billing: billing,
      cpuBilling: cpuBilling,
      memBilling: memBilling,
      gpuBilling: gpuBilling,
      dominantFactor: billing === cpuBilling ? 'CPU' : billing === memBilling ? 'Memory' : 'GPU',
      arrayMultiplier: jobType === 'array' ? safeArrayJobCount : 1
    };
  };

  const cost = calculateCost();
  const currentPartition = PARTITION_RATES[partition];

  const formatTime = () => {
    // Use clamped values for display in cost breakdown
    const clampedDays = Math.floor(clampedTotalMinutes / (24 * 60));
    const remainingMinutes = clampedTotalMinutes % (24 * 60);
    const clampedHours = Math.floor(remainingMinutes / 60);
    const clampedMins = Math.floor(remainingMinutes % 60);
    const clampedSecs = Math.floor((clampedTotalMinutes % 1) * 60);
    
    const parts = [];
    if (clampedDays > 0) parts.push(`${clampedDays}d`);
    if (clampedHours > 0) parts.push(`${clampedHours}h`);
    if (clampedMins > 0) parts.push(`${clampedMins}m`);
    if (clampedSecs > 0) parts.push(`${clampedSecs}s`);
    return parts.join(' ') || '0m';
  };

  const generateSbatchScript = () => {
    const formatTimeForSlurm = () => {
      // Use clamped values for SLURM script
      const clampedDays = Math.floor(clampedTotalMinutes / (24 * 60));
      const remainingMinutes = clampedTotalMinutes % (24 * 60);
      const clampedHours = Math.floor(remainingMinutes / 60);
      const clampedMins = Math.floor(remainingMinutes % 60);
      const clampedSecs = Math.floor((clampedTotalMinutes % 1) * 60);
      
      // Format as days-hours:minutes:seconds for SLURM
      if (clampedDays > 0) {
        return `${clampedDays}-${clampedHours.toString().padStart(2, '0')}:${clampedMins.toString().padStart(2, '0')}:${clampedSecs.toString().padStart(2, '0')}`;
      } else {
        return `${clampedHours.toString().padStart(2, '0')}:${clampedMins.toString().padStart(2, '0')}:${clampedSecs.toString().padStart(2, '0')}`;
      }
    };

    const memoryPerNode = jobType === 'multicore' ? clampedMemory : Math.ceil(clampedMemory / clampedCores) * clampedCores;
    
    let script = '#!/bin/bash\n';
    script += `#SBATCH --job-name=${jobType === 'standard' ? 'single-core' : jobType}-job\n`;
    script += `#SBATCH --partition=${partition}\n`;
    
    if (jobType === 'array') {
      // Array jobs should not have --nodes or --ntasks
      // --cpus-per-task should equal the number of CPUs requested
      script += `#SBATCH --cpus-per-task=${clampedCores}\n`;
    } else if (jobType === 'multicore') {
      script += `#SBATCH --nodes=1\n`;
      script += `#SBATCH --ntasks=1\n`;
      script += `#SBATCH --cpus-per-task=${clampedCores}\n`;
    } else {
      script += `#SBATCH --nodes=1\n`;
      script += `#SBATCH --ntasks=${clampedCores}\n`;
      script += `#SBATCH --cpus-per-task=1\n`;
    }
    
    script += `#SBATCH --mem=${memoryPerNode}G\n`;
    script += `#SBATCH --time=${formatTimeForSlurm()}\n`;
    
    if (currentPartition.hasGPU && clampedGpus > 0) {
      if (cluster === 'armis2' && partition === 'gpu' && gpuType) {
        script += `#SBATCH --gres=gpu:${gpuType}:${clampedGpus}\n`;
      } else {
        script += `#SBATCH --gres=gpu:${clampedGpus}\n`;
      }
    }
    
    if (jobType === 'array') {
      script += `#SBATCH --array=1-${safeArrayJobCount}\n`;
    }
    
    script += '#SBATCH --account=YOUR_ACCOUNT\n';
    script += '#SBATCH --mail-type=BEGIN,END,FAIL\n';
    script += '#SBATCH --mail-user=YOUR_EMAIL@umich.edu\n';
    script += '\n';
    script += '# Load necessary modules\n';
    script += '# module load python/3.9.0\n';
    script += '# module load gcc/9.2.0\n';
    script += '\n';
    
    if (jobType === 'multicore') {
      script += '# Run multicore job (shared memory)\n';
      script += 'your_multicore_program\n';
    } else if (jobType === 'array') {
      script += '# Run array job\n';
      script += 'echo "Array job ID: $SLURM_ARRAY_TASK_ID"\n';
      script += 'your_program --input-file input_${SLURM_ARRAY_TASK_ID}.txt\n';
    } else {
      script += '# Run single core job\n';
      script += 'your_program\n';
    }
    
    return script;
  };

  return (
    <>
            <div className="top-controls">
        <button 
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${isDarkMode ? 'light' : 'dark'} mode`}
        >
          <svg width="24" height="24" className={`theme-icon ${isDarkMode ? 'sun-icon' : 'moon-icon'}`}>
            {isDarkMode ? (
              // Sun icon for dark mode (click to go to light)
              <>
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="12"
                  y1="2"
                  x2="12"
                  y2="5"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="12"
                  y1="19"
                  x2="12"
                  y2="22"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="4.93"
                  y1="4.93"
                  x2="7.05"
                  y2="7.05"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="16.95"
                  y1="16.95"
                  x2="19.07"
                  y2="19.07"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="2"
                  y1="12"
                  x2="5"
                  y2="12"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="19"
                  y1="12"
                  x2="22"
                  y2="12"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="4.93"
                  y1="19.07"
                  x2="7.05"
                  y2="16.95"
                />
                <line
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  x1="16.95"
                  y1="7.05"
                  x2="19.07"
                  y2="4.93"
                />
              </>
            ) : (
              // Moon icon for light mode (click to go to dark)
              <path
                fill="currentColor"
                d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"
              />
            )}
          </svg>
        </button>
        <a
          href="https://github.com/um-jglad/um-gl-cost-calc"
          target="_blank"
          rel="noopener noreferrer"
          className="github-link"
          aria-label="View source on GitHub"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59
                 .4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49
                 -2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13
                 -.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82
                 .72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07
                 -1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15
                 -.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82
                 .64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27
                 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12
                 .51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95
                 .29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2
                 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8
                 c0-4.42-3.58-8-8-8z"
            />
          </svg>
        </a>
      </div>
      <div className="app">
        <div className="header">
          <h1>UM HPC Cost Calculator</h1>
          <p>Estimate costs for Great Lakes and Armis2 clusters</p>
        </div>

        <div className="calculator">
          <div className="form-section">
            <h3>Job Configuration</h3>
            
            <div className="form-group">
              <label htmlFor="cluster">Cluster</label>
              <select 
                id="cluster"
                value={cluster}
                onChange={handleClusterChange}
              >
                {Object.entries(CLUSTER_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
              <div className="partition-info">
                <p>{cluster === 'greatlakes' ? 'Great Lakes HPC' : 'Armis2 (HIPAA/Export-controlled)'}</p>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="jobType">Job Type</label>
              <select 
                id="jobType"
                value={jobType} 
                onChange={(e) => setJobType(e.target.value)}
              >
                <option value="standard">Single Core Job</option>
                <option value="multicore">Multicore Job</option>
                <option value="array">Array Job</option>
              </select>
              <div className="partition-info">
                <p>
                  {jobType === 'standard' && 'Single core job (1 node, 1 task, 1 core)'}
                  {jobType === 'multicore' && 'Single task job using multiple cores (shared memory)'}
                  {jobType === 'array' && 'Multiple independent jobs with the same resource requirements'}
                </p>
              </div>
            </div>
            
            <div className="form-group">
              <label htmlFor="partition">Partition</label>
              <select 
                id="partition"
                value={partition} 
                onChange={(e) => setPartition(e.target.value)}
              >
                {Object.entries(PARTITION_RATES).map(([key, data]) => (
                  <option key={key} value={key}>{data.name}</option>
                ))}
              </select>
              <div className="partition-info">
                <p>{currentPartition.description}</p>
              </div>
            </div>

            {currentPartition.hasGPU && cluster === 'armis2' && partition === 'gpu' && currentPartition.gpuTypes && (
              <div className="form-group">
                <label htmlFor="gpuType">GPU Type</label>
                <select 
                  id="gpuType"
                  value={gpuType}
                  onChange={(e) => setGpuType(e.target.value)}
                >
                  {Object.entries(currentPartition.gpuTypes).map(([key, t]) => (
                    <option key={key} value={key}>{t.label}</option>
                  ))}
                </select>
                <div className="partition-info">
                  <p>Limits adjust based on GPU type.</p>
                </div>
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="cores">CPU Cores</label>
                <input 
                  type="number" 
                  id="cores"
                  min="1" 
                  max={jobType === 'standard' ? 1 : getMaxCores()}
                  value={cores} 
                  className={isValueEmpty(cores) ? 'warning' : isValueOutOfRange(cores, 1, jobType === 'standard' ? 1 : getMaxCores()) ? 'error' : ''}
                  onChange={handleInputChange(setCores, 1, jobType === 'standard' ? 1 : getMaxCores())}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                  disabled={jobType === 'standard'}
                />
                {jobType === 'standard' && cores > 1 && (
                  <div className="warning-message">
                    ⚠️ Standard jobs are limited to 1 core. Consider switching to "Multicore Job" for multiple cores.
                  </div>
                )}
                {jobType !== 'standard' && isValueOutOfRange(cores, 1, getMaxCores()) && (
                  <div className="warning-message">
                    ⚠️ Value must be between 1 and {getMaxCores()} cores
                  </div>
                )}
              </div>
              <div className="form-group">
                <label htmlFor="memory">Memory (GB)</label>
                <input 
                  type="number" 
                  id="memory"
                  min="1" 
                  max={getMaxMemory()}
                  value={memory} 
                  className={isValueEmpty(memory) ? 'warning' : isValueOutOfRange(memory, 1, getMaxMemory()) ? 'error' : ''}
                  onChange={handleInputChange(setMemory, 1, getMaxMemory())}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
                {isValueOutOfRange(memory, 1, getMaxMemory()) && (
                  <div className="warning-message">
                    ⚠️ Value must be between 1 and {getMaxMemory()} GB
                  </div>
                )}
              </div>
            </div>

            {currentPartition.hasGPU && (
              <div className="form-group">
                <label htmlFor="gpus">GPUs</label>
                <input 
                  type="number" 
                  id="gpus"
                  min="0" 
                  max="5"
                  value={gpus} 
                  className={isValueEmpty(gpus) && currentPartition.hasGPU ? 'warning' : isValueOutOfRange(gpus, 0, 5) ? 'error' : ''}
                  onChange={handleInputChange(setGpus, 0, 5)}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
                {isValueOutOfRange(gpus, 0, 5) && (
                  <div className="warning-message">
                    ⚠️ Value must be between 0 and 5 GPUs
                  </div>
                )}
              </div>
            )}

            <div className="form-group">
              <div className={`collapsible-content ${jobType === 'array' ? 'expanded' : 'collapsed'}`}>
                <div className="array-input-container">
                  <label htmlFor="arrayJobCount">Number of Jobs in Array</label>
                  <input 
                    type="number" 
                    id="arrayJobCount"
                    min="1" 
                    value={arrayJobCount} 
                    className={isValueEmpty(arrayJobCount) ? 'warning' : isValueOutOfRange(arrayJobCount, 1, Infinity) ? 'error' : ''}
                    onChange={handleInputChange(setArrayJobCount, 1)}
                    onFocus={handleInputFocus}
                    onWheel={handleInputWheel}
                    placeholder="Enter number of array jobs"
                  />
                  {isValueOutOfRange(arrayJobCount, 1, Infinity) && (
                    <div className="warning-message">
                      ⚠️ Value must be at least 1
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="form-section">
            <h3>Runtime</h3>
            <div className="time-inputs">
              <div className="form-group">
                <label htmlFor="days">Days</label>
                <input 
                  type="number" 
                  id="days"
                  min="0" 
                  value={days} 
                  className={exceedsMaxRuntime ? 'error' : ''}
                  onChange={handleTimeInputChange(setDays, { days, hours, minutes, seconds }, 'days')}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
              </div>
              <div className="form-group">
                <label htmlFor="hours">Hours</label>
                <input 
                  type="number" 
                  id="hours"
                  min="0" 
                  value={hours} 
                  className={exceedsMaxRuntime ? 'error' : ''}
                  onChange={handleTimeInputChange(setHours, { days, hours, minutes, seconds }, 'hours')}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
              </div>
              <div className="form-group">
                <label htmlFor="minutes">Minutes</label>
                <input 
                  type="number" 
                  id="minutes"
                  min="0" 
                  value={minutes} 
                  className={exceedsMaxRuntime ? 'error' : ''}
                  onChange={handleTimeInputChange(setMinutes, { days, hours, minutes, seconds }, 'minutes')}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
              </div>
              <div className="form-group">
                <label htmlFor="seconds">Seconds</label>
                <input 
                  type="number" 
                  id="seconds"
                  min="0" 
                  value={seconds} 
                  className={exceedsMaxRuntime ? 'error' : ''}
                  onChange={handleTimeInputChange(setSeconds, { days, hours, minutes, seconds }, 'seconds')}
                  onFocus={handleInputFocus}
                  onWheel={handleInputWheel}
                />
              </div>
            </div>
            {exceedsMaxRuntime && (
              <div className="runtime-warning">
                ⚠️ Warning: Runtime exceeds {
                  partition === 'debug' ? '4-hour' : 
                  partition === 'viz' ? '2-hour' : 
                  '14-day'
                } maximum limit for {partition} partition. Please reduce the total runtime.
              </div>
            )}
          </div>

          <div className="form-section">
            <div className="import-header-row">
              <h3>Import Existing Script</h3>
              <button
                type="button"
                className="import-toggle-button"
                onClick={() => setShowSbatchImport(!showSbatchImport)}
              >
                {showSbatchImport ? 'Hide Import Tool' : 'Show Import Tool'}
              </button>
            </div>
            <div className={`collapsible-content ${showSbatchImport ? 'expanded' : 'collapsed'}`}>
              <div className="form-group">
                <label htmlFor="sbatchHeaderInput">Paste existing SBATCH header/directives</label>
                <textarea
                  id="sbatchHeaderInput"
                  className="sbatch-import-input"
                  value={sbatchHeaderInput}
                  onChange={(e) => {
                    setSbatchHeaderInput(e.target.value);
                    if (sbatchImportFeedback) {
                      setSbatchImportFeedback(null);
                    }
                  }}
                  placeholder={'#SBATCH --partition=standard\n#SBATCH --cpus-per-gpu=4\n#SBATCH --gres=gpu:2\n#SBATCH --mem=64G\n#SBATCH --time=02:00:00'}
                />
              </div>
              <div className="import-actions">
                <button
                  type="button"
                  onClick={handleLoadSbatchExample}
                >
                  Load Example Header
                </button>
                <button
                  type="button"
                  onClick={applyParsedSbatchHeader}
                  disabled={!sbatchHeaderInput.trim()}
                >
                  Parse Header
                </button>
              </div>

              {sbatchImportFeedback && (
                <div className="sbatch-import-feedback">
                  <h4>
                    {sbatchImportFeedback.status === 'success' ? 'Import Applied' : 'Import Errors'}
                  </h4>

                  {sbatchImportFeedback.errors.length > 0 && (
                    <div>
                      {sbatchImportFeedback.errors.map((errorText, index) => (
                        <div key={`error-${index}`} className="warning-message">
                          ⚠️ {errorText}
                        </div>
                      ))}
                    </div>
                  )}

                  {sbatchImportFeedback.warnings.length > 0 && (
                    <div className="import-message-group">
                      <h5>Warnings</h5>
                      {sbatchImportFeedback.warnings.map((warningText, index) => (
                        <div key={`warning-${index}`} className="partition-info import-warning-text">
                          {warningText}
                        </div>
                      ))}
                    </div>
                  )}

                  {sbatchImportFeedback.applied.length > 0 && (
                    <div className="import-message-group">
                      <h5>Applied Values</h5>
                      {sbatchImportFeedback.applied.map((appliedText, index) => (
                        <div key={`applied-${index}`} className="partition-info import-applied-text">
                          {appliedText}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="results">
            <h3>Estimated Job Cost</h3>
            <div className="cost-display">
              ${cost.total.toFixed(2)}
            </div>
            
            <div className="cost-breakdown">
              <h4>Cost Breakdown</h4>
              <div className="breakdown-item">
                <span>Job Type:</span>
                <span>{jobType === 'standard' ? 'Single Core' : jobType === 'multicore' ? 'Multicore' : 'Array'}</span>
              </div>
              <div className="breakdown-item">
                <span>Cluster:</span>
                <span>{currentCluster.label}</span>
              </div>
              <div className="breakdown-item">
                <span>Partition:</span>
                <span>{currentPartition.name}</span>
              </div>
              <div className="breakdown-item">
                <span>Runtime:</span>
                <span>{formatTime()}</span>
              </div>
              <div className="breakdown-item">
                <span>Cores:</span>
                <span>{clampedCores}</span>
              </div>
              <div className="breakdown-item">
                <span>Memory:</span>
                <span>{clampedMemory} GB</span>
              </div>
              {currentPartition.hasGPU && (
                <div className="breakdown-item">
                  <span>GPUs:</span>
                  <span>{clampedGpus}</span>
                </div>
              )}
              {jobType === 'array' && (
                <div className="breakdown-item">
                  <span>Array Jobs:</span>
                  <span>{safeArrayJobCount}</span>
                </div>
              )}
              <div className="breakdown-item">
                <span>Total minutes:</span>
                <span>{clampedTotalMinutes.toFixed(2)}</span>
              </div>
              {jobType === 'array' && (
                <div className="breakdown-item">
                  <span>Cost per job:</span>
                  <span>${(cost.total / cost.arrayMultiplier).toFixed(6)}</span>
                </div>
              )}
            </div>
            <p style={{ marginTop: '8px', fontSize: '0.9rem', opacity: '0.9' }}>
              This is the maximum cost estimate. Actual cost may be lower dependent on runtime.
            </p>
            
            <div style={{ marginTop: '16px' }}>
              <button 
                onClick={handleSbatchToggle}
                style={{
                  background: 'var(--toggle-bg)',
                  color: 'var(--results-text)',
                  border: '1px solid var(--toggle-border)',
                  borderRadius: '8px',
                  padding: '8px 16px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--toggle-hover-bg)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--toggle-bg)';
                }}
              >
                {showSbatch ? 'Hide' : 'Show'} SLURM Script
              </button>
            </div>
          </div>

          <div ref={sbatchRef} className={`collapsible-content ${showSbatch ? 'expanded' : 'collapsed'}`}>
            <div className="form-section sbatch-section">
              <h3>Example SLURM Batch Script</h3>
              <div style={{
                background: 'var(--sbatch-bg)',
                color: 'var(--sbatch-text)',
                padding: '16px',
                borderRadius: '8px',
                fontFamily: 'Monaco, Consolas, "Lucida Console", monospace',
                fontSize: '0.85rem',
                lineHeight: '1.4',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                position: 'relative'
              }}>
                <button
                  onClick={handleCopyToClipboard}
                  style={{
                    position: 'absolute',
                    top: '8px',
                    right: '8px',
                    background: isCopied ? 'var(--success-color)' : 'var(--sbatch-button-bg)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    transition: 'background-color 0.2s ease'
                  }}
                >
                  {isCopied ? 'Copied!' : 'Copy'}
                </button>
                {generateSbatchScript()}
              </div>
              <p style={{ marginTop: '12px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Save this as a <code>.sbatch</code> file and submit with: <code>sbatch your_script.sbatch</code>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default App;
