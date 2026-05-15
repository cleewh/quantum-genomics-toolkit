/**
 * Unit tests for the Noise Benchmarker component.
 */

import { describe, it, expect } from 'vitest';
import { NoiseBenchmarker } from '../../src/toolkit/noise-benchmarker/noise-benchmarker.js';
import type { BenchmarkExecutor, BenchmarkConfig } from '../../src/toolkit/noise-benchmarker/noise-benchmarker.js';
import type { TranspiledCircuit, MeasurementResult } from '../../src/types/index.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock executor that simulates perfect (noiseless) execution.
 * Returns measurement results where the encoded bitstring is always measured.
 */
function createPerfectExecutor(): BenchmarkExecutor {
  return {
    async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
      // For a perfect executor, the encoded state is measured every time
      // The circuit's QASM contains X gates that flip qubits to encode the sequence
      // We parse the X gates to determine the expected bitstring
      const qubitCount = circuit.originalCircuit.qubitCount;
      const bits = Array(qubitCount).fill('0');

      // Parse X gates from the original circuit QASM
      const xGateRegex = /x q\[(\d+)\];/g;
      let match;
      while ((match = xGateRegex.exec(circuit.originalCircuit.qasm)) !== null) {
        const qubitIndex = parseInt(match[1], 10);
        if (qubitIndex < qubitCount) {
          bits[qubitIndex] = '1';
        }
      }

      const bitstring = bits.join('');
      const bitstrings: Record<string, number> = { [bitstring]: shots };

      return {
        bitstrings,
        totalShots: shots,
        backend: 'braket-local-simulator',
        jobId: `benchmark-job-${Date.now()}`,
      };
    },
  };
}

/**
 * Creates a mock executor that simulates noisy execution.
 * Randomly flips some bits to simulate noise.
 */
