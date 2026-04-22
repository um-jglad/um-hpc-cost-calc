const SUPPORTED_SBATCH_KEYS = new Set([
  'partition',
  'cpus-per-task',
  'cpus-per-gpu',
  'ntasks',
  'nodes',
  'ntasks-per-node',
  'ntasks-per-gpu',
  'time',
  'mem',
  'mem-per-cpu',
  'mem-per-gpu',
  'gres',
  'array',
  'gpus',
  'gpus-per-node',
  'gpus-per-task'
]);

export const EXAMPLE_SBATCH_HEADER = `#SBATCH --job-name=example-job
#SBATCH --partition=standard
#SBATCH --cpus-per-gpu=4
#SBATCH --gres=gpu:2
#SBATCH --mem=64G
#SBATCH --time=02:30:00`;

export const normalizeDirectiveKey = (rawKey) => {
  const key = rawKey.replace(/^--?/, '').trim();
  const isShortOption = /^-[^-]/.test(rawKey);

  if (isShortOption && key.length === 1) {
    const shortAliasMap = {
      p: 'partition',
      c: 'cpus-per-task',
      n: 'ntasks',
      t: 'time',
      g: 'gpus',
      N: 'nodes'
    };
    return shortAliasMap[key] || key.toLowerCase();
  }

  const normalizedKey = key.toLowerCase();
  const aliasMap = {
    p: 'partition',
    c: 'cpus-per-task',
    n: 'ntasks',
    t: 'time',
    g: 'gpus'
  };
  return aliasMap[normalizedKey] || normalizedKey;
};

export const parseGpuCountSpec = (rawValue) => {
  const value = (rawValue || '').trim();
  if (!value) return null;

  const parts = value.split(',').map((token) => token.trim()).filter(Boolean);
  if (!parts.length) return null;

  let total = 0;
  for (const part of parts) {
    const segments = part.split(':').map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) return null;

    const countRaw = segments[segments.length - 1];
    const count = parsePositiveInteger(countRaw);
    if (count === null) return null;
    total += count;
  }

  return total > 0 ? total : null;
};

export const parseNodesMinCount = (rawValue) => {
  const value = (rawValue || '').trim();
  if (!value) return null;

  const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!entries.length) return null;

  let minNodes = Number.POSITIVE_INFINITY;
  let isApproximate = false;

  for (const entry of entries) {
    const normalized = entry.split(':')[0].trim();
    if (!normalized) return null;

    let candidate = null;
    if (/^\d+$/.test(normalized)) {
      candidate = parseInt(normalized, 10);
    } else {
      const range = normalized.match(/^(\d+)\s*-\s*(\d+)$/);
      if (!range) return null;
      candidate = parseInt(range[1], 10);
      isApproximate = true;
    }

    if (!Number.isFinite(candidate) || candidate <= 0) return null;
    minNodes = Math.min(minNodes, candidate);
  }

  if (entries.length > 1) {
    isApproximate = true;
  }

  return {
    count: Number.isFinite(minNodes) ? minNodes : null,
    isApproximate
  };
};

export const parseSbatchHeader = (input) => {
  const lines = input.split('\n');
  const directives = {};
  const ignoredDirectives = [];
  let sbatchLineCount = 0;
  let nonSbatchLineCount = 0;

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    if (!/^#SBATCH\b/i.test(trimmed)) {
      nonSbatchLineCount += 1;
      return;
    }

    sbatchLineCount += 1;
    const directiveBody = trimmed.replace(/^#SBATCH\s*/i, '').trim();
    if (!directiveBody) {
      ignoredDirectives.push('(empty SBATCH directive)');
      return;
    }

    const withoutComment = directiveBody.split(/\s+#/)[0].trim();
    const keyValueMatch = withoutComment.match(/^(-{1,2}[^\s=]+)(?:\s*=\s*|\s+)?(.*)$/);

    if (!keyValueMatch) {
      ignoredDirectives.push(withoutComment);
      return;
    }

    const normalizedKey = normalizeDirectiveKey(keyValueMatch[1]);
    const value = (keyValueMatch[2] || '').trim();

    if (!SUPPORTED_SBATCH_KEYS.has(normalizedKey)) {
      ignoredDirectives.push(withoutComment);
      return;
    }

    directives[normalizedKey] = value;
  });

  return {
    directives,
    ignoredDirectives,
    sbatchLineCount,
    nonSbatchLineCount
  };
};

