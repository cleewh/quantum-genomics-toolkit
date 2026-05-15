/**
 * Encoding Engine implementation.
 * Converts nucleotide sequences to quantum circuits using configurable encoding schemes.
 */

import type {
  ParsedSequence,
  EncodingScheme,
  EncodedCircuit,
  MeasurementResult,
  DecodedSequence,
  Nucleotide,
} from '../types/index.js';
import { getDefaultEncodingScheme } from '../types/encoding-schemes.js';

/**
 * EncodingEngine interface as defined in the design document.
 */
export interface EncodingEngineInterface {
  encode(sequence: ParsedSequence, scheme?: EncodingScheme): Promise<EncodedCircuit>;
  decode(measurements: MeasurementResult, scheme: EncodingScheme): Promise<DecodedSequence>;
  serialize(circuit: EncodedCircuit): string;
  deserialize(qasm: string): EncodedCircuit;
}

/**
 * Result of encoding scheme validation.
 */
export interface SchemeValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Implementation of the EncodingEngine.
 * Currently implements encode(). decode(), serialize(), and deserialize() are stubs
 * to be implemented in subsequent tasks.
 */
export class EncodingEngine implements EncodingEngineInterface {
  /**
   * Validates an encoding scheme for correctness.
   *
   * Checks:
   * 1. All mapping values contain only '0' and '1' characters
   * 2. All mapping values have the same length (consistent with qubitsPerBase)
   * 3. All mapping values are unique (no two nucleotides map to the same bitstring)
   *
   * @param scheme - The encoding scheme to validate
   * @returns A validation result with `valid` boolean and `errors` array
   */
  validateScheme(scheme: EncodingScheme): SchemeValidationResult {
    const errors: string[] = [];
    const entries = Object.entries(scheme.mapping) as [string, string][];

    // Check for invalid characters in mappings
    for (const [nucleotide, bitstring] of entries) {
      if (!/^[01]+$/.test(bitstring)) {
        errors.push(
          `Invalid mapping characters: nucleotide '${nucleotide}' mapping '${bitstring}' contains non-binary characters`
        );
      }
    }

    // Check for inconsistent bit lengths
    for (const [nucleotide, bitstring] of entries) {
      if (bitstring.length !== scheme.qubitsPerBase) {
        errors.push(
          `Inconsistent bit length: nucleotide '${nucleotide}' has mapping '${bitstring}' (length ${bitstring.length}) but qubitsPerBase is ${scheme.qubitsPerBase}`
        );
      }
    }

    // Check for duplicate mappings
    const seen = new Map<string, string>();
    for (const [nucleotide, bitstring] of entries) {
      const existing = seen.get(bitstring);
      if (existing) {
        errors.push(
          `Duplicate mapping: nucleotides '${existing}' and '${nucleotide}' both map to '${bitstring}'`
        );
      } else {
        seen.set(bitstring, nucleotide);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
  /**
   * Encodes a nucleotide sequence into a quantum circuit using the provided encoding scheme.
   *
   * For each nucleotide in the sequence:
   * 1. Look up its bitstring in the scheme mapping
   * 2. For each bit that is '1', apply an X gate to the corresponding qubit
   *
   * The resulting circuit prepares the computational basis state representing the sequence.
   *
   * @param sequence - The parsed nucleotide sequence to encode
   * @param scheme - Optional encoding scheme (defaults to the appropriate scheme for the sequence type)
   * @returns An EncodedCircuit with OpenQASM 3.0 representation
   */
  async encode(sequence: ParsedSequence, scheme?: EncodingScheme): Promise<EncodedCircuit> {
    const encodingScheme = scheme ?? getDefaultEncodingScheme(sequence.type);

    // Validate custom scheme if one was provided
    if (scheme) {
      const validation = this.validateScheme(scheme);
      if (!validation.valid) {
        throw new Error(
          `Invalid encoding scheme '${scheme.name}': ${validation.errors.join('; ')}`
        );
      }
    }

    const qubitCount = sequence.length * encodingScheme.qubitsPerBase;

    // Collect X gate targets
    const xGateTargets: number[] = [];

    for (let i = 0; i < sequence.length; i++) {
      const nucleotide = sequence.nucleotides[i] as Nucleotide;
      const bitstring = encodingScheme.mapping[nucleotide];

      if (!bitstring) {
        throw new Error(
          `Unknown nucleotide '${nucleotide}' not found in encoding scheme '${encodingScheme.name}'`
        );
      }

      // Map each bit in the bitstring to the corresponding qubit
      for (let bit = 0; bit < bitstring.length; bit++) {
        if (bitstring[bit] === '1') {
          const qubitIndex = i * encodingScheme.qubitsPerBase + bit;
          xGateTargets.push(qubitIndex);
        }
      }
    }

    // Generate OpenQASM 3.0 circuit
    const qasm = generateOpenQASM(qubitCount, xGateTargets, encodingScheme);
    const gateCount = xGateTargets.length;
    // Depth is 1 if there are any gates (all X gates can be applied in parallel), 0 otherwise
    const depth = gateCount > 0 ? 1 : 0;

    return {
      qasm,
      qubitCount,
      gateCount,
      depth,
      scheme: encodingScheme,
      sourceSequenceId: sequence.id,
    };
  }

  /**
   * Decodes measurement results back into a nucleotide sequence.
   *
   * For each base position:
   * 1. Extract the relevant bits from each measurement bitstring
   * 2. Count how many shots produced each possible bit pattern
   * 3. The majority bit pattern determines the decoded nucleotide (reverse lookup)
   * 4. Confidence = count of majority pattern / totalShots
   *
   * @param measurements - The measurement results from quantum execution
   * @param scheme - The encoding scheme used during encoding
   * @returns A DecodedSequence with nucleotides, confidence scores, and flags
   */
  async decode(measurements: MeasurementResult, scheme: EncodingScheme): Promise<DecodedSequence> {
    const { bitstrings, totalShots } = measurements;
    const { qubitsPerBase, mapping } = scheme;

    // Build reverse mapping: bitstring → nucleotide
    // Use first-wins strategy so that T (DNA primary) takes precedence over U,
    // and U (RNA primary) takes precedence over T when listed first in the scheme.
    const reverseMapping: Record<string, Nucleotide> = {};
    for (const [nucleotide, bits] of Object.entries(mapping)) {
      if (!(bits in reverseMapping)) {
        reverseMapping[bits] = nucleotide as Nucleotide;
      }
    }

    // Determine number of bases from the bitstring length
    // All bitstrings should have the same length
    const bitstringKeys = Object.keys(bitstrings);
    if (bitstringKeys.length === 0) {
      return {
        nucleotides: '',
        perBaseConfidence: [],
        averageConfidence: 0,
        lowConfidenceFlag: true,
      };
    }

    const totalQubits = bitstringKeys[0].length;
    const numBases = Math.floor(totalQubits / qubitsPerBase);

    // For each base position, count occurrences of each bit pattern
    // patternCounts[baseIndex] = { pattern: count }
    const patternCounts: Record<string, number>[] = [];
    for (let i = 0; i < numBases; i++) {
      patternCounts.push({});
    }

    for (const [bitstring, count] of Object.entries(bitstrings)) {
      for (let baseIdx = 0; baseIdx < numBases; baseIdx++) {
        const startBit = baseIdx * qubitsPerBase;
        const pattern = bitstring.slice(startBit, startBit + qubitsPerBase);
        patternCounts[baseIdx][pattern] = (patternCounts[baseIdx][pattern] || 0) + count;
      }
    }

    // For each base position, find the majority pattern and decode
    const nucleotides: string[] = [];
    const perBaseConfidence: number[] = [];

    for (let baseIdx = 0; baseIdx < numBases; baseIdx++) {
      const counts = patternCounts[baseIdx];
      let majorityPattern = '';
      let majorityCount = 0;

      for (const [pattern, count] of Object.entries(counts)) {
        if (count > majorityCount) {
          majorityCount = count;
          majorityPattern = pattern;
        }
      }

      // Reverse lookup: find the nucleotide for this bit pattern
      const nucleotide = reverseMapping[majorityPattern];
      if (nucleotide) {
        nucleotides.push(nucleotide);
      } else {
        // If no mapping found, use 'N' as unknown
        nucleotides.push('N');
      }

      // Confidence = majority count / total shots
      const confidence = totalShots > 0 ? majorityCount / totalShots : 0;
      perBaseConfidence.push(confidence);
    }

    // Calculate average confidence
    const averageConfidence =
      perBaseConfidence.length > 0
        ? perBaseConfidence.reduce((sum, c) => sum + c, 0) / perBaseConfidence.length
        : 0;

    // Low confidence flag: true if average < 0.7
    const lowConfidenceFlag = averageConfidence < 0.7;

    return {
      nucleotides: nucleotides.join(''),
      perBaseConfidence,
      averageConfidence,
      lowConfidenceFlag,
    };
  }

  /**
   * Serializes an EncodedCircuit to OpenQASM 3.0 format string.
   *
   * If the circuit was produced by encode(), its qasm field already contains valid
   * OpenQASM 3.0 with scheme metadata comments. This method returns that directly.
   * If the circuit was created externally (missing metadata comments), it regenerates
   * proper OpenQASM with metadata.
   */
  serialize(circuit: EncodedCircuit): string {
    const { qasm, scheme } = circuit;

    // Check if the qasm already contains scheme metadata comments
    if (
      qasm.includes('// Encoding scheme:') &&
      qasm.includes('// Qubits per base:') &&
      qasm.includes('// Mapping:')
    ) {
      return qasm;
    }

    // If metadata is missing, inject it after the include statement
    const lines = qasm.split('\n');
    const result: string[] = [];
    let includeInserted = false;

    for (const line of lines) {
      result.push(line);
      if (!includeInserted && line.startsWith('include "stdgates.inc";')) {
        result.push('');
        result.push(`// Encoding scheme: ${scheme.name}`);
        result.push(`// Qubits per base: ${scheme.qubitsPerBase}`);
        result.push(`// Mapping: ${JSON.stringify(scheme.mapping)}`);
        includeInserted = true;
      }
    }

    // If no include statement was found, prepend metadata after header
    if (!includeInserted) {
      const headerIdx = result.findIndex((l) => l.startsWith('OPENQASM'));
      const insertIdx = headerIdx >= 0 ? headerIdx + 1 : 0;
      result.splice(
        insertIdx,
        0,
        '',
        `// Encoding scheme: ${scheme.name}`,
        `// Qubits per base: ${scheme.qubitsPerBase}`,
        `// Mapping: ${JSON.stringify(scheme.mapping)}`
      );
    }

    return result.join('\n');
  }

  /**
   * Deserializes an OpenQASM 3.0 string back into an EncodedCircuit.
   *
   * Parses the QASM string to extract:
   * - Qubit count from `qubit[N] q;` declaration
   * - Gate count from X gate statements
   * - Circuit depth (0 if no gates, 1 if any X gates present)
   * - Encoding scheme metadata from structured comments
   *
   * Throws descriptive parse errors with line numbers for invalid input.
   */
  deserialize(qasm: string): EncodedCircuit {
    const lines = qasm.split('\n');

    // Validate OPENQASM 3.0 header
    const firstNonEmptyLineIdx = lines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmptyLineIdx < 0 || !lines[firstNonEmptyLineIdx].trim().startsWith('OPENQASM 3.0;')) {
      const lineNum = firstNonEmptyLineIdx >= 0 ? firstNonEmptyLineIdx + 1 : 1;
      throw new Error(`Parse error at line ${lineNum}: Expected 'OPENQASM 3.0;' header`);
    }

    let qubitCount: number | null = null;
    let gateCount = 0;
    let schemeName: string | null = null;
    let qubitsPerBase: number | null = null;
    let mapping: Record<Nucleotide, string> | null = null;
    let sourceSequenceId = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const lineNum = i + 1;

      // Skip empty lines and comments (but parse metadata comments)
      if (line === '') continue;

      // Parse metadata comments
      if (line.startsWith('// Encoding scheme: ')) {
        schemeName = line.slice('// Encoding scheme: '.length);
        continue;
      }
      if (line.startsWith('// Qubits per base: ')) {
        const val = parseInt(line.slice('// Qubits per base: '.length), 10);
        if (!isNaN(val)) {
          qubitsPerBase = val;
        }
        continue;
      }
      if (line.startsWith('// Mapping: ')) {
        try {
          mapping = JSON.parse(line.slice('// Mapping: '.length)) as Record<Nucleotide, string>;
        } catch {
          // If mapping can't be parsed, leave it null
        }
        continue;
      }
      if (line.startsWith('//')) continue;

      // Parse OPENQASM header (already validated above)
      if (line.startsWith('OPENQASM')) continue;

      // Parse include statement
      if (line.startsWith('include')) continue;

      // Parse qubit register declaration
      const qubitMatch = line.match(/^qubit\[(\d+)\]\s+\w+;$/);
      if (qubitMatch) {
        qubitCount = parseInt(qubitMatch[1], 10);
        continue;
      }

      // Parse bit register declaration
      const bitMatch = line.match(/^bit\[(\d+)\]\s+\w+;$/);
      if (bitMatch) continue;

      // Parse X gate
      const xGateMatch = line.match(/^x\s+\w+\[\d+\];$/);
      if (xGateMatch) {
        gateCount++;
        continue;
      }

      // Parse measurement
      const measureMatch = line.match(/^\w+\s*=\s*measure\s+\w+;$/);
      if (measureMatch) continue;

      // If we reach here, the line has invalid syntax
      throw new Error(`Parse error at line ${lineNum}: Invalid gate syntax '${line}'`);
    }

    // Validate that we found a qubit declaration
    if (qubitCount === null) {
      throw new Error(
        `Parse error at line ${lines.length}: Missing qubit register declaration 'qubit[N] q;'`
      );
    }

    // Build the encoding scheme (use defaults if metadata not found)
    const scheme: EncodingScheme = {
      name: schemeName ?? 'unknown',
      qubitsPerBase: qubitsPerBase ?? 2,
      mapping: mapping ?? ({
        A: '00',
        C: '01',
        G: '10',
        T: '11',
        U: '11',
      } as Record<Nucleotide, string>),
    };

    // Depth is 1 if there are any gates, 0 otherwise
    const depth = gateCount > 0 ? 1 : 0;

    return {
      qasm,
      qubitCount,
      gateCount,
      depth,
      scheme,
      sourceSequenceId,
    };
  }
}

/**
 * Generates a valid OpenQASM 3.0 circuit string for basis state preparation.
 *
 * The circuit consists of:
 * - OPENQASM 3.0 header
 * - Standard gates include
 * - Qubit register declaration
 * - Classical bit register declaration
 * - X gates for each qubit that should be in the |1⟩ state
 * - Measurement of all qubits
 * - Encoding scheme metadata as comments
 */
function generateOpenQASM(
  qubitCount: number,
  xGateTargets: number[],
  scheme: EncodingScheme
): string {
  const lines: string[] = [];

  // Header
  lines.push('OPENQASM 3.0;');
  lines.push('include "stdgates.inc";');
  lines.push('');

  // Scheme metadata as comments
  lines.push(`// Encoding scheme: ${scheme.name}`);
  lines.push(`// Qubits per base: ${scheme.qubitsPerBase}`);
  lines.push(`// Mapping: ${JSON.stringify(scheme.mapping)}`);
  lines.push('');

  // Register declarations
  lines.push(`qubit[${qubitCount}] q;`);
  lines.push(`bit[${qubitCount}] c;`);
  lines.push('');

  // X gates for basis state preparation
  for (const target of xGateTargets) {
    lines.push(`x q[${target}];`);
  }

  if (xGateTargets.length > 0) {
    lines.push('');
  }

  // Measurement
  lines.push('c = measure q;');

  return lines.join('\n');
}
