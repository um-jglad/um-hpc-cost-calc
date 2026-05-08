/* @vitest-environment jsdom */

import React from 'react';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import App from './App.jsx';

const clickButtonByText = async (container, labelText) => {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(labelText));
  if (!button) {
    throw new Error(`Button with text containing "${labelText}" was not found.`);
  }

  await act(async () => {
    button.click();
  });
};

const setControlValue = (element, value) => {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('App SBATCH import cluster reparse', () => {
  let container;
  let root;

  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    const localStorageMock = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {}
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      configurable: true
    });
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true
    });

    Object.defineProperty(window, 'matchMedia', {
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }),
      configurable: true
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    container = null;
    root = null;
  });

  it('reparses imported header values when switching clusters instead of resetting defaults', async () => {
    const clusterInput = container.querySelector('#cluster');
    const partitionInput = container.querySelector('#partition');
    const coresInput = container.querySelector('#cores');

    await clickButtonByText(container, 'Show Import Tool');

    const sbatchInput = container.querySelector('#sbatchHeaderInput');
    const header = [
      '#SBATCH --partition=spgpu',
      '#SBATCH --cpus-per-gpu=4',
      '#SBATCH --gpus=1',
      '#SBATCH --mem=32G',
      '#SBATCH --time=01:00:00'
    ].join('\n');

    await act(async () => {
      setControlValue(sbatchInput, header);
    });

    await clickButtonByText(container, 'Parse Header');

    expect(clusterInput.value).toBe('greatlakes');
    expect(partitionInput.value).toBe('spgpu');
    expect(coresInput.value).toBe('4');

    await act(async () => {
      setControlValue(clusterInput, 'armis2');
    });

    expect(clusterInput.value).toBe('armis2');
    expect(partitionInput.value).toBe('gpu');
    expect(coresInput.value).toBe('4');
    expect(container.textContent).toContain('Partition "spgpu" is unavailable on Armis2; using gpu.');
  });

  it('retains imported unsupported directives and script commands in the generated example', async () => {
    await clickButtonByText(container, 'Show Import Tool');

    const sbatchInput = container.querySelector('#sbatchHeaderInput');
    const importedScript = [
      '#!/bin/bash',
      '#SBATCH --partition=standard',
      '#SBATCH --cpus-per-task=2',
      '#SBATCH --mem=16G',
      '#SBATCH --time=00:20:00',
      '#SBATCH --account=my_project',
      'module load python/3.11',
      'python run.py'
    ].join('\n');

    await act(async () => {
      setControlValue(sbatchInput, importedScript);
    });

    await clickButtonByText(container, 'Parse Header');
    await clickButtonByText(container, 'Show SLURM Script');

    expect(container.textContent).toContain('#SBATCH --account=my_project');
    expect(container.textContent).toContain('module load python/3.11');
    expect(container.textContent).toContain('python run.py');
    expect(container.textContent).not.toContain('YOUR_ACCOUNT');
    expect(container.textContent).toContain('Retained 3 non-SBATCH line(s) in the generated script example.');
    expect(container.textContent).toContain('Retained 1 unsupported SBATCH directive(s) in the generated script example (not used for estimation).');
  });

  it('preserves imported ntasks with cpus-per-task=1 in generated script', async () => {
    await clickButtonByText(container, 'Show Import Tool');

    const sbatchInput = container.querySelector('#sbatchHeaderInput');
    const importedScript = [
      '#SBATCH --partition=standard',
      '#SBATCH --cpus-per-task=1',
      '#SBATCH --ntasks=4',
      '#SBATCH --mem=16G',
      '#SBATCH --time=00:20:00'
    ].join('\n');

    await act(async () => {
      setControlValue(sbatchInput, importedScript);
    });

    await clickButtonByText(container, 'Parse Header');
    await clickButtonByText(container, 'Show SLURM Script');

    expect(container.textContent).toContain('#SBATCH --ntasks=4');
    expect(container.textContent).toContain('#SBATCH --cpus-per-task=1');
    expect(container.textContent).not.toContain('#SBATCH --ntasks=1');
    expect(container.textContent).not.toContain('#SBATCH --cpus-per-task=4');
  });
});