export const parseTimeDirectiveToSeconds = (timeString) => {
  const value = (timeString || '').trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return parseInt(value, 10) * 60;
  }

  const dayFormat = value.match(/^(\d+)-(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
  if (dayFormat) {
    const dayValue = parseInt(dayFormat[1], 10);
    const hourValue = parseInt(dayFormat[2], 10);
    const minuteValue = parseInt(dayFormat[3], 10);
    const secondValue = parseInt(dayFormat[4], 10);
    if (hourValue > 23 || minuteValue > 59 || secondValue > 59) return null;
    return dayValue * 24 * 3600 + hourValue * 3600 + minuteValue * 60 + secondValue;
  }

  const hmsFormat = value.match(/^(\d{1,3}):(\d{1,2}):(\d{1,2})$/);
  if (hmsFormat) {
    const hourValue = parseInt(hmsFormat[1], 10);
    const minuteValue = parseInt(hmsFormat[2], 10);
    const secondValue = parseInt(hmsFormat[3], 10);
    if (minuteValue > 59 || secondValue > 59) return null;
    return hourValue * 3600 + minuteValue * 60 + secondValue;
  }

  const msFormat = value.match(/^(\d{1,5}):(\d{1,2})$/);
  if (msFormat) {
    const minuteValue = parseInt(msFormat[1], 10);
    const secondValue = parseInt(msFormat[2], 10);
    if (secondValue > 59) return null;
    return minuteValue * 60 + secondValue;
  }

  return null;
};

export const parseMemoryDirectiveToGb = (memoryString) => {
  const value = (memoryString || '').trim();
  const match = value.match(/^(\d+(?:\.\d+)?)([KMGTP]?)(?:i?[bB])?$/i);
  if (!match) return null;

  const numeric = parseFloat(match[1]);
  const unit = (match[2] || '').toUpperCase();
  if (!Number.isFinite(numeric) || numeric <= 0) return null;

  const unitToGb = {
    '': 1 / 1024,
    K: 1 / (1024 * 1024),
    M: 1 / 1024,
    G: 1,
    T: 1024,
    P: 1024 * 1024
  };

  if (unitToGb[unit] === undefined) return null;
  return numeric * unitToGb[unit];
};

export const parsePositiveInteger = (raw) => {
  const num = Number.parseInt((raw || '').trim(), 10);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
};

export const parseArrayTaskCount = (arraySpec) => {
  const spec = (arraySpec || '').split('%')[0].trim();
  if (!spec) return null;

  const segments = spec.split(',').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return null;

  let totalCount = 0;

  for (const segment of segments) {
    if (/^\d+$/.test(segment)) {
      totalCount += 1;
      continue;
    }

    const rangeMatch = segment.match(/^(\d+)-(\d+)(?::(\d+))?$/);
    if (!rangeMatch) return null;

    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);
    const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1;

    if (step <= 0 || end < start) return null;
    totalCount += Math.floor((end - start) / step) + 1;
  }

  return totalCount > 0 ? totalCount : null;
};

export const resolvePartition = (partitionValue, clusterConfig, currentClusterKey, currentPartitions) => {
  const requested = (partitionValue || '').trim().toLowerCase();
  if (!requested) return null;

  const directInCurrent = currentPartitions[requested] ? { clusterKey: currentClusterKey, partitionKey: requested } : null;
  if (directInCurrent) return directInCurrent;

  const byNameInCurrent = Object.entries(currentPartitions).find(([, data]) => data.name.toLowerCase() === requested);
  if (byNameInCurrent) {
    return { clusterKey: currentClusterKey, partitionKey: byNameInCurrent[0] };
  }

  const matchesAcrossClusters = [];
  Object.entries(clusterConfig).forEach(([clusterKey, config]) => {
    Object.entries(config.partitions).forEach(([partitionKey, data]) => {
      if (partitionKey.toLowerCase() === requested || data.name.toLowerCase() === requested) {
        matchesAcrossClusters.push({ clusterKey, partitionKey });
      }
    });
  });

  if (matchesAcrossClusters.length === 1) return matchesAcrossClusters[0];
  return null;
};

export const parseGres = (gresValue) => {
  const value = (gresValue || '').trim();
  if (!value) return { gpus: null, gpuType: '' };

  const gpuClause = value
    .split(',')
    .map((entry) => entry.trim())
    .find((entry) => /^gpu(?::|$)/i.test(entry));

  if (!gpuClause) return { gpus: null, gpuType: '' };

  const parts = gpuClause.split(':');
  let parsedGpuCount = null;
  let parsedGpuType = '';

  if (parts.length === 2) {
    parsedGpuCount = parsePositiveInteger(parts[1]);
  }

  if (parts.length >= 3) {
    parsedGpuType = parts[1].toLowerCase();
    parsedGpuCount = parsePositiveInteger(parts[2]);
  }

  return { gpus: parsedGpuCount, gpuType: parsedGpuType };
};
