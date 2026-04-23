import { describe, expect, it } from 'vitest';
import {
  hasGpuRequestInDirectives,
  parseArrayTaskCount,
  parseGres,
  parseGpuCountSpec,
  parseMemoryDirectiveToGb,
  parseNodesMinCount,
  parseSbatchHeader,
  parseTimeDirectiveToSeconds,
  resolvePartition
} from './sbatchParser';

describe('parseSbatchHeader', () => {
  it('extracts supported SBATCH directives and ignores unrelated lines', () => {
    const input = `#!/bin/bash
# comment
#SBATCH --partition=standard
module load python
#SBATCH --time=01:30:00
#SBATCH --cpus-per-task 4
#SBATCH --cpus-per-gpu=2
#SBATCH -N 2-4
#SBATCH --gpus-per-node=a100:2`;

    const parsed = parseSbatchHeader(input);

  expect(parsed.sbatchLineCount).toBe(6);
    expect(parsed.nonSbatchLineCount).toBe(3);
    expect(parsed.directives.partition).toBe('standard');
    expect(parsed.directives.time).toBe('01:30:00');
    expect(parsed.directives['cpus-per-task']).toBe('4');
    expect(parsed.directives['cpus-per-gpu']).toBe('2');
  expect(parsed.directives.nodes).toBe('2-4');
  expect(parsed.directives['gpus-per-node']).toBe('a100:2');
  });

  it('tracks unsupported SBATCH directives as ignored', () => {
    const parsed = parseSbatchHeader('#SBATCH --mail-type=END\n#SBATCH --partition=debug');

    expect(parsed.directives.partition).toBe('debug');
    expect(parsed.ignoredDirectives.length).toBe(1);
    expect(parsed.ignoredDirectives[0]).toContain('--mail-type=END');
  });
});

describe('parseTimeDirectiveToSeconds', () => {
  it('parses D-HH:MM:SS format', () => {
    expect(parseTimeDirectiveToSeconds('2-03:04:05')).toBe(183845);
  });

  it('parses HH:MM:SS format', () => {
    expect(parseTimeDirectiveToSeconds('10:30:15')).toBe(37815);
  });

  it('parses MM:SS format', () => {
    expect(parseTimeDirectiveToSeconds('90:10')).toBe(5410);
  });

  it('treats plain integers as minutes', () => {
    expect(parseTimeDirectiveToSeconds('120')).toBe(7200);
  });

  it('rejects invalid time values', () => {
    expect(parseTimeDirectiveToSeconds('1-25:00:00')).toBeNull();
    expect(parseTimeDirectiveToSeconds('12:70:00')).toBeNull();
  });
});

describe('parseMemoryDirectiveToGb', () => {
  it('parses gigabytes and mebibytes-like suffixes', () => {
    expect(parseMemoryDirectiveToGb('64G')).toBe(64);
    expect(parseMemoryDirectiveToGb('1024M')).toBe(1);
  });

  it('rejects malformed memory values', () => {
    expect(parseMemoryDirectiveToGb('foo')).toBeNull();
    expect(parseMemoryDirectiveToGb('-1G')).toBeNull();
  });
});

describe('parseArrayTaskCount', () => {
  it('parses ranges and list combinations', () => {
    expect(parseArrayTaskCount('1-10')).toBe(10);
    expect(parseArrayTaskCount('1-9:2')).toBe(5);
    expect(parseArrayTaskCount('1,3,5,7')).toBe(4);
    expect(parseArrayTaskCount('1-100%10')).toBe(100);
  });

  it('rejects invalid array specs', () => {
    expect(parseArrayTaskCount('10-1')).toBeNull();
    expect(parseArrayTaskCount('1-10:0')).toBeNull();
    expect(parseArrayTaskCount('a-b')).toBeNull();
  });
});

describe('parseGres', () => {
  it('extracts gpu count and optional type', () => {
    expect(parseGres('gpu:2')).toEqual({ gpus: 2, gpuType: '' });
    expect(parseGres('gpu:v100:1')).toEqual({ gpus: 1, gpuType: 'v100' });
    expect(parseGres('nvme:20g,gpu:titanv:3')).toEqual({ gpus: 3, gpuType: 'titanv' });
  });
});

describe('hasGpuRequestInDirectives', () => {
  it('returns true for gpu request directives', () => {
    expect(hasGpuRequestInDirectives({ gpus: '2' })).toBe(true);
    expect(hasGpuRequestInDirectives({ 'gpus-per-node': 'a100:2' })).toBe(true);
    expect(hasGpuRequestInDirectives({ 'ntasks-per-gpu': '4' })).toBe(true);
    expect(hasGpuRequestInDirectives({ gres: 'nvme:20g,gpu:v100:1' })).toBe(true);
  });

  it('returns false when gpu directives are absent', () => {
    expect(hasGpuRequestInDirectives({ partition: 'standard', time: '01:00:00' })).toBe(false);
    expect(hasGpuRequestInDirectives({ gres: 'nvme:20g' })).toBe(false);
  });
});

describe('parseGpuCountSpec', () => {
  it('parses typed and untyped gpu count formats', () => {
    expect(parseGpuCountSpec('2')).toBe(2);
    expect(parseGpuCountSpec('a100:2')).toBe(2);
    expect(parseGpuCountSpec('a100:2,v100:1')).toBe(3);
  });

  it('returns null for invalid gpu count formats', () => {
    expect(parseGpuCountSpec('')).toBeNull();
    expect(parseGpuCountSpec('a100')).toBeNull();
    expect(parseGpuCountSpec('gpu:x')).toBeNull();
  });
});

describe('parseNodesMinCount', () => {
  it('parses fixed and ranged node values', () => {
    expect(parseNodesMinCount('3')).toEqual({ count: 3, isApproximate: false });
    expect(parseNodesMinCount('2-5')).toEqual({ count: 2, isApproximate: true });
    expect(parseNodesMinCount('1-9:2')).toEqual({ count: 1, isApproximate: true });
  });

  it('returns null for invalid nodes values', () => {
    expect(parseNodesMinCount('foo')).toBeNull();
    expect(parseNodesMinCount('0')).toBeNull();
  });
});

describe('resolvePartition', () => {
  const clusterConfig = {
    greatlakes: {
      partitions: {
        standard: { name: 'Standard' },
        gpu_mig40: { name: 'MIG40 GPU' }
      }
    },
    armis2: {
      partitions: {
        gpu: { name: 'GPU' },
        debug: { name: 'Debug' }
      }
    }
  };

  it('finds partition in current cluster by key', () => {
    const result = resolvePartition('standard', clusterConfig, 'greatlakes', clusterConfig.greatlakes.partitions);
    expect(result).toEqual({ clusterKey: 'greatlakes', partitionKey: 'standard' });
  });

  it('finds unique match across clusters', () => {
    const result = resolvePartition('debug', clusterConfig, 'greatlakes', clusterConfig.greatlakes.partitions);
    expect(result).toEqual({ clusterKey: 'armis2', partitionKey: 'debug' });
  });

  it('returns null when no partition match exists', () => {
    const result = resolvePartition('notreal', clusterConfig, 'greatlakes', clusterConfig.greatlakes.partitions);
    expect(result).toBeNull();
  });
});
