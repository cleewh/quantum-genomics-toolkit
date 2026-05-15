import { describe, it, expect } from 'vitest';
import { DefaultGenomeCompressor } from '../../src/budget/genome-compressor.js';
import { ParsedSequence, EncodingScheme } from '../../src/types/index.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../../src/types/encoding-schemes.js';

function makeSequence(nucleotides: string): ParsedSequence {
  return {
    id: 'test-seq',
    description: 'Test sequence',
    nucleotides,
    length: nucleotides.length,
    type: 'DNA',
    metadata: {},
  };
}

describe('GenomeCompressor', () => {
  const compressor = new DefaultGenomeCompressor();
  const scheme = DEFAULT_DNA_ENCODING_SCHEME; // 2 qubits per base

  describe('partition()', () => {
    it('returns a single segment when sequence fits within target', () => {
      // Target: 36 qubits → max 18 bases per segment
      const seq = makeSequence('ACGTACGTACGTACGT'); // 16 bases — fits
      const result = compressor.partition(seq, 36, scheme);

      expect(result.totalSegments).toBe(1);
      expect(result.segments[0].nucleotides).toBe('ACGTACGTACGTACGT');
      expect(result.segments[0].overlapWithNext).toBe(0);
      expect(result.originalLength).toBe(16);
    });

    it('partitions a sequence into multiple segments with overlap', () => {
      // Target: 36 qubits → max 18 bases per segment, overlap 10
      // Effective step = 18 - 10 = 8
      // Sequence: 30 bases
      const seq = makeSequence('ACGTACGTACGTACGTACGTACGTACGTAC'); // 30 bases
      const result = compressor.partition(seq, 36, scheme);

      expect(result.originalLength).toBe(30);
      expect(result.overlapSize).toBe(10);
      expect(result.totalSegments).toBeGreaterThan(1);

      // Each segment should be at most 18 bases
      for (const segment of result.segments) {
        expect(segment.nucleotides.length).toBeLessThanOrEqual(18);
      }

      // Adjacent segments should overlap by at least 10 nucleotides
      for (let i = 0; i < result.segments.length - 1; i++) {
        expect(result.segments[i].overlapWithNext).toBe(10);
      }

      // Last segment has no overlap with next
      expect(result.segments[result.segments.length - 1].overlapWithNext).toBe(0);
    });

    it('ensures adjacent segments share exactly the overlap nucleotides', () => {
      // Target: 36 qubits → max 18 bases, overlap 10, step 8
      const nucleotides = 'ACGTACGTACGTACGTACGTACGTACGTAC'; // 30 bases
      const seq = makeSequence(nucleotides);
      const result = compressor.partition(seq, 36, scheme);

      for (let i = 0; i < result.segments.length - 1; i++) {
        const current = result.segments[i];
        const next = result.segments[i + 1];

        // The last 10 chars of current should equal the first 10 chars of next
        const currentTail = current.nucleotides.slice(-10);
        const nextHead = next.nucleotides.slice(0, 10);
        expect(currentTail).toBe(nextHead);
      }
    });

    it('uses custom overlap size', () => {
      const seq = makeSequence('A'.repeat(50));
      const result = compressor.partition(seq, 36, scheme, 5);

      expect(result.overlapSize).toBe(5);

      // max 18 bases per segment, step = 18 - 5 = 13
      for (let i = 0; i < result.segments.length - 1; i++) {
        const current = result.segments[i];
        const next = result.segments[i + 1];
        const currentTail = current.nucleotides.slice(-5);
        const nextHead = next.nucleotides.slice(0, 5);
        expect(currentTail).toBe(nextHead);
      }
    });

    it('throws error when target qubit count is too small for overlap', () => {
      // Target: 10 qubits → max 5 bases, overlap 10 → impossible
      const seq = makeSequence('ACGTACGTACGTACGT');
      expect(() => compressor.partition(seq, 10, scheme, 10)).toThrow();
    });

    it('correctly sets segment positions', () => {
      // Target: 36 qubits → max 18 bases, overlap 10, step 8
      const nucleotides = 'ACGTACGTACGTACGTACGTACGTACGTAC'; // 30 bases
      const seq = makeSequence(nucleotides);
      const result = compressor.partition(seq, 36, scheme);

      // First segment starts at 0
      expect(result.segments[0].startPosition).toBe(0);

      // Each segment's nucleotides should match the original at the given positions
      for (const segment of result.segments) {
        const expected = nucleotides.slice(segment.startPosition, segment.endPosition + 1);
        expect(segment.nucleotides).toBe(expected);
      }
    });

    it('handles sequence exactly at boundary (18 bases for 36 qubits)', () => {
      const seq = makeSequence('ACGTACGTACGTACGTAC'); // 18 bases — exactly fits
      const result = compressor.partition(seq, 36, scheme);

      expect(result.totalSegments).toBe(1);
      expect(result.segments[0].nucleotides).toBe('ACGTACGTACGTACGTAC');
    });

    it('partitions a long sequence correctly', () => {
      // 100 bases with Rigetti (108 qubits → max 54 bases, overlap 10, step 44)
      const nucleotides = 'ACGT'.repeat(25); // 100 bases
      const seq = makeSequence(nucleotides);
      const result = compressor.partition(seq, 108, scheme);

      expect(result.originalLength).toBe(100);
      // Expected segments: ceil((100 - 54) / 44) + 1 = ceil(46/44) + 1 = 2 + 1 = 3
      expect(result.totalSegments).toBe(3);

      for (const segment of result.segments) {
        expect(segment.nucleotides.length).toBeLessThanOrEqual(54);
      }
    });
  });

  describe('reassemble()', () => {
    it('reassembles a single segment correctly', () => {
      const nucleotides = 'ACGTACGTACGTACGT';
      const seq = makeSequence(nucleotides);
      const partitioned = compressor.partition(seq, 36, scheme);
      const reassembled = compressor.reassemble(partitioned);

      expect(reassembled.nucleotides).toBe(nucleotides);
      expect(reassembled.length).toBe(nucleotides.length);
    });

    it('reassembles multiple segments to produce original sequence', () => {
      const nucleotides = 'ACGTACGTACGTACGTACGTACGTACGTAC'; // 30 bases
      const seq = makeSequence(nucleotides);
      const partitioned = compressor.partition(seq, 36, scheme);
      const reassembled = compressor.reassemble(partitioned);

      expect(reassembled.nucleotides).toBe(nucleotides);
      expect(reassembled.length).toBe(nucleotides.length);
    });

    it('reassembles a long sequence correctly (round-trip)', () => {
      const nucleotides = 'ACGT'.repeat(25); // 100 bases
      const seq = makeSequence(nucleotides);
      const partitioned = compressor.partition(seq, 108, scheme);
      const reassembled = compressor.reassemble(partitioned);

      expect(reassembled.nucleotides).toBe(nucleotides);
      expect(reassembled.length).toBe(100);
    });

    it('reassembles with custom overlap correctly', () => {
      const nucleotides = 'ACGT'.repeat(15); // 60 bases
      const seq = makeSequence(nucleotides);
      const partitioned = compressor.partition(seq, 36, scheme, 5);
      const reassembled = compressor.reassemble(partitioned);

      expect(reassembled.nucleotides).toBe(nucleotides);
    });

    it('handles empty partitions', () => {
      const result = compressor.reassemble({
        segments: [],
        originalLength: 0,
        overlapSize: 10,
        totalSegments: 0,
      });

      expect(result.nucleotides).toBe('');
      expect(result.length).toBe(0);
    });

    it('reassembles segments regardless of order (sorts by index)', () => {
      const nucleotides = 'ACGTACGTACGTACGTACGTACGTACGTAC'; // 30 bases
      const seq = makeSequence(nucleotides);
      const partitioned = compressor.partition(seq, 36, scheme);

      // Shuffle segments
      const shuffled = {
        ...partitioned,
        segments: [...partitioned.segments].reverse(),
      };

      const reassembled = compressor.reassemble(shuffled);
      expect(reassembled.nucleotides).toBe(nucleotides);
    });
  });
});
