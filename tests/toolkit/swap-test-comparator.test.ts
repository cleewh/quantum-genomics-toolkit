/**
 * Unit tests for the SWAP Test Comparator component.
 */

import { describe, it, expect } from 'vitest';
import { SwapTestComparator } from '../../src/toolkit/swap-test/swap-test-comparator.js';
import type { CircuitExecutor } from '../../src/toolkit/swap-test/swap-test-comparator.js';
import type { TranspiledCircuit, MeasurementResult } from '../../src/types/index.js';
import { getDefaultEncodingScheme } from '../../src/types/encoding-schemes.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock executor that simulates a noiseless SWAP test.
 * For identical sequences, ancilla always measures 0 (P(|0⟩) = 1, similarity = 1).
 * For different sequences, we simulate based on the overlap.
 */
function createSwapTestExecutor(ancillaZeroProbability: number): CircuitExecutor {
  return {
    async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
      const qubitCount = circuit.originalCircuit.qubitCount;
      const zeroCount = Math.round(ancillaZeroProbability * shots);
      const oneCount = shots - zeroCount;

      // Build bitstrings where only the ancilla (first bit) varies
      const bitstrings: Record<string, number> = {};
      const restBits = '0'.repeat(qubitCount - 1);

      if (zeroCount > 0) {
        bitstrings['0' + restBits] = zeroCount;
      }
      if (oneCount > 0) {
        bitstrings['1' + restBits] = oneCount;
      }

      return {
        bitstrings,
        totalShots: shots,
        backend: 'braket-local-simulator',
        jobId: `swap-test-job-${Date.now()}`,
      };
    },
  };
}

