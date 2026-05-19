/**
 * SWAP Test Comparator for the Quantum Genomics Toolkit.
 *
 * Constructs and executes SWAP test circuits for pairwise sequence similarity.
 * Uses an ancilla-based destructive SWAP test (4N+1 qubits):
 *   H on ancilla → encode sequences → controlled-SWAP gates → H on ancilla → measure ancilla
 *
 * Similarity formula: similarity = 2·P(|0⟩) - 1
 *   - Identical sequences: P(|0⟩) = 1, similarity = 1
 *   - Orthogonal sequences: P(|0⟩) = 0.5, similarity = 0
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10
 */

import type {
  ParsedSequence,
  EncodingScheme,
  EncodedCircuit,
  TranspiledCircuit,
  MeasurementResult,
  Nucleotide,
} from '../../types/index.js';
import { getDefaultEncodingScheme } from '../../types/encoding-schemes.js';
import { FastaValidator } from '../validators/fasta-validator.js';
import { QubitLimitEnforcer } from '../qubit-limits.js';
import { CostEstimator } from '../cost-estimator/cost-estimator.js';
import { CircuitTranspiler } from '../../transpiler/circuit-transpiler.js';
import {
  ExtendedBackendId,
  EXTENDED_BACKENDS,
  CostEstimate,
} from '../types.js';

// ─── SWAP Test Config ────────────────────────────────────────────────────────

export interface SwapTestConfig {
  backend: ExtendedBackendId;
  shots?: number;  // default: 1000
}

// ─── SWAP Test Result ────────────────────────────────────────────────────────

export interface SwapTestResult {
  similarityScore: number;       // 0 to 1
  ancillaMeasurements: Record<string, number>;  // '0' and '1' counts
  totalShots: number;
  sequenceA: ParsedSequence;
  sequenceB: ParsedSequence;
  circuitMetadata: {
    qubitCount: number;
    gateCount: number;
    depth: number;
  };
  costEstimate?: CostEstimate;
}

// ─── Circuit Executor Interface ──────────────────────────────────────────────

export interface CircuitExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

// ─── SWAP Test Comparator ────────────────────────────────────────────────────

export class SwapTestComparator {
  private fastaValidator: FastaValidator;
  private qubitLimitEnforcer: QubitLimitEnforcer;
  private costEstimator: CostEstimator;
  private transpiler: CircuitTranspiler;
  private executor: CircuitExecutor;

  constructor(executor: CircuitExecutor) {
    this.fastaValidator = new FastaValidator();
    this.qubitLimitEnforcer = new QubitLimitEnforcer();
    this.costEstimator = new CostEstimator();
    this.transpiler = new CircuitTranspiler();
    this.executor = executor;
  }

  /**
   * Compares two sequences using a quantum SWAP test.
   *
   * @param contentA - FASTA content for sequence A
   * @param filenameA - Filename for sequence A
   * @param contentB - FASTA content for sequence B
   * @param filenameB - Filename for sequence B
   * @param config - Configuration specifying backend and shots
   * @returns A SwapTestResult with similarity score and metadata
   */
  async compare(
    contentA: string,
    filenameA: string,
    contentB: string,
    filenameB: string,
    config: SwapTestConfig
  ): Promise<SwapTestResult> {
    const shots = config.shots ?? 1000;
    const backend = config.backend;

    // 1. Validate both FASTA files
    const validationA = this.fastaValidator.validate(filenameA, contentA);
    if (!validationA.valid) {
      const errorMessages = validationA.errors.map(e => e.message).join('; ');
      throw new Error(`FASTA validation failed for file A: ${errorMessages}`);
    }

    const validationB = this.fastaValidator.validate(filenameB, contentB);
    if (!validationB.valid) {
      const errorMessages = validationB.errors.map(e => e.message).join('; ');
      throw new Error(`FASTA validation failed for file B: ${errorMessages}`);
    }

    const seqA = validationA.sequence!;
    const seqB = validationB.sequence!;

    // 2. Check equal length
    if (seqA.length !== seqB.length) {
      throw new Error(
        `SWAP test requires sequences of equal length. ` +
        `Sequence A has length ${seqA.length}, sequence B has length ${seqB.length}.`
      );
    }

    // 3. Enforce qubit limits for swap-test operation
    const enforceResult = this.qubitLimitEnforcer.enforce('swap-test', seqA.length, backend);
    if (!enforceResult.allowed) {
      const maxAllowed = this.qubitLimitEnforcer.getMaxSequenceLength('swap-test', backend);
      throw new Error(
        `Sequence length (${seqA.length} bases) exceeds the maximum allowed for SWAP test ` +
        `on backend '${backend}' (max: ${maxAllowed} bases per sequence). ` +
        `SWAP test requires ${enforceResult.requiredQubits} qubits but backend only has ${enforceResult.availableQubits}.`
      );
    }

    // 4. Determine encoding scheme
    const scheme = getDefaultEncodingScheme(seqA.type);

    // 5. Build SWAP test circuit
    const swapCircuit = this.buildSwapTestCircuit(seqA, seqB, scheme);

    // 6. Estimate cost
    const costEstimate = this.costEstimator.estimate({
      backend,
      shots,
      circuitCount: 1,
      estimatedCircuitDepth: swapCircuit.depth,
    });

    // 7. Transpile
    const backendConfig = EXTENDED_BACKENDS[backend];
    const transpiled = await this.transpiler.transpile(swapCircuit, backendConfig as any);

    // 8. Execute
    const measurementResult = await this.executor.execute(transpiled, shots);

    // 9. Calculate similarity from ancilla measurements
    const ancillaMeasurements = this.extractAncillaMeasurements(measurementResult);
    const similarityScore = this.calculateSimilarity(ancillaMeasurements, shots);

    return {
      similarityScore,
      ancillaMeasurements,
      totalShots: shots,
      sequenceA: seqA,
      sequenceB: seqB,
      circuitMetadata: {
        qubitCount: swapCircuit.qubitCount,
        gateCount: swapCircuit.gateCount,
        depth: swapCircuit.depth,
      },
      costEstimate,
    };
  }

