/**
 * Unit tests for the Grover Search Engine component.
 */

import { describe, it, expect } from 'vitest';
import { GroverSearchEngine } from '../../src/toolkit/grover-search/grover-search-engine.js';
import type { CircuitExecutor } from '../../src/toolkit/grover-search/grover-search-engine.js';
import type { TranspiledCircuit, MeasurementResult } from '../../src/types/index.js';
import { getDefaultEncodingScheme } from '../../src/types/encoding-schemes.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

/**
 * Creates a mock executor that returns measurement results simulating
 * Grover's algorithm finding the correct positions.
 */
function createGroverExecutor(targetPositions: number[], searchSpace: number): CircuitExecutor {
  return {
    async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
      const qubitCount = circuit.originalCircuit.qubitCount;
      const indexBits = Math.ceil(Math.log2(searchSpace));
      const bitstrings: Record<string, number> = {};

      if (targetPositions.length > 0) {
        // Distribute shots among target positions
        const shotsPerPosition = Math.floor(shots / targetPositions.length);
        const remainder = shots - shotsPerPosition * targetPositions.length;

        for (let i = 0; i < targetPositions.length; i++) {
          const positionBits = targetPositions[i].toString(2).padStart(indexBits, '0');
          const dataBits = '0'.repeat(qubitCount - indexBits);
          const bitstring = dataBits + positionBits;
          const adjustedBitstring = bitstring.slice(0, qubitCount);
          bitstrings[adjustedBitstring.padEnd(qubitCount, '0').slice(0, qubitCount)] =
            shotsPerPosition + (i === 0 ? remainder : 0);
        }
      } else {
        // No targets: uniform distribution
        const bitstring = '0'.repeat(qubitCount);
        bitstrings[bitstring] = shots;
      }

      return {
        bitstrings,
        totalShots: shots,
        backend: 'braket-local-simulator',
        jobId: `grover-job-${Date.now()}`,
      };
    },
  };
}