function makeFasta(id: string, sequence: string): string {
  return `>${id} test sequence\n${sequence}\n`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SwapTestComparator', () => {
  describe('compare', () => {
    it('should produce similarity of 1 for identical sequences', async () => {
      // Identical sequences → P(|0⟩) = 1 → similarity = 1
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGT');
      const fastaB = makeFasta('seqB', 'ACGT');

      const result = await comparator.compare(
        fastaA, 'a.fasta',
        fastaB, 'b.fasta',
        { backend: 'braket-local-simulator', shots: 1000 }
      );

      expect(result.similarityScore).toBe(1);
      expect(result.totalShots).toBe(1000);
      expect(result.sequenceA.nucleotides).toBe('ACGT');
      expect(result.sequenceB.nucleotides).toBe('ACGT');
    });

    it('should produce similarity of 0 for orthogonal sequences', async () => {
      // Orthogonal sequences → P(|0⟩) = 0.5 → similarity = 0
      const executor = createSwapTestExecutor(0.5);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'AAAA');
      const fastaB = makeFasta('seqB', 'TTTT');

      const result = await comparator.compare(
        fastaA, 'a.fasta',
        fastaB, 'b.fasta',
        { backend: 'braket-local-simulator', shots: 1000 }
      );

      expect(result.similarityScore).toBe(0);
    });

    it('should produce intermediate similarity for partially similar sequences', async () => {
      // P(|0⟩) = 0.75 → similarity = 0.5
      const executor = createSwapTestExecutor(0.75);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGT');
      const fastaB = makeFasta('seqB', 'ACGA');

      const result = await comparator.compare(
        fastaA, 'a.fasta',
        fastaB, 'b.fasta',
        { backend: 'braket-local-simulator', shots: 1000 }
      );

      expect(result.similarityScore).toBeCloseTo(0.5, 1);
    });

    it('should throw error for unequal length sequences', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGT');
      const fastaB = makeFasta('seqB', 'ACG');

      await expect(
        comparator.compare(
          fastaA, 'a.fasta',
          fastaB, 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/equal length/);
    });

    it('should include both lengths in unequal length error', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGTAC');
      const fastaB = makeFasta('seqB', 'ACG');

      await expect(
        comparator.compare(
          fastaA, 'a.fasta',
          fastaB, 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/length 6.*length 3/);
    });

    it('should throw error when sequence exceeds backend limit', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      // Local simulator: 34 qubits, SWAP test needs 4N+1, so max N = (34-1)/4 = 8
      // Use 9 bases to exceed limit
      const fastaA = makeFasta('seqA', 'ACGTACGTA');
      const fastaB = makeFasta('seqB', 'ACGTACGTA');

      await expect(
        comparator.compare(
          fastaA, 'a.fasta',
          fastaB, 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/exceeds the maximum allowed/);
    });

    it('should throw on invalid FASTA for file A', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      await expect(
        comparator.compare(
          'invalid content', 'a.fasta',
          makeFasta('seqB', 'ACGT'), 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/FASTA validation failed for file A/);
    });

    it('should throw on invalid FASTA for file B', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      await expect(
        comparator.compare(
          makeFasta('seqA', 'ACGT'), 'a.fasta',
          'invalid content', 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/FASTA validation failed for file B/);
    });

    it('should throw on wrong file extension', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      await expect(
        comparator.compare(
          makeFasta('seqA', 'ACGT'), 'a.txt',
          makeFasta('seqB', 'ACGT'), 'b.fasta',
          { backend: 'braket-local-simulator', shots: 1000 }
        )
      ).rejects.toThrow(/FASTA validation failed/);
    });

    it('should include circuit metadata in result', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGT');
      const fastaB = makeFasta('seqB', 'ACGT');

      const result = await comparator.compare(
        fastaA, 'a.fasta',
        fastaB, 'b.fasta',
        { backend: 'braket-local-simulator', shots: 1000 }
      );

      // 4N+1 = 4*4+1 = 17 qubits
      expect(result.circuitMetadata.qubitCount).toBe(17);
      expect(result.circuitMetadata.gateCount).toBeGreaterThan(0);
      expect(result.circuitMetadata.depth).toBeGreaterThan(0);
    });

    it('should include cost estimate in result', async () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const fastaA = makeFasta('seqA', 'ACGT');
      const fastaB = makeFasta('seqB', 'ACGT');

      const result = await comparator.compare(
        fastaA, 'a.fasta',
        fastaB, 'b.fasta',
        { backend: 'braket-local-simulator', shots: 1000 }
      );

      expect(result.costEstimate).toBeDefined();
      expect(result.costEstimate!.isFree).toBe(true);
    });
  });

  describe('buildSwapTestCircuit', () => {
    it('should produce circuit with 4N+1 qubits', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seqA = { id: 'a', description: '', nucleotides: 'ACGT', length: 4, type: 'DNA' as const, metadata: {} };
      const seqB = { id: 'b', description: '', nucleotides: 'ACGT', length: 4, type: 'DNA' as const, metadata: {} };

      const circuit = comparator.buildSwapTestCircuit(seqA, seqB, scheme);

      // 4*4 + 1 = 17 qubits
      expect(circuit.qubitCount).toBe(17);
    });

    it('should produce circuit with correct qubit count for various lengths', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      for (const N of [1, 2, 3, 5, 8]) {
        const seq = 'A'.repeat(N);
        const seqA = { id: 'a', description: '', nucleotides: seq, length: N, type: 'DNA' as const, metadata: {} };
        const seqB = { id: 'b', description: '', nucleotides: seq, length: N, type: 'DNA' as const, metadata: {} };

        const circuit = comparator.buildSwapTestCircuit(seqA, seqB, scheme);
        expect(circuit.qubitCount).toBe(4 * N + 1);
      }
    });

    it('should include H gate on ancilla in QASM', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seqA = { id: 'a', description: '', nucleotides: 'AC', length: 2, type: 'DNA' as const, metadata: {} };
      const seqB = { id: 'b', description: '', nucleotides: 'AC', length: 2, type: 'DNA' as const, metadata: {} };

      const circuit = comparator.buildSwapTestCircuit(seqA, seqB, scheme);

      expect(circuit.qasm).toContain('h q[0];');
    });

    it('should measure only the ancilla qubit', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seqA = { id: 'a', description: '', nucleotides: 'AC', length: 2, type: 'DNA' as const, metadata: {} };
      const seqB = { id: 'b', description: '', nucleotides: 'AC', length: 2, type: 'DNA' as const, metadata: {} };

      const circuit = comparator.buildSwapTestCircuit(seqA, seqB, scheme);

      expect(circuit.qasm).toContain('c = measure q[0];');
    });
  });

  describe('calculateSimilarity', () => {
    it('should return 1 when all measurements are 0', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({ '0': 1000, '1': 0 }, 1000);
      expect(similarity).toBe(1);
    });

    it('should return 0 when measurements are 50/50', () => {
      const executor = createSwapTestExecutor(0.5);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({ '0': 500, '1': 500 }, 1000);
      expect(similarity).toBe(0);
    });

    it('should return 0 when all measurements are 1 (clamped)', () => {
      const executor = createSwapTestExecutor(0.0);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({ '0': 0, '1': 1000 }, 1000);
      // 2*0 - 1 = -1, clamped to 0
      expect(similarity).toBe(0);
    });

    it('should return 0.5 when P(|0⟩) = 0.75', () => {
      const executor = createSwapTestExecutor(0.75);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({ '0': 750, '1': 250 }, 1000);
      expect(similarity).toBe(0.5);
    });

    it('should handle zero total shots', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({}, 0);
      expect(similarity).toBe(0);
    });

    it('should handle missing keys in measurements', () => {
      const executor = createSwapTestExecutor(1.0);
      const comparator = new SwapTestComparator(executor);

      const similarity = comparator.calculateSimilarity({ '0': 1000 }, 1000);
      expect(similarity).toBe(1);
    });
  });
});