  /**
   * Builds a SWAP test circuit for two sequences.
   *
   * Circuit structure (4N+1 qubits):
   *   Qubit layout: [ancilla (1)] [seq A (2N)] [seq B (2N)]
   *   1. H gate on ancilla (qubit 0)
   *   2. Encode sequence A on qubits 1 to 2N (using X gates)
   *   3. Encode sequence B on qubits 2N+1 to 4N (using X gates)
   *   4. Controlled-SWAP gates: for each pair (qubit i in A, qubit i in B), CSWAP controlled by ancilla
   *   5. H gate on ancilla
   *   6. Measure ancilla only
   *
   * @param seqA - First parsed sequence
   * @param seqB - Second parsed sequence
   * @param scheme - Encoding scheme to use
   * @returns An EncodedCircuit representing the SWAP test
   */
  buildSwapTestCircuit(seqA: ParsedSequence, seqB: ParsedSequence, scheme: EncodingScheme): EncodedCircuit {
    const N = seqA.length;
    const qubitsPerBase = scheme.qubitsPerBase;
    const totalQubits = 4 * N * qubitsPerBase / 2 + 1;
    // Actually: 2N qubits for seq A + 2N qubits for seq B + 1 ancilla = 4N + 1
    // where N is sequence length and each base uses 2 qubits
    const qubitCount = 4 * N + 1;

    const lines: string[] = [];

    // Header
    lines.push('OPENQASM 3.0;');
    lines.push('include "stdgates.inc";');
    lines.push('');

    // Metadata
    lines.push(`// SWAP Test Circuit`);
    lines.push(`// Sequence length: ${N}`);
    lines.push(`// Encoding scheme: ${scheme.name}`);
    lines.push(`// Qubits per base: ${scheme.qubitsPerBase}`);
    lines.push(`// Mapping: ${JSON.stringify(scheme.mapping)}`);
    lines.push('');

    // Register declarations
    lines.push(`qubit[${qubitCount}] q;`);
    lines.push(`bit[${qubitCount}] c;`);
    lines.push('');

    // Step 1: H gate on ancilla (qubit 0)
    lines.push('// Step 1: Hadamard on ancilla');
    lines.push('h q[0];');
    lines.push('');

    // Step 2: Encode sequence A on qubits 1 to 2N
    lines.push('// Step 2: Encode sequence A');
    let gateCount = 1; // H gate
    const seqAStartQubit = 1;
    for (let i = 0; i < N; i++) {
      const nucleotide = seqA.nucleotides[i] as Nucleotide;
      const bitstring = scheme.mapping[nucleotide];
      for (let bit = 0; bit < bitstring.length; bit++) {
        if (bitstring[bit] === '1') {
          const qubitIndex = seqAStartQubit + i * qubitsPerBase + bit;
          lines.push(`x q[${qubitIndex}];`);
          gateCount++;
        }
      }
    }
    lines.push('');

    // Step 3: Encode sequence B on qubits 2N+1 to 4N
    lines.push('// Step 3: Encode sequence B');
    const seqBStartQubit = 1 + 2 * N;
    for (let i = 0; i < N; i++) {
      const nucleotide = seqB.nucleotides[i] as Nucleotide;
      const bitstring = scheme.mapping[nucleotide];
      for (let bit = 0; bit < bitstring.length; bit++) {
        if (bitstring[bit] === '1') {
          const qubitIndex = seqBStartQubit + i * qubitsPerBase + bit;
          lines.push(`x q[${qubitIndex}];`);
          gateCount++;
        }
      }
    }
    lines.push('');

    // Step 4: Controlled-SWAP gates
    // For each pair of qubits (one from A, one from B), apply CSWAP controlled by ancilla
    lines.push('// Step 4: Controlled-SWAP gates');
    const totalDataQubitsPerSeq = 2 * N;
    for (let i = 0; i < totalDataQubitsPerSeq; i++) {
      const qubitA = seqAStartQubit + i;
      const qubitB = seqBStartQubit + i;
      // CSWAP decomposition: Toffoli-based
      // CSWAP(control, a, b) = CX(b, a) + Toffoli(control, a, b) + CX(b, a)
      // Simplified for QASM: use cx gates
      lines.push(`cx q[${qubitB}], q[${qubitA}];`);
      // Toffoli(control=0, target1=qubitA, target2=qubitB)
      // Decompose Toffoli into: H target, CX(target1, target), T† target, CX(control, target), T target, CX(target1, target), T† target, CX(control, target), T target1, T target, H target, CX(control, target1), T control, T† target1, CX(control, target1)
      // For simplicity, use a standard Toffoli decomposition with cx and single-qubit gates
      lines.push(`h q[${qubitB}];`);
      lines.push(`cx q[${qubitA}], q[${qubitB}];`);
      lines.push(`t q[${qubitB}];`);
      lines.push(`cx q[0], q[${qubitB}];`);
      lines.push(`t q[${qubitB}];`);
      lines.push(`cx q[${qubitA}], q[${qubitB}];`);
      lines.push(`t q[${qubitB}];`);
      lines.push(`cx q[0], q[${qubitB}];`);
      lines.push(`t q[${qubitA}];`);
      lines.push(`t q[${qubitB}];`);
      lines.push(`h q[${qubitB}];`);
      lines.push(`cx q[0], q[${qubitA}];`);
      lines.push(`t q[0];`);
      lines.push(`t q[${qubitA}];`);
      lines.push(`cx q[0], q[${qubitA}];`);
      lines.push(`cx q[${qubitB}], q[${qubitA}];`);
      // Each CSWAP = 2 CX + Toffoli decomposition
      gateCount += 15; // approximate gate count per CSWAP
    }
    lines.push('');

    // Step 5: H gate on ancilla
    lines.push('// Step 5: Hadamard on ancilla');
    lines.push('h q[0];');
    gateCount++;
    lines.push('');

    // Step 6: Measure all qubits (SV1 requires all qubits measured; we use ancilla bit for similarity)
    lines.push('// Step 6: Measure all qubits');
    lines.push('c = measure q;');

    const qasm = lines.join('\n');

    // Depth estimation: encoding is 1 layer, CSWAP is ~15 layers per pair, + 2 H gates
    const depth = 2 + 1 + totalDataQubitsPerSeq * 15;

    return {
      qasm,
      qubitCount,
      gateCount,
      depth,
      scheme,
      sourceSequenceId: `swap-test-${seqA.id}-vs-${seqB.id}`,
    };
  }

