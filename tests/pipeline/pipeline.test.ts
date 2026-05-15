/**
 * Integration tests for the end-to-end Quantum Genomics Pipeline.
 */

import { describe, it, expect, vi } from 'vitest';
import { QuantumGenomicsPipeline, type CircuitExecutor } from '../../src/pipeline.js';
import type { TranspiledCircuit, MeasurementResult } from '../../src/types/index.js';
import type { UploadedFile } from '../../src/validators/sequence-validator.js';

// ─── Mock Executor ───────────────────────────────────────────────────────────

/**
 * A mock executor that simulates perfect quantum execution.
 * For each circuit, it returns the expected bitstring with all shots.
 */
function makePerfectExecutor(): CircuitExecutor {
  return {
    execute: vi.fn().mockImplementation(async (circuit: TranspiledCircuit, shots: number) => {
      // Parse the original circuit to determine the expected bitstring
      const qubitCount = circuit.originalCircuit.qubitCount;
      const qasm = circuit.originalCircuit.qasm;

      // Build expected bitstring from X gates in the original circuit
      const bits = new Array(qubitCount).fill('0');
      const xGateRegex = /x q\[(\d+)\];/g;
      let match;
      while ((match = xGateRegex.exec(qasm)) !== null) {
        bits[parseInt(match[1], 10)] = '1';
      }
      const expectedBitstring = bits.join('');

      const result: MeasurementResult = {
        bitstrings: { [expectedBitstring]: shots },
        totalShots: shots,
        backend: circuit.backend,
        jobId: `mock-job-${Date.now()}`,
      };
      return result;
    }),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFile(filename: string, content: string): UploadedFile {
  return { filename, content };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QuantumGenomicsPipeline', () => {
  it('should run end-to-end for a short DNA sequence', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>seq1 Test\nACGT\n');
    const result = await pipeline.run(file, { backend: 'braket-local-simulator', shots: 1000 });

    expect(result.sequence.nucleotides).toBe('ACGT');
    expect(result.decoded.nucleotides).toBe('ACGT');
    expect(result.decoded.averageConfidence).toBe(1.0);
    expect(result.decoded.lowConfidenceFlag).toBe(false);
    expect(result.report.fasta).toContain('ACGT');
    expect(result.partitioned).toBe(false);
    expect(result.segmentCount).toBe(1);
    expect(result.backend).toBe('braket-local-simulator');
  });

  it('should produce valid FASTA in the report', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>seq1\nACGTACGT\n');
    const result = await pipeline.run(file, { backend: 'braket-local-simulator' });

    // FASTA should be parseable
    const lines = result.report.fasta.split('\n').filter((l) => l.length > 0);
    expect(lines[0].startsWith('>')).toBe(true);
    const sequence = lines.slice(1).join('');
    expect(sequence).toBe('ACGTACGT');
  });

  it('should handle RNA sequences', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>rna1\nACGU\n');
    const result = await pipeline.run(file, { backend: 'braket-local-simulator' });

    expect(result.sequence.type).toBe('RNA');
    expect(result.encodedCircuits[0].scheme.name).toBe('default-2qubit-basis-rna');
  });

  it('should partition genomes that exceed backend capacity', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    // 20 nucleotides × 2 qubits = 40 qubits — exceeds simulator (34 qubits)
    const longSeq = 'ACGT'.repeat(5); // 20 bases
    const file = makeFile('test.fasta', `>seq1\n${longSeq}\n`);
    const result = await pipeline.run(file, { backend: 'braket-local-simulator' });

    expect(result.partitioned).toBe(true);
    expect(result.segmentCount).toBeGreaterThan(1);
    // Each encoded circuit should fit within 34 qubits
    for (const circuit of result.encodedCircuits) {
      expect(circuit.qubitCount).toBeLessThanOrEqual(34);
    }
  });

  it('should select an appropriate backend automatically', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    // 4 bases × 2 = 8 qubits — fits all backends
    const file = makeFile('test.fasta', '>seq1\nACGT\n');
    const result = await pipeline.run(file);

    // Should pick the smallest backend that fits (simulator at 34 qubits)
    expect(result.backend).toBe('braket-local-simulator');
  });

  it('should throw on invalid file format', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('bad.xyz', 'not a genomic file');

    await expect(pipeline.run(file)).rejects.toThrow('Validation failed');
  });

  it('should throw on invalid nucleotides', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>seq1\nACXGT\n');

    await expect(pipeline.run(file)).rejects.toThrow('Validation failed');
  });

  it('should use custom shots when specified', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>seq1\nACGT\n');
    await pipeline.run(file, { backend: 'braket-local-simulator', shots: 5000 });

    expect(executor.execute).toHaveBeenCalledWith(
      expect.anything(),
      5000
    );
  });

  it('should transpile circuits for the selected backend', async () => {
    const executor = makePerfectExecutor();
    const pipeline = new QuantumGenomicsPipeline(executor);

    const file = makeFile('test.fasta', '>seq1\nACGT\n');
    const result = await pipeline.run(file, { backend: 'ionq-forte-enterprise' });

    expect(result.transpiledCircuits[0].backend).toBe('ionq-forte-enterprise');
    // IonQ transpilation should produce GPi gates
    expect(result.transpiledCircuits[0].qasm).toContain('gpi');
  });
});
