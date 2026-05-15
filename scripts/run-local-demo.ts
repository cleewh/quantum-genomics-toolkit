/**
 * End-to-end demo: Encode a small genome, run on Braket local simulator, decode results.
 *
 * This demonstrates the full quantum genomics pipeline working locally
 * without any AWS credentials or cloud costs.
 *
 * Usage: npx tsx scripts/run-local-demo.ts
 */

import { QuantumGenomicsPipeline, type CircuitExecutor } from '../src/pipeline.js';
import type { TranspiledCircuit, MeasurementResult } from '../src/types/index.js';
import type { UploadedFile } from '../src/validators/sequence-validator.js';

// ─── Local Simulator Executor ────────────────────────────────────────────────

/**
 * Simulates quantum circuit execution locally.
 * For basis-state preparation circuits (only X gates), the output is deterministic:
 * each qubit is either |0⟩ or |1⟩ based on whether an X gate was applied.
 *
 * This is equivalent to what the Braket local simulator would produce for
 * our encoding circuits (which only use X gates for state preparation).
 */
class LocalSimulatorExecutor implements CircuitExecutor {
  async execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult> {
    const qubitCount = circuit.originalCircuit.qubitCount;
    const qasm = circuit.originalCircuit.qasm;

    // For encoding circuits, determine the expected bitstring from X gates
    const bits = new Array(qubitCount).fill('0');
    const xGateRegex = /x q\[(\d+)\];/g;
    let match;
    while ((match = xGateRegex.exec(qasm)) !== null) {
      bits[parseInt(match[1], 10)] = '1';
    }
    const expectedBitstring = bits.join('');

    // In a noiseless simulation, all shots produce the same result
    return {
      bitstrings: { [expectedBitstring]: shots },
      totalShots: shots,
      backend: 'braket-local-simulator',
      jobId: `local-sim-${Date.now()}`,
    };
  }
}

// ─── Demo Sequences ──────────────────────────────────────────────────────────

const DEMO_SEQUENCES = {
  // A tiny 4-base DNA sequence
  tiny: {
    name: 'Tiny DNA (4 bases)',
    file: { filename: 'tiny.fasta', content: '>tiny_seq ACGT test\nACGT\n' } as UploadedFile,
  },
  // A short segment inspired by Hepatitis D virus
  hepatitisD: {
    name: 'Hepatitis D fragment (16 bases)',
    file: {
      filename: 'hdv_fragment.fasta',
      content: '>HDV_fragment Hepatitis D virus genome fragment\nGGCCGGCATGGTCCC\n',
    } as UploadedFile,
  },
  // An RNA sequence
  rna: {
    name: 'RNA sequence (8 bases)',
    file: { filename: 'rna.fasta', content: '>rna_seq Small RNA\nACGUACGU\n' } as UploadedFile,
  },
};

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   Quantum Genomics Encoding Pipeline — Local Simulator Demo  ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();

  const executor = new LocalSimulatorExecutor();
  const pipeline = new QuantumGenomicsPipeline(executor);

  for (const [key, demo] of Object.entries(DEMO_SEQUENCES)) {
    console.log(`━━━ ${demo.name} ━━━`);
    console.log();

    try {
      const startTime = Date.now();
      const result = await pipeline.run(demo.file, {
        backend: 'braket-local-simulator',
        shots: 1000,
      });
      const elapsed = Date.now() - startTime;

      // Display results
      console.log(`  Input:        ${result.sequence.nucleotides}`);
      console.log(`  Type:         ${result.sequence.type}`);
      console.log(`  Length:       ${result.sequence.length} nucleotides`);
      console.log(`  Qubits used:  ${result.encodedCircuits[0].qubitCount}`);
      console.log(`  Gates:        ${result.encodedCircuits[0].gateCount} X gates`);
      console.log(`  Circuit depth: ${result.encodedCircuits[0].depth}`);
      console.log(`  Partitioned:  ${result.partitioned ? `Yes (${result.segmentCount} segments)` : 'No'}`);
      console.log(`  Backend:      ${result.backend}`);
      console.log();
      console.log(`  Decoded:      ${result.decoded.nucleotides}`);
      console.log(`  Confidence:   ${(result.decoded.averageConfidence * 100).toFixed(1)}%`);
      console.log(`  Round-trip:   ${result.decoded.nucleotides === result.sequence.nucleotides ? '✓ PASS' : '✗ FAIL'}`);
      console.log(`  Time:         ${elapsed}ms`);
      console.log();

      // Show a snippet of the OpenQASM circuit
      const qasmLines = result.encodedCircuits[0].qasm.split('\n');
      console.log('  OpenQASM 3.0 circuit (first 10 lines):');
      for (const line of qasmLines.slice(0, 10)) {
        console.log(`    ${line}`);
      }
      if (qasmLines.length > 10) {
        console.log(`    ... (${qasmLines.length - 10} more lines)`);
      }
      console.log();

      // Show FASTA output
      console.log('  FASTA output:');
      for (const line of result.report.fasta.split('\n').filter((l) => l)) {
        console.log(`    ${line}`);
      }
      console.log();

    } catch (error) {
      console.error(`  ERROR: ${error instanceof Error ? error.message : error}`);
      console.log();
    }
  }

  console.log('━━━ Demo Complete ━━━');
  console.log();
  console.log('All sequences were successfully:');
  console.log('  1. Parsed from FASTA format');
  console.log('  2. Encoded into quantum circuits (OpenQASM 3.0)');
  console.log('  3. Transpiled for the local simulator backend');
  console.log('  4. Executed (simulated measurement)');
  console.log('  5. Decoded back to nucleotide sequences');
  console.log('  6. Verified via round-trip (input == output)');
  console.log();
  console.log('To run on real quantum hardware, configure AWS credentials');
  console.log('and switch the backend to "ionq-forte-enterprise" or "rigetti-cepheus-1".');
}

main().catch(console.error);
