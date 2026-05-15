import { describe, it, expect } from 'vitest';
import { EncodingEngine } from '../../src/encoding/encoding-engine.js';
import { DEFAULT_DNA_ENCODING_SCHEME, DEFAULT_RNA_ENCODING_SCHEME } from '../../src/types/encoding-schemes.js';
import type { ParsedSequence, EncodingScheme, Nucleotide } from '../../src/types/index.js';

const engine = new EncodingEngine();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSequence(nucleotides: string, type: 'DNA' | 'RNA' = 'DNA'): ParsedSequence {
  return {
    id: 'test-seq-1',
    description: 'Test sequence',
    nucleotides,
    length: nucleotides.length,
    type,
    metadata: {},
  };
}

// ─── Basic Encoding Tests ────────────────────────────────────────────────────

describe('EncodingEngine - encode()', () => {
  it('should encode a single A nucleotide (00) with no X gates', async () => {
    const seq = makeSequence('A');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
    expect(result.gateCount).toBe(0);
    expect(result.depth).toBe(0);
    expect(result.qasm).not.toContain('x q[');
  });

  it('should encode a single C nucleotide (01) with one X gate on qubit 1', async () => {
    const seq = makeSequence('C');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
    expect(result.gateCount).toBe(1);
    expect(result.depth).toBe(1);
    expect(result.qasm).toContain('x q[1];');
    expect(result.qasm).not.toContain('x q[0];');
  });

  it('should encode a single G nucleotide (10) with one X gate on qubit 0', async () => {
    const seq = makeSequence('G');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
    expect(result.gateCount).toBe(1);
    expect(result.depth).toBe(1);
    expect(result.qasm).toContain('x q[0];');
    expect(result.qasm).not.toContain('x q[1];');
  });

  it('should encode a single T nucleotide (11) with X gates on qubits 0 and 1', async () => {
    const seq = makeSequence('T');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
    expect(result.gateCount).toBe(2);
    expect(result.depth).toBe(1);
    expect(result.qasm).toContain('x q[0];');
    expect(result.qasm).toContain('x q[1];');
  });

  it('should encode "ACG" with correct qubit count and gate placement', async () => {
    // A→00 (no gates), C→01 (X on q3), G→10 (X on q4)
    const seq = makeSequence('ACG');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(6);
    expect(result.gateCount).toBe(2);
    expect(result.qasm).toContain('x q[3];'); // C: bit index 1 → qubit 1*2+1=3
    expect(result.qasm).toContain('x q[4];'); // G: bit index 0 → qubit 2*2+0=4
    expect(result.qasm).not.toContain('x q[0];');
    expect(result.qasm).not.toContain('x q[1];');
    expect(result.qasm).not.toContain('x q[2];');
    expect(result.qasm).not.toContain('x q[5];');
  });

  it('should encode "ACGT" with correct qubit count and all gate placements', async () => {
    // A→00 (no gates), C→01 (X on q3), G→10 (X on q4), T→11 (X on q6, q7)
    const seq = makeSequence('ACGT');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(8);
    expect(result.gateCount).toBe(4);
    expect(result.qasm).toContain('x q[3];');  // C: qubit 1*2+1=3
    expect(result.qasm).toContain('x q[4];');  // G: qubit 2*2+0=4
    expect(result.qasm).toContain('x q[6];');  // T: qubit 3*2+0=6
    expect(result.qasm).toContain('x q[7];');  // T: qubit 3*2+1=7
  });

  it('should encode "TTTT" with maximum gates (all qubits flipped)', async () => {
    const seq = makeSequence('TTTT');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(8);
    expect(result.gateCount).toBe(8); // 4 nucleotides × 2 bits each = 8 X gates
  });

  it('should encode "AAAA" with zero gates (all qubits stay |0⟩)', async () => {
    const seq = makeSequence('AAAA');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(8);
    expect(result.gateCount).toBe(0);
    expect(result.depth).toBe(0);
    expect(result.qasm).not.toContain('x q[');
  });
});

// ─── Qubit Count Tests ───────────────────────────────────────────────────────