function createNoisyExecutor(errorRate: number): BenchmarkExecutor {
  return {
    async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
      const qubitCount = circuit.originalCircuit.qubitCount;
      const bits = Array(qubitCount).fill('0');

      // Parse X gates from the original circuit QASM
      const xGateRegex = /x q\[(\d+)\];/g;
      let match;
      while ((match = xGateRegex.exec(circuit.originalCircuit.qasm)) !== null) {
        const qubitIndex = parseInt(match[1], 10);
        if (qubitIndex < qubitCount) {
          bits[qubitIndex] = '1';
        }
      }

      const correctBitstring = bits.join('');
      const bitstrings: Record<string, number> = {};

      // Simulate noise: some shots get the correct result, some get errors
      const correctShots = Math.round(shots * (1 - errorRate));
      const errorShots = shots - correctShots;

      if (correctShots > 0) {
        bitstrings[correctBitstring] = correctShots;
      }

      if (errorShots > 0) {
        // Create an error bitstring by flipping the first bit
        const errorBits = [...bits];
        errorBits[0] = errorBits[0] === '0' ? '1' : '0';
        const errorBitstring = errorBits.join('');
        bitstrings[errorBitstring] = errorShots;
      }

      return {
        bitstrings,
        totalShots: shots,
        backend: 'braket-local-simulator',
        jobId: `benchmark-job-${Date.now()}`,
      };
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('NoiseBenchmarker', () => {
  describe('validateConfig', () => {
    it('should accept valid config', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2, 4, 8],
        backends: ['braket-local-simulator'],
        shotCounts: [100, 500, 1000],
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty sequence lengths', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('sequence length');
    });

    it('should reject sequence length less than 1', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [0],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('at least 1');
    });

    it('should reject empty backends', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2],
        backends: [],
        shotCounts: [100],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('backend');
    });

    it('should reject invalid backend identifiers', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2],
        backends: ['invalid-backend' as any],
        shotCounts: [100],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Invalid backend');
    });

    it('should reject shot counts below 100', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [50],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('between 100 and 10000');
    });

    it('should reject shot counts above 10000', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [20000],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('between 100 and 10000');
    });

    it('should reject empty shot counts', () => {
      const benchmarker = new NoiseBenchmarker();

      const result = benchmarker.validateConfig({
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('shot count');
    });

    it('should reject sequence lengths exceeding all backends capacity', () => {
      const benchmarker = new NoiseBenchmarker();

      // braket-dm1 has 17 qubits, encode needs 2N, so max N = 8
      // Use length 9 which exceeds dm1 capacity
      const result = benchmarker.validateConfig({
        sequenceLengths: [9],
        backends: ['braket-dm1'],
        shotCounts: [100],
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds capacity');
    });

    it('should accept sequence length that fits at least one backend', () => {
      const benchmarker = new NoiseBenchmarker();

      // Length 10 exceeds dm1 (max 8) but fits local-simulator (max 17)
      const result = benchmarker.validateConfig({
        sequenceLengths: [10],
        backends: ['braket-dm1', 'braket-local-simulator'],
        shotCounts: [100],
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('run', () => {
    it('should produce results for all combinations', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const config: BenchmarkConfig = {
        sequenceLengths: [2, 4],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      };

      const report = await benchmarker.run(config, executor);

      expect(report.totalCombinations).toBe(2); // 2 lengths × 1 backend × 1 shot count
      expect(report.completedCombinations).toBe(2);
      expect(report.results).toHaveLength(2);
    });

    it('should achieve high fidelity with perfect executor', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const config: BenchmarkConfig = {
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [1000],
      };

      const report = await benchmarker.run(config, executor);

      expect(report.results[0].fidelity).toBe(1.0);
    });

    it('should report lower fidelity with noisy executor', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createNoisyExecutor(0.8); // 80% error rate — errors dominate

      const config: BenchmarkConfig = {
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [1000],
      };

      const report = await benchmarker.run(config, executor);

      expect(report.results[0].fidelity).toBeLessThan(1.0);
    });

    it('should call progress callback', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const progressUpdates: { currentCombination: string; completedPercent: number }[] = [];

      const config: BenchmarkConfig = {
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      };

      await benchmarker.run(config, executor, (progress) => {
        progressUpdates.push(progress);
      });

      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[0].currentCombination).toContain('2bp');
      expect(progressUpdates[0].completedPercent).toBeGreaterThanOrEqual(0);
    });

    it('should generate recommendations', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const config: BenchmarkConfig = {
        sequenceLengths: [2, 4],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      };

      const report = await benchmarker.run(config, executor);

      expect(report.recommendations).toBeDefined();
      expect(report.recommendations['braket-local-simulator']).toBeGreaterThan(0);
    });

    it('should include cost estimate', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const config: BenchmarkConfig = {
        sequenceLengths: [2],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      };

      const report = await benchmarker.run(config, executor);

      expect(report.totalCostEstimate).toBeDefined();
      expect(report.totalCostEstimate!.isFree).toBe(true);
    });

    it('should throw error for invalid config', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      const config: BenchmarkConfig = {
        sequenceLengths: [],
        backends: ['braket-local-simulator'],
        shotCounts: [100],
      };

      await expect(benchmarker.run(config, executor)).rejects.toThrow(/Invalid benchmark config/);
    });

    it('should handle combinations that exceed backend capacity gracefully', async () => {
      const benchmarker = new NoiseBenchmarker();
      const executor = createPerfectExecutor();

      // dm1 has 17 qubits, encode needs 2N, max N=8
      // Length 10 exceeds dm1 but fits local-simulator
      const config: BenchmarkConfig = {
        sequenceLengths: [10],
        backends: ['braket-dm1', 'braket-local-simulator'],
        shotCounts: [100],
      };

      const report = await benchmarker.run(config, executor);

      // dm1 result should have fidelity 0 (skipped)
      const dm1Result = report.results.find(r => r.backend === 'braket-dm1');
      expect(dm1Result).toBeDefined();
      expect(dm1Result!.fidelity).toBe(0);

      // local-simulator result should have high fidelity
      const localResult = report.results.find(r => r.backend === 'braket-local-simulator');
      expect(localResult).toBeDefined();
      expect(localResult!.fidelity).toBe(1.0);
    });
  });

  describe('calculateFidelity', () => {
    it('should return 1.0 for identical sequences', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.calculateFidelity('ACGT', 'ACGT')).toBe(1.0);
    });

    it('should return 0.0 for completely different sequences', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.calculateFidelity('AAAA', 'TTTT')).toBe(0.0);
    });

    it('should return 0.5 for half-matching sequences', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.calculateFidelity('AATT', 'AAGC')).toBe(0.5);
    });

    it('should return 0 for empty original', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.calculateFidelity('', 'ACGT')).toBe(0);
    });

    it('should handle decoded shorter than original', () => {
      const benchmarker = new NoiseBenchmarker();

      // Only 2 of 4 bases can be compared, both match
      expect(benchmarker.calculateFidelity('ACGT', 'AC')).toBe(0.5);
    });

    it('should be case-insensitive', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.calculateFidelity('acgt', 'ACGT')).toBe(1.0);
    });
  });

  describe('generateRandomSequence', () => {
    it('should generate sequence of correct length', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.generateRandomSequence(10).length).toBe(10);
      expect(benchmarker.generateRandomSequence(1).length).toBe(1);
      expect(benchmarker.generateRandomSequence(100).length).toBe(100);
    });

    it('should only contain valid DNA bases (A, C, G, T)', () => {
      const benchmarker = new NoiseBenchmarker();

      const sequence = benchmarker.generateRandomSequence(1000);
      const validBases = new Set(['A', 'C', 'G', 'T']);

      for (const base of sequence) {
        expect(validBases.has(base)).toBe(true);
      }
    });

    it('should not contain U (RNA base)', () => {
      const benchmarker = new NoiseBenchmarker();

      const sequence = benchmarker.generateRandomSequence(1000);
      expect(sequence).not.toContain('U');
    });

    it('should generate empty string for length 0', () => {
      const benchmarker = new NoiseBenchmarker();

      expect(benchmarker.generateRandomSequence(0)).toBe('');
    });

    it('should produce varied sequences (not all same base)', () => {
      const benchmarker = new NoiseBenchmarker();

      // With 100 bases, probability of all same is (1/4)^99 ≈ 0
      const sequence = benchmarker.generateRandomSequence(100);
      const uniqueBases = new Set(sequence.split(''));

      expect(uniqueBases.size).toBeGreaterThan(1);
    });
  });

  describe('generateRecommendations', () => {
    it('should recommend max length where fidelity >= 0.7', () => {
      const benchmarker = new NoiseBenchmarker();

      const results = [
        { sequenceLength: 2, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 1.0, gateCount: 2, circuitDepth: 1 },
        { sequenceLength: 4, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 0.9, gateCount: 4, circuitDepth: 1 },
        { sequenceLength: 8, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 0.7, gateCount: 8, circuitDepth: 1 },
        { sequenceLength: 16, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 0.5, gateCount: 16, circuitDepth: 1 },
      ];

      const recommendations = benchmarker.generateRecommendations(results, ['braket-local-simulator']);

      expect(recommendations['braket-local-simulator']).toBe(8);
    });

    it('should return 0 when no length achieves fidelity >= 0.7', () => {
      const benchmarker = new NoiseBenchmarker();

      const results = [
        { sequenceLength: 2, backend: 'braket-dm1' as const, shots: 100, fidelity: 0.5, gateCount: 2, circuitDepth: 1 },
        { sequenceLength: 4, backend: 'braket-dm1' as const, shots: 100, fidelity: 0.3, gateCount: 4, circuitDepth: 1 },
      ];

      const recommendations = benchmarker.generateRecommendations(results, ['braket-dm1']);

      expect(recommendations['braket-dm1']).toBe(0);
    });

    it('should handle multiple backends independently', () => {
      const benchmarker = new NoiseBenchmarker();

      const results = [
        { sequenceLength: 2, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 1.0, gateCount: 2, circuitDepth: 1 },
        { sequenceLength: 4, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 0.8, gateCount: 4, circuitDepth: 1 },
        { sequenceLength: 2, backend: 'braket-dm1' as const, shots: 100, fidelity: 0.9, gateCount: 2, circuitDepth: 1 },
        { sequenceLength: 4, backend: 'braket-dm1' as const, shots: 100, fidelity: 0.6, gateCount: 4, circuitDepth: 1 },
      ];

      const recommendations = benchmarker.generateRecommendations(
        results,
        ['braket-local-simulator', 'braket-dm1']
      );

      expect(recommendations['braket-local-simulator']).toBe(4);
      expect(recommendations['braket-dm1']).toBe(2);
    });
  });

  describe('formatReport', () => {
    it('should produce human-readable output', () => {
      const benchmarker = new NoiseBenchmarker();

      const report = {
        results: [
          { sequenceLength: 2, backend: 'braket-local-simulator' as const, shots: 100, fidelity: 1.0, gateCount: 2, circuitDepth: 1 },
        ],
        recommendations: { 'braket-local-simulator': 2 },
        totalCombinations: 1,
        completedCombinations: 1,
        totalCostEstimate: {
          totalCost: 0,
          breakdown: { taskCost: 0, shotCost: 0, simulatorTimeCost: 0, totalShots: 100, circuitCount: 1 },
          backend: 'braket-local-simulator' as const,
          isFree: true,
          estimatedExecutionTimeSeconds: 0,
        },
      };

      const formatted = benchmarker.formatReport(report);

      expect(formatted).toContain('Noise Benchmark Report');
      expect(formatted).toContain('Total combinations: 1');
      expect(formatted).toContain('braket-local-simulator');
      expect(formatted).toContain('Recommendations');
    });
  });
});