function makeFasta(id: string, sequence: string): string {
  return `>${id} test sequence\n${sequence}\n`;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GroverSearchEngine', () => {
  describe('search', () => {
    it('should find motif at correct positions', async () => {
      const executor = createGroverExecutor([0, 4], 6);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTACGT');
      const result = await engine.search(fasta, 'seq.fasta', 'ACGT', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.positions).toEqual([0, 4]);
      expect(result.motif).toBe('ACGT');
      expect(result.sequenceLength).toBe(8);
    });

    it('should return empty positions when motif not found', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTACGT');
      const result = await engine.search(fasta, 'seq.fasta', 'TTT', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.positions).toEqual([]);
      expect(result.message).toContain('not found');
      expect(result.iterations).toBe(0);
    });

    it('should throw error for invalid motif characters', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTACGT');

      await expect(
        engine.search(fasta, 'seq.fasta', 'AXZ', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/invalid characters/i);
    });

    it('should include invalid char positions in error message', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTACGT');

      await expect(
        engine.search(fasta, 'seq.fasta', 'A1B', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/position/);
    });

    it('should throw error when motif length >= sequence length', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGT');

      await expect(
        engine.search(fasta, 'seq.fasta', 'ACGTACGT', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/must be shorter/);
    });

    it('should throw error when motif length equals sequence length', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGT');

      await expect(
        engine.search(fasta, 'seq.fasta', 'ACGT', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/must be shorter/);
    });

    it('should throw error for invalid FASTA', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      await expect(
        engine.search('invalid content', 'seq.fasta', 'ACG', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/FASTA validation failed/);
    });

    it('should throw error for wrong file extension', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTACGT');

      await expect(
        engine.search(fasta, 'seq.txt', 'ACG', {
          backend: 'braket-local-simulator',
          shots: 1000,
        })
      ).rejects.toThrow(/FASTA validation failed/);
    });

    it('should throw error when sequence exceeds backend qubit limit', async () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      // braket-dm1 has 17 qubits, grover needs 2N + ceil(log2(N))
      // For N=8: 2*8 + ceil(log2(8)) = 16 + 3 = 19 > 17
      const fasta = makeFasta('seq1', 'ACGTACGT');

      await expect(
        engine.search(fasta, 'seq.fasta', 'AC', {
          backend: 'braket-dm1',
          shots: 1000,
        })
      ).rejects.toThrow(/exceeds the maximum allowed/);
    });

    it('should include cost estimate in result', async () => {
      const executor = createGroverExecutor([0], 4);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTG');
      const result = await engine.search(fasta, 'seq.fasta', 'AC', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.costEstimate).toBeDefined();
      expect(result.costEstimate!.isFree).toBe(true);
    });

    it('should include circuit metadata in result', async () => {
      const executor = createGroverExecutor([0], 4);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTG');
      const result = await engine.search(fasta, 'seq.fasta', 'AC', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.circuitMetadata.qubitCount).toBeGreaterThan(0);
      expect(result.circuitMetadata.gateCount).toBeGreaterThan(0);
      expect(result.circuitMetadata.depth).toBeGreaterThan(0);
    });

    it('should accept U in motif for RNA sequences', async () => {
      const executor = createGroverExecutor([0], 3);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGU');
      const result = await engine.search(fasta, 'seq.fasta', 'U', {
        backend: 'braket-local-simulator',
        shots: 1000,
      });

      expect(result.positions).toContain(3);
    });

    it('should use default shots of 1000 when not specified', async () => {
      const executor = createGroverExecutor([0], 4);
      const engine = new GroverSearchEngine(executor);

      const fasta = makeFasta('seq1', 'ACGTG');
      const result = await engine.search(fasta, 'seq.fasta', 'AC', {
        backend: 'braket-local-simulator',
      });

      expect(result).toBeDefined();
      expect(result.positions).toContain(0);
    });
  });

  describe('validateMotif', () => {
    it('should accept valid DNA motif', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.validateMotif('ACGT')).toBeNull();
    });

    it('should accept valid RNA motif with U', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.validateMotif('ACGU')).toBeNull();
    });

    it('should reject motif with invalid characters', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const result = engine.validateMotif('AXZ');
      expect(result).not.toBeNull();
      expect(result!.invalidCharacters).toHaveLength(2);
      expect(result!.invalidCharacters[0]).toEqual({ char: 'X', position: 1 });
      expect(result!.invalidCharacters[1]).toEqual({ char: 'Z', position: 2 });
    });

    it('should reject empty motif', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const result = engine.validateMotif('');
      expect(result).not.toBeNull();
      expect(result!.message).toContain('empty');
    });

    it('should reject motif with numbers', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const result = engine.validateMotif('A1C');
      expect(result).not.toBeNull();
      expect(result!.invalidCharacters).toContainEqual({ char: '1', position: 1 });
    });

    it('should reject motif with lowercase (after uppercase conversion in search)', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      // validateMotif expects uppercase input (search() uppercases before calling)
      const result = engine.validateMotif('acgt');
      expect(result).not.toBeNull();
    });
  });

  describe('calculateOptimalIterations', () => {
    it('should return round(π/4 × √(N/M)) for valid inputs', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      // N=16, M=1 → round(π/4 × √16) = round(π/4 × 4) = round(3.14) = 3
      expect(engine.calculateOptimalIterations(16, 1)).toBe(3);
    });

    it('should return 1 for single element search space', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      // N=1, M=1 → round(π/4 × √1) = round(0.785) = 1
      expect(engine.calculateOptimalIterations(1, 1)).toBe(1);
    });

    it('should return 1 when expectedMatches is 0', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.calculateOptimalIterations(16, 0)).toBe(1);
    });

    it('should return 1 when searchSpace is 0', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.calculateOptimalIterations(0, 1)).toBe(1);
    });

    it('should decrease iterations as matches increase', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const iter1 = engine.calculateOptimalIterations(100, 1);
      const iter10 = engine.calculateOptimalIterations(100, 10);

      expect(iter1).toBeGreaterThan(iter10);
    });

    it('should increase iterations as search space increases', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      const iter16 = engine.calculateOptimalIterations(16, 1);
      const iter64 = engine.calculateOptimalIterations(64, 1);

      expect(iter64).toBeGreaterThan(iter16);
    });

    it('should compute correctly for N=100, M=4', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      // round(π/4 × √(100/4)) = round(π/4 × 5) = round(3.927) = 4
      expect(engine.calculateOptimalIterations(100, 4)).toBe(4);
    });
  });

  describe('findMotifPositions', () => {
    it('should find single occurrence', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('ACGTACGT', 'CGT')).toEqual([1, 5]);
    });

    it('should find overlapping occurrences', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('AAAA', 'AA')).toEqual([0, 1, 2]);
    });

    it('should return empty array when motif not found', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('ACGT', 'TTT')).toEqual([]);
    });

    it('should be case-insensitive', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('acgt', 'CGT')).toEqual([1]);
    });

    it('should find motif at start of sequence', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('ACGTTT', 'ACG')).toEqual([0]);
    });

    it('should find motif at end of sequence', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);

      expect(engine.findMotifPositions('TTTACG', 'ACG')).toEqual([3]);
    });
  });

  describe('buildGroverCircuit', () => {
    it('should produce circuit with correct qubit count (2N + ceil(log2(N)))', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seq = {
        id: 'test', description: '', nucleotides: 'ACGTACGT',
        length: 8, type: 'DNA' as const, metadata: {},
      };

      const circuit = engine.buildGroverCircuit(seq, 'ACG', scheme);

      // 2*8 + ceil(log2(8)) = 16 + 3 = 19
      expect(circuit.qubitCount).toBe(19);
    });

    it('should include sequence encoding in QASM', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seq = {
        id: 'test', description: '', nucleotides: 'AC',
        length: 2, type: 'DNA' as const, metadata: {},
      };

      const circuit = engine.buildGroverCircuit(seq, 'A', scheme);

      expect(circuit.qasm).toContain('OPENQASM 3.0;');
      expect(circuit.qasm).toContain('Encode sequence');
    });

    it('should include Hadamard on index register', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seq = {
        id: 'test', description: '', nucleotides: 'ACGT',
        length: 4, type: 'DNA' as const, metadata: {},
      };

      const circuit = engine.buildGroverCircuit(seq, 'AC', scheme);

      expect(circuit.qasm).toContain('Hadamard on index register');
      // Index register starts at qubit 2*4 = 8
      expect(circuit.qasm).toContain('h q[8];');
    });

    it('should include Grover iterations', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seq = {
        id: 'test', description: '', nucleotides: 'ACGT',
        length: 4, type: 'DNA' as const, metadata: {},
      };

      const circuit = engine.buildGroverCircuit(seq, 'AC', scheme);

      expect(circuit.qasm).toContain('Grover iterations');
      expect(circuit.qasm).toContain('Oracle');
      expect(circuit.qasm).toContain('Diffusion');
    });

    it('should include measurement of index register', () => {
      const executor = createGroverExecutor([], 5);
      const engine = new GroverSearchEngine(executor);
      const scheme = getDefaultEncodingScheme('DNA');

      const seq = {
        id: 'test', description: '', nucleotides: 'ACGT',
        length: 4, type: 'DNA' as const, metadata: {},
      };

      const circuit = engine.buildGroverCircuit(seq, 'AC', scheme);

      expect(circuit.qasm).toContain('measure');
    });
  });
});