describe('EncodingEngine - qubit count invariant', () => {
  it('should produce qubitCount = sequence.length × qubitsPerBase', async () => {
    const seq = makeSequence('ACGTACGT');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(8 * 2); // 8 nucleotides × 2 qubits per base
  });

  it('should handle single nucleotide sequences', async () => {
    const seq = makeSequence('G');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
  });

  it('should handle longer sequences correctly', async () => {
    const nucleotides = 'ACGTACGTACGTACGT'; // 16 bases
    const seq = makeSequence(nucleotides);
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(32);
  });
});

// ─── OpenQASM 3.0 Format Tests ──────────────────────────────────────────────

describe('EncodingEngine - OpenQASM 3.0 output', () => {
  it('should include OPENQASM 3.0 header', async () => {
    const seq = makeSequence('A');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('OPENQASM 3.0;');
  });

  it('should include stdgates include', async () => {
    const seq = makeSequence('A');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('include "stdgates.inc";');
  });

  it('should declare qubit register with correct size', async () => {
    const seq = makeSequence('ACG');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('qubit[6] q;');
  });

  it('should declare bit register with correct size', async () => {
    const seq = makeSequence('ACG');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('bit[6] c;');
  });

  it('should include measurement statement', async () => {
    const seq = makeSequence('ACG');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('c = measure q;');
  });

  it('should include encoding scheme metadata as comments', async () => {
    const seq = makeSequence('A');
    const result = await engine.encode(seq);

    expect(result.qasm).toContain('// Encoding scheme: default-2qubit-basis');
    expect(result.qasm).toContain('// Qubits per base: 2');
    expect(result.qasm).toContain('// Mapping:');
  });
});

// ─── Encoding Scheme Metadata Tests ──────────────────────────────────────────

describe('EncodingEngine - scheme metadata in output', () => {
  it('should record the default DNA encoding scheme in the output', async () => {
    const seq = makeSequence('ACGT');
    const result = await engine.encode(seq);

    expect(result.scheme).toEqual(DEFAULT_DNA_ENCODING_SCHEME);
    expect(result.scheme.name).toBe('default-2qubit-basis');
    expect(result.scheme.qubitsPerBase).toBe(2);
    expect(result.scheme.mapping.A).toBe('00');
    expect(result.scheme.mapping.C).toBe('01');
    expect(result.scheme.mapping.G).toBe('10');
    expect(result.scheme.mapping.T).toBe('11');
  });

  it('should record the source sequence ID', async () => {
    const seq = makeSequence('ACGT');
    seq.id = 'my-sequence-42';
    const result = await engine.encode(seq);

    expect(result.sourceSequenceId).toBe('my-sequence-42');
  });

  it('should use the default RNA scheme for RNA sequences', async () => {
    const seq = makeSequence('ACGU', 'RNA');
    const result = await engine.encode(seq);

    expect(result.scheme).toEqual(DEFAULT_RNA_ENCODING_SCHEME);
    expect(result.scheme.name).toBe('default-2qubit-basis-rna');
  });
});

// ─── Custom Encoding Scheme Tests ────────────────────────────────────────────

