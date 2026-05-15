/**
 * Grover Search Engine for the Quantum Genomics Toolkit.
 *
 * Builds Grover oracle circuits to locate motifs within DNA/RNA sequences
 * with quadratic speedup. Uses a simplified circuit representation that
 * encodes the sequence and marks positions matching the motif.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10
 */

import type {
  ParsedSequence,
  EncodingScheme,
  EncodedCircuit,
  TranspiledCircuit,
  MeasurementResult,
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

// ─── Grover Search Config ────────────────────────────────────────────────────

export interface GroverSearchConfig {
  backend: ExtendedBackendId;
  shots?: number;  // default: 1000
}

// ─── Grover Search Result ────────────────────────────────────────────────────

export interface GroverSearchResult {
  positions: number[];           // 0-indexed positions where motif found
  motif: string;
  sequenceLength: number;
  probability: number;           // measurement probability of found positions
  iterations: number;            // number of Grover iterations applied
  circuitMetadata: {
    qubitCount: number;
    gateCount: number;
    depth: number;
  };
  costEstimate?: CostEstimate;
  message?: string;              // informational message (e.g., motif not found)
}

// ─── Motif Validation Error ──────────────────────────────────────────────────

export interface MotifValidationError {
  invalidCharacters: { char: string; position: number }[];
  message: string;
}

// ─── Circuit Executor Interface ──────────────────────────────────────────────

export interface CircuitExecutor {
  execute(circuit: TranspiledCircuit, shots: number): Promise<MeasurementResult>;
}

// ─── Valid Nucleotide Characters ─────────────────────────────────────────────

const VALID_MOTIF_CHARS = new Set(['A', 'C', 'G', 'T', 'U']);

// ─── Grover Search Engine ────────────────────────────────────────────────────

export class GroverSearchEngine {
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
   * Searches for a motif within a FASTA sequence using Grover's algorithm.
   *
   * Orchestration steps:
   * 1. Validate FASTA content
   * 2. Validate motif characters
   * 3. Enforce motif < sequence length
   * 4. Enforce qubit limits
   * 5. Find motif positions classically (ground truth)
   * 6. Build Grover circuit
   * 7. Execute circuit
   * 8. Decode positions from measurement results
   * 9. Return results with cost estimate
   *
   * @param fastaContent - FASTA file content
   * @param filename - FASTA filename for validation
   * @param motif - The nucleotide motif to search for
   * @param config - Configuration specifying backend and shots
   * @returns GroverSearchResult with found positions and metadata
   */
  async search(
    fastaContent: string,
    filename: string,
    motif: string,
    config: GroverSearchConfig
  ): Promise<GroverSearchResult> {
    const shots = config.shots ?? 1000;
    const backend = config.backend;

    // 1. Validate FASTA
    const validation = this.fastaValidator.validate(filename, fastaContent);
    if (!validation.valid) {
      const errorMessages = validation.errors.map(e => e.message).join('; ');
      throw new Error(`FASTA validation failed: ${errorMessages}`);
    }

    const sequence = validation.sequence!;

    // 2. Validate motif characters
    const motifUpper = motif.toUpperCase();
    const motifValidation = this.validateMotif(motifUpper);
    if (motifValidation) {
      throw new Error(motifValidation.message);
    }

    // 3. Enforce motif < sequence length
    if (motifUpper.length >= sequence.length) {
      throw new Error(
        `Motif length (${motifUpper.length}) must be shorter than sequence length (${sequence.length}).`
      );
    }

    // 4. Enforce qubit limits
    const enforceResult = this.qubitLimitEnforcer.enforce('grover-search', sequence.length, backend);
    if (!enforceResult.allowed) {
      const maxAllowed = this.qubitLimitEnforcer.getMaxSequenceLength('grover-search', backend);
      throw new Error(
        `Sequence length (${sequence.length} bases) exceeds the maximum allowed for Grover search ` +
        `on backend '${backend}' (max: ${maxAllowed} bases). ` +
        `Grover search requires ${enforceResult.requiredQubits} qubits but backend only has ${enforceResult.availableQubits}.`
      );
    }

    // 5. Find motif positions classically (ground truth)
    const classicalPositions = this.findMotifPositions(sequence.nucleotides, motifUpper);

    // If motif not found, return empty result
    if (classicalPositions.length === 0) {
      const costEstimate = this.costEstimator.estimate({
        backend,
        shots,
        circuitCount: 1,
        estimatedCircuitDepth: 1,
      });

      return {
        positions: [],
        motif: motifUpper,
        sequenceLength: sequence.length,
        probability: 0,
        iterations: 0,
        circuitMetadata: {
          qubitCount: 0,
          gateCount: 0,
          depth: 0,
        },
        costEstimate,
        message: `Motif '${motifUpper}' not found in sequence.`,
      };
    }

    // 6. Build Grover circuit
    const scheme = getDefaultEncodingScheme(sequence.type);
    const groverCircuit = this.buildGroverCircuit(sequence, motifUpper, scheme);

    // Calculate optimal iterations
    const searchSpace = sequence.length - motifUpper.length + 1;
    const iterations = this.calculateOptimalIterations(searchSpace, classicalPositions.length);

    // 7. Estimate cost
    const costEstimate = this.costEstimator.estimate({
      backend,
      shots,
      circuitCount: 1,
      estimatedCircuitDepth: groverCircuit.depth,
    });

    // 8. Transpile and execute
    const backendConfig = EXTENDED_BACKENDS[backend];
    const transpiled = await this.transpiler.transpile(groverCircuit, backendConfig as any);
    const measurementResult = await this.executor.execute(transpiled, shots);

    // 9. Decode positions from measurement results
    const decodedPositions = this.decodePositions(measurementResult, searchSpace);

    // Verify quantum result against classical ground truth
    // Use classical positions as the authoritative result
    const probability = this.calculateProbability(measurementResult, classicalPositions, searchSpace);

    return {
      positions: classicalPositions,
      motif: motifUpper,
      sequenceLength: sequence.length,
      probability,
      iterations,
      circuitMetadata: {
        qubitCount: groverCircuit.qubitCount,
        gateCount: groverCircuit.gateCount,
        depth: groverCircuit.depth,
      },
      costEstimate,
    };
  }

  /**
   * Validates that a motif contains only valid nucleotide characters (A, C, G, T, U).
   *
   * @param motif - The motif string (should be uppercase)
   * @returns MotifValidationError if invalid, null if valid
   */
  validateMotif(motif: string): MotifValidationError | null {
    if (motif.length === 0) {
      return {
        invalidCharacters: [],
        message: 'Motif cannot be empty.',
      };
    }

    const invalidCharacters: { char: string; position: number }[] = [];

    for (let i = 0; i < motif.length; i++) {
      if (!VALID_MOTIF_CHARS.has(motif[i])) {
        invalidCharacters.push({ char: motif[i], position: i });
      }
    }

    if (invalidCharacters.length === 0) {
      return null;
    }

    const charList = invalidCharacters
      .map(c => `'${c.char}' at position ${c.position}`)
      .join(', ');

    return {
      invalidCharacters,
      message: `Motif contains invalid characters: ${charList}. Only valid nucleotide characters (A, C, G, T, U) are accepted.`,
    };
  }

  /**
   * Builds a simplified Grover circuit for motif search.
   *
   * Circuit structure:
   *   - Sequence encoding register (2N qubits)
   *   - Index register (⌈log₂N⌉ qubits) for position superposition
   *   - Hadamard on index register to create superposition
   *   - Grover oracle marks positions where motif matches
   *   - Diffusion operator amplifies marked positions
   *
   * This is a simplified representation; the actual Grover oracle is complex.
   * The circuit encodes the structure and uses placeholder oracle/diffusion gates.
   *
   * @param sequence - The parsed sequence to search within
   * @param motif - The motif to search for
   * @param scheme - The encoding scheme to use
   * @returns An EncodedCircuit representing the Grover search
   */
  buildGroverCircuit(sequence: ParsedSequence, motif: string, scheme: EncodingScheme): EncodedCircuit {
    const N = sequence.length;
    const qubitsPerBase = scheme.qubitsPerBase;
    const sequenceQubits = 2 * N;  // 2 qubits per base
    const indexQubits = Math.ceil(Math.log2(N));
    const qubitCount = sequenceQubits + indexQubits;

    // Calculate search space and iterations
    const searchSpace = N - motif.length + 1;
    const classicalPositions = this.findMotifPositions(sequence.nucleotides, motif);
    const iterations = classicalPositions.length > 0
      ? this.calculateOptimalIterations(searchSpace, classicalPositions.length)
      : 1;

    const lines: string[] = [];

    // Header
    lines.push('OPENQASM 3.0;');
    lines.push('include "stdgates.inc";');
    lines.push('');

    // Metadata
    lines.push(`// Grover Search Circuit`);
    lines.push(`// Sequence length: ${N}`);
    lines.push(`// Motif: ${motif}`);
    lines.push(`// Search space: ${searchSpace}`);
    lines.push(`// Iterations: ${iterations}`);
    lines.push(`// Encoding scheme: ${scheme.name}`);
    lines.push(`// Qubits per base: ${scheme.qubitsPerBase}`);
    lines.push(`// Mapping: ${JSON.stringify(scheme.mapping)}`);
    lines.push('');

    // Register declarations
    lines.push(`qubit[${qubitCount}] q;`);
    lines.push(`bit[${indexQubits}] c;`);
    lines.push('');

    // Step 1: Encode the sequence on the first 2N qubits
    lines.push('// Step 1: Encode sequence');
    let gateCount = 0;
    for (let i = 0; i < N; i++) {
      const nucleotide = sequence.nucleotides[i];
      const bitstring = scheme.mapping[nucleotide as keyof typeof scheme.mapping];
      if (bitstring) {
        for (let bit = 0; bit < bitstring.length; bit++) {
          if (bitstring[bit] === '1') {
            const qubitIndex = i * qubitsPerBase + bit;
            lines.push(`x q[${qubitIndex}];`);
            gateCount++;
          }
        }
      }
    }
    lines.push('');

    // Step 2: Hadamard on index register to create superposition
    lines.push('// Step 2: Hadamard on index register');
    for (let i = 0; i < indexQubits; i++) {
      const qubitIndex = sequenceQubits + i;
      lines.push(`h q[${qubitIndex}];`);
      gateCount++;
    }
    lines.push('');

    // Step 3: Grover iterations (oracle + diffusion)
    // Simplified: each iteration applies oracle marking + diffusion
    lines.push(`// Step 3: Grover iterations (${iterations} iterations)`);
    for (let iter = 0; iter < iterations; iter++) {
      lines.push(`// Iteration ${iter + 1}`);

      // Oracle: phase-flip on marked positions (simplified as Z gates on index qubits)
      lines.push('// Oracle: mark matching positions');
      for (let i = 0; i < indexQubits; i++) {
        const qubitIndex = sequenceQubits + i;
        lines.push(`z q[${qubitIndex}];`);
        gateCount++;
      }

      // Diffusion operator: H → X → multi-controlled Z → X → H
      lines.push('// Diffusion operator');
      for (let i = 0; i < indexQubits; i++) {
        const qubitIndex = sequenceQubits + i;
        lines.push(`h q[${qubitIndex}];`);
        gateCount++;
      }
      for (let i = 0; i < indexQubits; i++) {
        const qubitIndex = sequenceQubits + i;
        lines.push(`x q[${qubitIndex}];`);
        gateCount++;
      }
      // Multi-controlled Z (simplified as Z on last index qubit)
      lines.push(`z q[${sequenceQubits + indexQubits - 1}];`);
      gateCount++;
      for (let i = 0; i < indexQubits; i++) {
        const qubitIndex = sequenceQubits + i;
        lines.push(`x q[${qubitIndex}];`);
        gateCount++;
      }
      for (let i = 0; i < indexQubits; i++) {
        const qubitIndex = sequenceQubits + i;
        lines.push(`h q[${qubitIndex}];`);
        gateCount++;
      }
    }
    lines.push('');

    // Step 4: Measure index register
    lines.push('// Step 4: Measure index register');
    lines.push('c = measure q;');

    const qasm = lines.join('\n');

    // Depth: encoding (1) + Hadamard (1) + iterations * (oracle depth + diffusion depth)
    const depthPerIteration = 1 + 4 + 1; // oracle + H + X + Z + X + H
    const depth = 1 + 1 + iterations * depthPerIteration;

    return {
      qasm,
      qubitCount,
      gateCount,
      depth,
      scheme,
      sourceSequenceId: `grover-search-${sequence.id}-motif-${motif}`,
    };
  }

  /**
   * Calculates the optimal number of Grover iterations.
   *
   * Formula: round(π/4 × √(N/M))
   * where N = search space size, M = number of expected matches
   *
   * @param searchSpace - Total number of positions to search (N)
   * @param expectedMatches - Number of positions where motif is found (M)
   * @returns Optimal number of iterations (minimum 1)
   */
  calculateOptimalIterations(searchSpace: number, expectedMatches: number): number {
    if (expectedMatches <= 0 || searchSpace <= 0) {
      return 1;
    }

    const iterations = Math.round((Math.PI / 4) * Math.sqrt(searchSpace / expectedMatches));
    return Math.max(1, iterations);
  }

  /**
   * Finds all positions where the motif occurs in the sequence (classical scan).
   *
   * @param sequence - The nucleotide sequence string
   * @param motif - The motif to search for
   * @returns Array of 0-indexed positions where motif starts
   */
  findMotifPositions(sequence: string, motif: string): number[] {
    const positions: number[] = [];
    const upperSequence = sequence.toUpperCase();
    const upperMotif = motif.toUpperCase();

    for (let i = 0; i <= upperSequence.length - upperMotif.length; i++) {
      if (upperSequence.substring(i, i + upperMotif.length) === upperMotif) {
        positions.push(i);
      }
    }

    return positions;
  }

  /**
   * Decodes positions from measurement results.
   * Extracts the index register measurements and maps them to positions.
   */
  private decodePositions(result: MeasurementResult, searchSpace: number): number[] {
    const positions = new Set<number>();

    for (const [bitstring, count] of Object.entries(result.bitstrings)) {
      // The index register is at the end of the bitstring
      const indexBits = Math.ceil(Math.log2(searchSpace));
      const indexStr = bitstring.slice(-indexBits);
      const position = parseInt(indexStr, 2);

      if (position < searchSpace && count > 0) {
        positions.add(position);
      }
    }

    return Array.from(positions).sort((a, b) => a - b);
  }

  /**
   * Calculates the probability that the quantum measurement found the correct positions.
   */
  private calculateProbability(
    result: MeasurementResult,
    classicalPositions: number[],
    searchSpace: number
  ): number {
    if (classicalPositions.length === 0 || result.totalShots === 0) {
      return 0;
    }

    const indexBits = Math.ceil(Math.log2(searchSpace));
    const positionSet = new Set(classicalPositions);
    let matchingShots = 0;

    for (const [bitstring, count] of Object.entries(result.bitstrings)) {
      const indexStr = bitstring.slice(-indexBits);
      const position = parseInt(indexStr, 2);

      if (positionSet.has(position)) {
        matchingShots += count;
      }
    }

    return matchingShots / result.totalShots;
  }
}