  /**
   * Calculates similarity from ancilla measurement results.
   *
   * Formula: similarity = 2·P(|0⟩) - 1
   *   - P(|0⟩) = count of '0' measurements / totalShots
   *   - For identical sequences: P(|0⟩) = 1, similarity = 1
   *   - For orthogonal sequences: P(|0⟩) = 0.5, similarity = 0
   *
   * @param measurements - Record of ancilla measurement outcomes ('0' and '1' counts)
   * @param totalShots - Total number of measurement shots
   * @returns Similarity score between 0 and 1
   */
  calculateSimilarity(measurements: Record<string, number>, totalShots: number): number {
    if (totalShots === 0) return 0;

    const zeroCount = measurements['0'] ?? 0;
    const pZero = zeroCount / totalShots;
    const similarity = 2 * pZero - 1;

    // Clamp to [0, 1] to handle statistical noise
    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Extracts ancilla qubit measurements from the full measurement result.
   * The ancilla is qubit 0, so we look at the first bit of each bitstring.
   */
  private extractAncillaMeasurements(result: MeasurementResult): Record<string, number> {
    const ancillaCounts: Record<string, number> = { '0': 0, '1': 0 };

    for (const [bitstring, count] of Object.entries(result.bitstrings)) {
      // The ancilla is the first qubit (index 0), which is the first character in the bitstring
      const ancillaBit = bitstring[0];
      if (ancillaBit === '0') {
        ancillaCounts['0'] += count;
      } else {
        ancillaCounts['1'] += count;
      }
    }

    return ancillaCounts;
  }
}