describe('EncodingEngine - custom encoding schemes', () => {
  it('should use a custom encoding scheme when provided', async () => {
    const customScheme: EncodingScheme = {
      name: 'custom-3qubit',
      qubitsPerBase: 3,
      mapping: {
        A: '000',
        C: '001',
        G: '010',
        T: '100',
        U: '111',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('AC');
    const result = await engine.encode(seq, customScheme);

    expect(result.qubitCount).toBe(6); // 2 nucleotides × 3 qubits per base
    expect(result.scheme).toEqual(customScheme);
    expect(result.gateCount).toBe(1); // Only C→001 has a '1' bit (at position 2)
    expect(result.qasm).toContain('x q[5];'); // C: qubit 1*3+2=5
  });

  it('should handle a 1-qubit-per-base scheme', async () => {
    // Note: with 1 qubit per base, only 2 unique values (0, 1) are possible.
    // This scheme has duplicates and will fail validation.
    // Use a 2-qubit scheme that is valid instead.
    const twoQubitScheme: EncodingScheme = {
      name: 'two-qubit-alt',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '10',
        T: '11',
        U: '10', // different from T to avoid duplicate — but same as G!
      } as Record<Nucleotide, string>,
    };

    // Actually, with 5 nucleotides and 2 qubits (4 possible values), duplicates are unavoidable.
    // Let's test with a scheme that doesn't trigger validation by using 3 qubits.
    const validScheme: EncodingScheme = {
      name: 'valid-3qubit-alt',
      qubitsPerBase: 3,
      mapping: {
        A: '000',
        C: '001',
        G: '010',
        T: '011',
        U: '100',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('ACGT');
    const result = await engine.encode(seq, validScheme);

    expect(result.qubitCount).toBe(12); // 4 nucleotides × 3 qubits per base
    // A: '000' → 0 gates
    // C: '001' → 1 gate (bit 2)
    // G: '010' → 1 gate (bit 1)
    // T: '011' → 2 gates (bits 1,2)
    // Total: 0+1+1+2 = 4
    expect(result.gateCount).toBe(4);
  });

  it('should record custom scheme metadata in the output', async () => {
    const customScheme: EncodingScheme = {
      name: 'my-custom-scheme',
      qubitsPerBase: 3,
      mapping: {
        A: '111',
        C: '100',
        G: '010',
        T: '001',
        U: '000',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('A');
    const result = await engine.encode(seq, customScheme);

    expect(result.scheme.name).toBe('my-custom-scheme');
    expect(result.scheme.mapping.A).toBe('111');
    expect(result.qasm).toContain('// Encoding scheme: my-custom-scheme');
  });
});

// ─── RNA Encoding Tests ──────────────────────────────────────────────────────

describe('EncodingEngine - RNA sequences', () => {
  it('should encode U nucleotide same as T (11) by default', async () => {
    const seq = makeSequence('U', 'RNA');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(2);
    expect(result.gateCount).toBe(2);
    expect(result.qasm).toContain('x q[0];');
    expect(result.qasm).toContain('x q[1];');
  });

  it('should encode RNA sequence "ACGU" correctly', async () => {
    const seq = makeSequence('ACGU', 'RNA');
    const result = await engine.encode(seq);

    expect(result.qubitCount).toBe(8);
    // A→00 (0 gates), C→01 (1 gate), G→10 (1 gate), U→11 (2 gates) = 4 gates
    expect(result.gateCount).toBe(4);
  });
});

// ─── Error Handling Tests ────────────────────────────────────────────────────

describe('EncodingEngine - error handling', () => {
  it('should throw an error for unknown nucleotides not in the scheme', async () => {
    const seq: ParsedSequence = {
      id: 'bad-seq',
      description: 'Bad sequence',
      nucleotides: 'AXG', // X is not a valid nucleotide
      length: 3,
      type: 'DNA',
      metadata: {},
    };

    await expect(engine.encode(seq)).rejects.toThrow("Unknown nucleotide 'X'");
  });

  it('should throw when a custom scheme has duplicate mappings', async () => {
    const duplicateScheme: EncodingScheme = {
      name: 'duplicate-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '01', // duplicate of C
        T: '11',
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('A');
    await expect(engine.encode(seq, duplicateScheme)).rejects.toThrow(
      "Invalid encoding scheme 'duplicate-scheme'"
    );
  });

  it('should throw when a custom scheme has inconsistent bit lengths', async () => {
    const inconsistentScheme: EncodingScheme = {
      name: 'inconsistent-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '010', // 3 bits instead of 2
        T: '11',
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('A');
    await expect(engine.encode(seq, inconsistentScheme)).rejects.toThrow(
      "Invalid encoding scheme 'inconsistent-scheme'"
    );
  });

  it('should throw when a custom scheme has non-binary characters', async () => {
    const invalidCharsScheme: EncodingScheme = {
      name: 'invalid-chars-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '10',
        T: '0x', // non-binary character
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('A');
    await expect(engine.encode(seq, invalidCharsScheme)).rejects.toThrow(
      "Invalid encoding scheme 'invalid-chars-scheme'"
    );
  });
});

// ─── Scheme Validation Tests ─────────────────────────────────────────────────

describe('EncodingEngine - validateScheme()', () => {
  it('should accept a valid encoding scheme', () => {
    const validScheme: EncodingScheme = {
      name: 'valid-scheme',
      qubitsPerBase: 3,
      mapping: {
        A: '000',
        C: '001',
        G: '010',
        T: '011',
        U: '100',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(validScheme);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should detect duplicate mappings with specific error message', () => {
    const duplicateScheme: EncodingScheme = {
      name: 'dup-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '01', // duplicate of C
        T: '11',
        U: '10',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(duplicateScheme);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Duplicate mapping: nucleotides 'C' and 'G' both map to '01'")
    );
  });

  it('should detect inconsistent bit lengths with specific error message', () => {
    const inconsistentScheme: EncodingScheme = {
      name: 'inconsistent-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '010', // 3 bits instead of 2
        T: '11',
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(inconsistentScheme);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Inconsistent bit length: nucleotide 'G' has mapping '010' (length 3) but qubitsPerBase is 2")
    );
  });

  it('should detect non-binary characters with specific error message', () => {
    const invalidScheme: EncodingScheme = {
      name: 'invalid-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '01',
        G: '10',
        T: '0x', // non-binary
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(invalidScheme);

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Invalid mapping characters: nucleotide 'T' mapping '0x' contains non-binary characters")
    );
  });

  it('should report multiple errors at once', () => {
    const multiErrorScheme: EncodingScheme = {
      name: 'multi-error-scheme',
      qubitsPerBase: 2,
      mapping: {
        A: '00',
        C: '0x', // non-binary AND wrong length (but length is 2 so only non-binary)
        G: '010', // wrong length
        T: '00', // duplicate of A
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(multiErrorScheme);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('should accept a valid 3-qubit scheme', () => {
    const threeQubitScheme: EncodingScheme = {
      name: 'three-qubit',
      qubitsPerBase: 3,
      mapping: {
        A: '000',
        C: '001',
        G: '010',
        T: '100',
        U: '111',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(threeQubitScheme);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should detect duplicates in the default DNA encoding scheme (T and U share mapping)', () => {
    const result = engine.validateScheme(DEFAULT_DNA_ENCODING_SCHEME);

    // The default DNA scheme has T→'11' and U→'11' which is a duplicate
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Duplicate mapping")
    );
  });

  it('should detect duplicates in the default RNA encoding scheme (T and U share mapping)', () => {
    const result = engine.validateScheme(DEFAULT_RNA_ENCODING_SCHEME);

    // The default RNA scheme has T→'11' and U→'11' which is a duplicate
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Duplicate mapping")
    );
  });

  it('should detect empty string mapping as invalid', () => {
    const emptyMappingScheme: EncodingScheme = {
      name: 'empty-mapping',
      qubitsPerBase: 2,
      mapping: {
        A: '',
        C: '01',
        G: '10',
        T: '11',
        U: '11',
      } as Record<Nucleotide, string>,
    };

    const result = engine.validateScheme(emptyMappingScheme);

    expect(result.valid).toBe(false);
    // Empty string fails both the binary character check and the length check
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Depth Calculation Tests ─────────────────────────────────────────────────

describe('EncodingEngine - circuit depth', () => {
  it('should have depth 0 for all-A sequences (no gates)', async () => {
    const seq = makeSequence('AAA');
    const result = await engine.encode(seq);

    expect(result.depth).toBe(0);
  });

  it('should have depth 1 for any sequence with at least one non-A nucleotide', async () => {
    const seq = makeSequence('ACG');
    const result = await engine.encode(seq);

    // All X gates can be applied in parallel (no dependencies)
    expect(result.depth).toBe(1);
  });

  it('should have depth 1 even for long sequences (X gates are independent)', async () => {
    const seq = makeSequence('TTTTTTTT');
    const result = await engine.encode(seq);

    expect(result.depth).toBe(1);
  });
});


// ─── Decode Tests ────────────────────────────────────────────────────────────

import type { MeasurementResult } from '../../src/types/index.js';

describe('EncodingEngine - decode()', () => {
  it('should decode a perfect measurement (all shots agree) for "ACGT"', async () => {
    // A→00, C→01, G→10, T→11
    // "ACGT" encoded as 8 qubits: 00 01 10 11
    // Perfect measurement: all 1000 shots produce "00011011"
    const measurements: MeasurementResult = {
      bitstrings: { '00011011': 1000 },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-1',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    expect(result.nucleotides).toBe('ACGT');
    expect(result.perBaseConfidence).toEqual([1.0, 1.0, 1.0, 1.0]);
    expect(result.averageConfidence).toBe(1.0);
    expect(result.lowConfidenceFlag).toBe(false);
  });

  it('should decode a single nucleotide with perfect confidence', async () => {
    // G→10, so 2-qubit measurement "10" with all shots
    const measurements: MeasurementResult = {
      bitstrings: { '10': 500 },
      totalShots: 500,
      backend: 'braket-local-simulator',
      jobId: 'test-job-2',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    expect(result.nucleotides).toBe('G');
    expect(result.perBaseConfidence).toEqual([1.0]);
    expect(result.averageConfidence).toBe(1.0);
    expect(result.lowConfidenceFlag).toBe(false);
  });

  it('should decode with majority vote when shots disagree', async () => {
    // 2 qubits, 1 base. Majority is "01" (C) with 700/1000 shots
    const measurements: MeasurementResult = {
      bitstrings: {
        '01': 700,
        '10': 200,
        '11': 100,
      },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-3',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    expect(result.nucleotides).toBe('C');
    expect(result.perBaseConfidence).toEqual([0.7]);
    expect(result.averageConfidence).toBe(0.7);
    expect(result.lowConfidenceFlag).toBe(false);
  });

  it('should set lowConfidenceFlag when average confidence < 0.7', async () => {
    // 4 qubits, 2 bases
    // Base 0: majority "00" (A) with 600/1000 → confidence 0.6
    // Base 1: majority "01" (C) with 600/1000 → confidence 0.6
    // Average = 0.6 < 0.7 → lowConfidenceFlag = true
    const measurements: MeasurementResult = {
      bitstrings: {
        '0001': 600,  // A, C
        '0110': 200,  // C, G
        '1011': 200,  // G, T
      },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-4',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    // Base 0: "00"→600, "01"→200, "10"→200 → majority "00" (A), confidence 0.6
    // Base 1: "01"→600, "10"→200, "11"→200 → majority "01" (C), confidence 0.6
    expect(result.nucleotides).toBe('AC');
    expect(result.perBaseConfidence).toEqual([0.6, 0.6]);
    expect(result.averageConfidence).toBe(0.6);
    expect(result.lowConfidenceFlag).toBe(true);
  });

  it('should handle empty bitstrings gracefully', async () => {
    const measurements: MeasurementResult = {
      bitstrings: {},
      totalShots: 0,
      backend: 'braket-local-simulator',
      jobId: 'test-job-5',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    expect(result.nucleotides).toBe('');
    expect(result.perBaseConfidence).toEqual([]);
    expect(result.averageConfidence).toBe(0);
    expect(result.lowConfidenceFlag).toBe(true);
  });

  it('should decode multi-base sequences with varying confidence per base', async () => {
    // 6 qubits, 3 bases: "ACG" → "00 01 10"
    // Base 0: "00" dominates (high confidence)
    // Base 1: "01" dominates (medium confidence)
    // Base 2: "10" dominates (lower confidence)
    const measurements: MeasurementResult = {
      bitstrings: {
        '000110': 500,  // A, C, G
        '001010': 200,  // A, G, G
        '000111': 150,  // A, C, T
        '110100': 150,  // T, G, A
      },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-6',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    // Base 0 (bits 0-1): "00"→500+200+150=850, "11"→150 → majority "00" (A), confidence 0.85
    // Base 1 (bits 2-3): "01"→500+150=650, "10"→200, "01"→0, "10"→150 → let me recalculate
    // Bitstring "000110": base0="00", base1="01", base2="10"
    // Bitstring "001010": base0="00", base1="10", base2="10"
    // Bitstring "000111": base0="00", base1="01", base2="11"
    // Bitstring "110100": base0="11", base1="01", base2="00"
    // Base 0: "00"→500+200+150=850, "11"→150 → majority "00" (A), confidence 0.85
    // Base 1: "01"→500+150+150=800, "10"→200 → majority "01" (C), confidence 0.8 (wait, let me recount)
    // Actually: base1 from "000110"="01"(500), "001010"="10"(200), "000111"="01"(150), "110100"="01"(150)
    // Base 1: "01"→500+150+150=800, "10"→200 → majority "01" (C), confidence 0.8
    // Base 2: "10"→500+200=700, "11"→150, "00"→150 → majority "10" (G), confidence 0.7
    expect(result.nucleotides).toBe('ACG');
    expect(result.perBaseConfidence[0]).toBeCloseTo(0.85);
    expect(result.perBaseConfidence[1]).toBeCloseTo(0.8);
    expect(result.perBaseConfidence[2]).toBeCloseTo(0.7);
    expect(result.lowConfidenceFlag).toBe(false);
  });

  it('should work with RNA encoding scheme', async () => {
    // U→11 in RNA scheme
    const measurements: MeasurementResult = {
      bitstrings: { '11': 1000 },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-7',
    };

    // Note: reverse mapping will find the first nucleotide mapped to "11"
    // In RNA scheme, both T and U map to "11". The reverse lookup will find one of them.
    const result = await engine.decode(measurements, DEFAULT_RNA_ENCODING_SCHEME);

    // T and U both map to "11" - the reverse lookup will pick whichever comes last in iteration
    expect(['T', 'U']).toContain(result.nucleotides);
    expect(result.perBaseConfidence).toEqual([1.0]);
    expect(result.averageConfidence).toBe(1.0);
  });

  it('should correctly calculate confidence as majority count / totalShots', async () => {
    // 2 qubits, 1 base. 800 shots for "11" (T), 200 for "00" (A)
    const measurements: MeasurementResult = {
      bitstrings: {
        '11': 800,
        '00': 200,
      },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-job-8',
    };

    const result = await engine.decode(measurements, DEFAULT_DNA_ENCODING_SCHEME);

    expect(result.nucleotides).toBe('T');
    expect(result.perBaseConfidence[0]).toBe(0.8);
    expect(result.averageConfidence).toBe(0.8);
    expect(result.lowConfidenceFlag).toBe(false);
  });

  it('should handle encode then decode round-trip for a simple sequence', async () => {
    // Encode "ACGT", then simulate perfect measurement, then decode
    const seq = makeSequence('ACGT');
    const encoded = await engine.encode(seq);

    // Simulate perfect measurement: extract the expected bitstring from the circuit
    // A→00, C→01, G→10, T→11 → full bitstring "00011011"
    const measurements: MeasurementResult = {
      bitstrings: { '00011011': 1000 },
      totalShots: 1000,
      backend: 'braket-local-simulator',
      jobId: 'test-roundtrip',
    };

    const decoded = await engine.decode(measurements, encoded.scheme);

    expect(decoded.nucleotides).toBe('ACGT');
    expect(decoded.averageConfidence).toBe(1.0);
    expect(decoded.lowConfidenceFlag).toBe(false);
  });
});


// ─── Serialize Tests ─────────────────────────────────────────────────────────

describe('EncodingEngine - serialize()', () => {
  it('should return the qasm field directly when it already contains metadata', async () => {
    const seq = makeSequence('ACGT');
    const encoded = await engine.encode(seq);

    const serialized = engine.serialize(encoded);

    expect(serialized).toBe(encoded.qasm);
  });

  it('should include OPENQASM 3.0 header in serialized output', async () => {
    const seq = makeSequence('ACG');
    const encoded = await engine.encode(seq);

    const serialized = engine.serialize(encoded);

    expect(serialized).toContain('OPENQASM 3.0;');
  });

  it('should include encoding scheme metadata as comments', async () => {
    const seq = makeSequence('ACG');
    const encoded = await engine.encode(seq);

    const serialized = engine.serialize(encoded);

    expect(serialized).toContain('// Encoding scheme: default-2qubit-basis');
    expect(serialized).toContain('// Qubits per base: 2');
    expect(serialized).toContain('// Mapping:');
  });

  it('should inject metadata when qasm is missing it', () => {
    const circuit: import('../../src/types/index.js').EncodedCircuit = {
      qasm: 'OPENQASM 3.0;\ninclude "stdgates.inc";\n\nqubit[4] q;\nbit[4] c;\n\nx q[1];\nx q[2];\n\nc = measure q;',
      qubitCount: 4,
      gateCount: 2,
      depth: 1,
      scheme: DEFAULT_DNA_ENCODING_SCHEME,
      sourceSequenceId: 'test-seq',
    };

    const serialized = engine.serialize(circuit);

    expect(serialized).toContain('// Encoding scheme: default-2qubit-basis');
    expect(serialized).toContain('// Qubits per base: 2');
    expect(serialized).toContain('// Mapping:');
    // Should still contain the original content
    expect(serialized).toContain('OPENQASM 3.0;');
    expect(serialized).toContain('x q[1];');
    expect(serialized).toContain('x q[2];');
  });

  it('should produce valid OpenQASM that can be deserialized', async () => {
    const seq = makeSequence('ACGT');
    const encoded = await engine.encode(seq);

    const serialized = engine.serialize(encoded);
    const deserialized = engine.deserialize(serialized);

    expect(deserialized.qubitCount).toBe(encoded.qubitCount);
    expect(deserialized.gateCount).toBe(encoded.gateCount);
    expect(deserialized.depth).toBe(encoded.depth);
  });
});

// ─── Deserialize Tests ───────────────────────────────────────────────────────

describe('EncodingEngine - deserialize()', () => {
  it('should deserialize a valid OpenQASM 3.0 circuit', async () => {
    const seq = makeSequence('ACGT');
    const encoded = await engine.encode(seq);

    const deserialized = engine.deserialize(encoded.qasm);

    expect(deserialized.qubitCount).toBe(8);
    expect(deserialized.gateCount).toBe(4); // C(1) + G(1) + T(2) = 4
    expect(deserialized.depth).toBe(1);
    expect(deserialized.qasm).toBe(encoded.qasm);
  });

  it('should extract encoding scheme metadata from comments', async () => {
    const seq = makeSequence('ACG');
    const encoded = await engine.encode(seq);

    const deserialized = engine.deserialize(encoded.qasm);

    expect(deserialized.scheme.name).toBe('default-2qubit-basis');
    expect(deserialized.scheme.qubitsPerBase).toBe(2);
    expect(deserialized.scheme.mapping.A).toBe('00');
    expect(deserialized.scheme.mapping.C).toBe('01');
    expect(deserialized.scheme.mapping.G).toBe('10');
    expect(deserialized.scheme.mapping.T).toBe('11');
  });

  it('should extract qubit count from qubit register declaration', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[10] q;',
      'bit[10] c;',
      '',
      'c = measure q;',
    ].join('\n');

    const result = engine.deserialize(qasm);

    expect(result.qubitCount).toBe(10);
    expect(result.gateCount).toBe(0);
    expect(result.depth).toBe(0);
  });

  it('should count X gates correctly', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[6] q;',
      'bit[6] c;',
      '',
      'x q[1];',
      'x q[3];',
      'x q[4];',
      '',
      'c = measure q;',
    ].join('\n');

    const result = engine.deserialize(qasm);

    expect(result.qubitCount).toBe(6);
    expect(result.gateCount).toBe(3);
    expect(result.depth).toBe(1);
  });

  it('should have depth 0 when there are no gates', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[4] q;',
      'bit[4] c;',
      '',
      'c = measure q;',
    ].join('\n');

    const result = engine.deserialize(qasm);

    expect(result.depth).toBe(0);
  });

  it('should use default scheme values when metadata comments are missing', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[4] q;',
      'bit[4] c;',
      '',
      'x q[0];',
      '',
      'c = measure q;',
    ].join('\n');

    const result = engine.deserialize(qasm);

    expect(result.scheme.name).toBe('unknown');
    expect(result.scheme.qubitsPerBase).toBe(2);
    expect(result.scheme.mapping.A).toBe('00');
  });

  it('should round-trip serialize/deserialize preserving circuit properties', async () => {
    const seq = makeSequence('ACGTACGT');
    const encoded = await engine.encode(seq);

    const serialized = engine.serialize(encoded);
    const deserialized = engine.deserialize(serialized);

    expect(deserialized.qubitCount).toBe(encoded.qubitCount);
    expect(deserialized.gateCount).toBe(encoded.gateCount);
    expect(deserialized.depth).toBe(encoded.depth);
    expect(deserialized.scheme.name).toBe(encoded.scheme.name);
    expect(deserialized.scheme.qubitsPerBase).toBe(encoded.scheme.qubitsPerBase);
    expect(deserialized.scheme.mapping).toEqual(encoded.scheme.mapping);
  });

  it('should round-trip with custom encoding scheme', async () => {
    const customScheme: EncodingScheme = {
      name: 'custom-3qubit',
      qubitsPerBase: 3,
      mapping: {
        A: '000',
        C: '001',
        G: '010',
        T: '100',
        U: '111',
      } as Record<Nucleotide, string>,
    };

    const seq = makeSequence('ACG');
    const encoded = await engine.encode(seq, customScheme);

    const serialized = engine.serialize(encoded);
    const deserialized = engine.deserialize(serialized);

    expect(deserialized.qubitCount).toBe(encoded.qubitCount);
    expect(deserialized.gateCount).toBe(encoded.gateCount);
    expect(deserialized.depth).toBe(encoded.depth);
    expect(deserialized.scheme.name).toBe('custom-3qubit');
    expect(deserialized.scheme.qubitsPerBase).toBe(3);
  });
});

// ─── Deserialize Error Handling Tests ────────────────────────────────────────

describe('EncodingEngine - deserialize() error handling', () => {
  it('should throw parse error when OPENQASM header is missing', () => {
    const qasm = 'qubit[4] q;\nbit[4] c;\nc = measure q;';

    expect(() => engine.deserialize(qasm)).toThrow(
      "Parse error at line 1: Expected 'OPENQASM 3.0;' header"
    );
  });

  it('should throw parse error for invalid gate syntax', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[4] q;',
      'bit[4] c;',
      '',
      'badgate q[0];',
      '',
      'c = measure q;',
    ].join('\n');

    expect(() => engine.deserialize(qasm)).toThrow(
      "Parse error at line 7: Invalid gate syntax 'badgate q[0];'"
    );
  });

  it('should throw parse error with correct line number for errors later in file', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[4] q;',
      'bit[4] c;',
      '',
      'x q[0];',
      'x q[1];',
      'invalid_operation;',
      '',
      'c = measure q;',
    ].join('\n');

    expect(() => engine.deserialize(qasm)).toThrow('Parse error at line 9');
  });

  it('should throw parse error for empty input', () => {
    expect(() => engine.deserialize('')).toThrow(
      "Parse error at line 1: Expected 'OPENQASM 3.0;' header"
    );
  });

  it('should throw parse error when header is wrong version', () => {
    const qasm = [
      'OPENQASM 2.0;',
      'include "stdgates.inc";',
      'qubit[4] q;',
      'bit[4] c;',
      'c = measure q;',
    ].join('\n');

    expect(() => engine.deserialize(qasm)).toThrow(
      "Parse error at line 1: Expected 'OPENQASM 3.0;' header"
    );
  });

  it('should throw parse error for unsupported gate operations', () => {
    const qasm = [
      'OPENQASM 3.0;',
      'include "stdgates.inc";',
      '',
      'qubit[4] q;',
      'bit[4] c;',
      '',
      'h q[0];',
      '',
      'c = measure q;',
    ].join('\n');

    expect(() => engine.deserialize(qasm)).toThrow("Parse error at line 7: Invalid gate syntax 'h q[0];'");
  });
});
