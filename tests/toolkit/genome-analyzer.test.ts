/**
 * Unit tests for the Genome Analyzer component.
 */

import { describe, it, expect, vi } from 'vitest';
import { GenomeAnalyzer } from '../../src/toolkit/genome-analyzer/genome-analyzer.js';
import type { CircuitExecutor } from '../../src/toolkit/genome-analyzer/genome-analyzer.js';
import type { TranspiledCircuit, MeasurementResult } from '../../src/types/index.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock executor that returns perfect (noiseless) measurements.
 * For a noiseless simulator, all shots return the same bitstring that was encoded.
 */
function createNoiselessExecutor(): CircuitExecutor {
  return {
    async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
      // Parse the original circuit's QASM to determine which qubits have X gates
      const qasm = circuit.originalCircuit.qasm;
      const qubitCount = circuit.originalCircuit.qubitCount;

      // Build the expected bitstring from X gate applications
      const bits = new Array(qubitCount).fill('0');
      const xGateRegex = /x\s+q\[(\d+)\];/g;
      let match;
      while ((match = xGateRegex.exec(qasm)) !== null) {
        const qubitIdx = parseInt(match[1], 10);
        bits[qubitIdx] = '1';
      }

      const bitstring = bits.join('');
      return {
        bitstrings: { [bitstring]: shots },
        totalShots: shots,
        backend: 'braket-local-simulator',
        jobId: `test-job-${Date.now()}`,
      };
    },
  };
}

function makeFasta(id: string, sequence: string): string {
  return `>${id} test sequence\n${sequence}\n`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GenomeAnalyzer', () => {
  describe('analyze', () => {
    it('should analyze a short DNA sequence successfully', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('test1', 'ACGT');
      const result = await analyzer.analyze(fastaContent, 'test.fasta', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.sequence.nucleotides).toBe('ACGT');
      expect(result.sequence.length).toBe(4);
      expect(result.backend).toBe('braket-local-simulator');
      expect(result.partitioned).toBe(false);
      expect(result.segmentCount).toBe(1);
      expect(result.encodedCircuits).toHaveLength(1);
      expect(result.transpiledCircuits).toHaveLength(1);
      expect(result.decoded).toBeDefined();
      expect(result.report).toBeDefined();
      expect(result.costEstimate).toBeDefined();
    });

    it('should decode with 100% fidelity on noiseless simulator', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('test2', 'ACGTACGT');
      const result = await analyzer.analyze(fastaContent, 'test.fa', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.decoded.nucleotides).toBe('ACGTACGT');
      expect(result.decoded.averageConfidence).toBe(1.0);
      expect(result.decoded.lowConfidenceFlag).toBe(false);
    });

    it('should automatically partition when sequence exceeds backend maximum', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      // Local simulator max is 17 bases for encode (34 qubits / 2 qubits per base)
      // Use a 20-base sequence to trigger partitioning
      const fastaContent = makeFasta('long', 'ACGTACGTACGTACGTACGT');
      const result = await analyzer.analyze(fastaContent, 'test.fasta', {
        backend: 'braket-local-simulator',
        shots: 1000,
        autoPartition: true,
      });

      expect(result.partitioned).toBe(true);
      expect(result.segmentCount).toBeGreaterThan(1);
    });

    it('should throw when sequence exceeds limit and autoPartition is false', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('long', 'ACGTACGTACGTACGTACGT');

      await expect(
        analyzer.analyze(fastaContent, 'test.fasta', {
          backend: 'braket-local-simulator',
          shots: 1000,
          autoPartition: false,
        })
      ).rejects.toThrow(/exceeds the maximum allowed/);
    });

    it('should throw on invalid FASTA format', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      await expect(
        analyzer.analyze('not a fasta file', 'test.fasta', {
          backend: 'braket-local-simulator',
        })
      ).rejects.toThrow(/FASTA validation failed/);
    });

    it('should throw on wrong file extension', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('test', 'ACGT');

      await expect(
        analyzer.analyze(fastaContent, 'test.txt', {
          backend: 'braket-local-simulator',
        })
      ).rejects.toThrow(/FASTA validation failed/);
    });

    it('should include cost estimate in result', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('test', 'ACGT');
      const result = await analyzer.analyze(fastaContent, 'test.fasta', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.costEstimate).toBeDefined();
      expect(result.costEstimate!.isFree).toBe(true);
      expect(result.costEstimate!.totalCost).toBe(0);
    });

    it('should generate report with FASTA output and confidence', async () => {
      const executor = createNoiselessExecutor();
      const analyzer = new GenomeAnalyzer(executor);

      const fastaContent = makeFasta('test', 'ACGT');
      const result = await analyzer.analyze(fastaContent, 'test.fasta', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.report.fasta).toContain('>');
      expect(result.report.confidence).toHaveLength(4);
      expect(result.report.metadata.shots).toBe(1000);
      expect(result.report.metadata.backend).toBe('braket-local-simulator');
    });
  });
});
