/**
 * Tests for CLI utilities: backend name mapping, output formatting, file reading.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  resolveBackend,
  readFastaFile,
  formatOutput,
  BACKEND_NAME_MAP,
  isPaidBackend,
} from '../../src/toolkit/cli/utils.js';

// ─── Backend Name Mapping ────────────────────────────────────────────────────

describe('Backend Name Mapping', () => {
  it('maps "local" to braket-local-simulator', () => {
    expect(resolveBackend('local')).toBe('braket-local-simulator');
  });

  it('maps "sv1" to braket-sv1', () => {
    expect(resolveBackend('sv1')).toBe('braket-sv1');
  });

  it('maps "dm1" to braket-dm1', () => {
    expect(resolveBackend('dm1')).toBe('braket-dm1');
  });

  it('maps "ionq" to ionq-forte-enterprise', () => {
    expect(resolveBackend('ionq')).toBe('ionq-forte-enterprise');
  });

  it('maps "rigetti" to rigetti-cepheus-1', () => {
    expect(resolveBackend('rigetti')).toBe('rigetti-cepheus-1');
  });

  it('is case-insensitive', () => {
    expect(resolveBackend('LOCAL')).toBe('braket-local-simulator');
    expect(resolveBackend('SV1')).toBe('braket-sv1');
    expect(resolveBackend('Ionq')).toBe('ionq-forte-enterprise');
  });

  it('accepts full backend IDs directly', () => {
    expect(resolveBackend('braket-local-simulator')).toBe('braket-local-simulator');
    expect(resolveBackend('ionq-forte-enterprise')).toBe('ionq-forte-enterprise');
  });

  it('throws for unknown backend names', () => {
    expect(() => resolveBackend('unknown')).toThrow(/Unknown backend/);
    expect(() => resolveBackend('aws')).toThrow(/Unknown backend/);
  });

  it('has all expected short names', () => {
    expect(Object.keys(BACKEND_NAME_MAP)).toEqual(['local', 'sv1', 'dm1', 'ionq', 'rigetti']);
  });
});

// ─── Output Formatting ───────────────────────────────────────────────────────

describe('Output Formatting', () => {
  describe('JSON format', () => {
    it('produces valid JSON for simple objects', () => {
      const data = { score: 0.95, backend: 'local' };
      const output = formatOutput(data, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(data);
    });

    it('produces valid JSON for nested objects', () => {
      const data = {
        result: { positions: [0, 5, 10], motif: 'ACGT' },
        metadata: { backend: 'sv1', shots: 1000 },
      };
      const output = formatOutput(data, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(data);
    });

    it('produces valid JSON for arrays', () => {
      const data = [1, 2, 3, 4, 5];
      const output = formatOutput(data, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(data);
    });

    it('produces valid JSON for null values', () => {
      const data = { value: null, name: 'test' };
      const output = formatOutput(data, 'json');
      const parsed = JSON.parse(output);
      expect(parsed).toEqual(data);
    });

    it('is pretty-printed with 2-space indentation', () => {
      const data = { a: 1 };
      const output = formatOutput(data, 'json');
      expect(output).toBe('{\n  "a": 1\n}');
    });
  });

  describe('Text format', () => {
    it('renders key-value pairs as human-readable text', () => {
      const data = { score: 0.95, backend: 'local' };
      const output = formatOutput(data, 'text');
      expect(output).toContain('Score: 0.95');
      expect(output).toContain('Backend: local');
    });

    it('renders nested objects with indentation', () => {
      const data = { metadata: { qubits: 10, depth: 5 } };
      const output = formatOutput(data, 'text');
      expect(output).toContain('Metadata:');
      expect(output).toContain('Qubits: 10');
      expect(output).toContain('Depth: 5');
    });

    it('renders arrays as numbered lists', () => {
      const data = { positions: [0, 5, 10] };
      const output = formatOutput(data, 'text');
      expect(output).toContain('Positions:');
      expect(output).toContain('1. 0');
      expect(output).toContain('2. 5');
      expect(output).toContain('3. 10');
    });

    it('renders empty arrays as (none)', () => {
      const data = { positions: [] };
      const output = formatOutput(data, 'text');
      expect(output).toContain('(none)');
    });
  });
});

// ─── File Reading ────────────────────────────────────────────────────────────

describe('File Reading', () => {
  const testDir = join(tmpdir(), 'quantum-cli-test-' + Date.now());
  const testFile = join(testDir, 'test.fasta');

  beforeAll(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterAll(() => {
    try { unlinkSync(testFile); } catch {}
  });

  it('reads an existing file successfully', () => {
    const content = '>test\nACGT\n';
    writeFileSync(testFile, content, 'utf-8');
    const result = readFastaFile(testFile);
    expect(result).toBe(content);
  });

  it('throws for non-existent file', () => {
    expect(() => readFastaFile('/nonexistent/path/file.fasta')).toThrow(/File not found/);
  });

  it('includes the file path in the error message', () => {
    const badPath = '/nonexistent/path/missing.fasta';
    expect(() => readFastaFile(badPath)).toThrow(badPath);
  });
});

// ─── Paid Backend Detection ──────────────────────────────────────────────────

describe('Paid Backend Detection', () => {
  it('identifies local simulator as free', () => {
    expect(isPaidBackend('braket-local-simulator')).toBe(false);
  });

  it('identifies sv1 as paid', () => {
    expect(isPaidBackend('braket-sv1')).toBe(true);
  });

  it('identifies dm1 as paid', () => {
    expect(isPaidBackend('braket-dm1')).toBe(true);
  });

  it('identifies ionq as paid', () => {
    expect(isPaidBackend('ionq-forte-enterprise')).toBe(true);
  });

  it('identifies rigetti as paid', () => {
    expect(isPaidBackend('rigetti-cepheus-1')).toBe(true);
  });
});
