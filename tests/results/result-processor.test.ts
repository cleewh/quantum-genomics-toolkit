/**
 * Unit tests for the ResultProcessor.
 * Tests measurement decoding, confidence scoring, and report generation.
 */

import { describe, it, expect } from 'vitest';
import { ResultProcessor } from '../../src/results/result-processor.js';
import type {
  MeasurementResult,
  EncodingScheme,
  DecodedSequence,
  ExecutionMetadata,
  Nucleotide,
} from '../../src/types/index.js';
import { DEFAULT_DNA_ENCODING_SCHEME } from '../../src/types/encoding-schemes.js';

describe('ResultProcessor', () => {
  const processor = new ResultProcessor();

  const defaultScheme: EncodingScheme = DEFAULT_DNA_ENCODING_SCHEME;

  const defaultMetadata: ExecutionMetadata = {
    jobId: 'test-job-001',
    backend: 'ionq-forte-enterprise',
    shots: 1000,
    encodingScheme: 'default-2qubit-basis',
  };

  describe('decode()', () => {
    it('should decode a perfect measurement (all shots agree) to the correct sequence', () => {
      // Encode "ACGT" → "00011011"
      // All 1000 shots return the same bitstring
      const results: MeasurementResult = {
        bitstrings: { '00011011': 1000 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-001',
      };

      const decoded = processor.decode(results, defaultScheme);

      expect(decoded.nucleotides).toBe('ACGT');
      expect(decoded.perBaseConfidence).toEqual([1, 1, 1, 1]);
      expect(decoded.averageConfidence).toBe(1);
      expect(decoded.lowConfidenceFlag).toBe(false);
    });

    it('should decode using majority vote when shots disagree', () => {
      // For a 2-base sequence (4 qubits):
      // 700 shots say "0001" (AC), 300 shots say "0010" (AG)
      // Base 0: "00" → A (1000/1000 = 1.0 confidence)
      // Base 1: "01" → C (700/1000 = 0.7) vs "10" → G (300/1000 = 0.3)
      const results: MeasurementResult = {
        bitstrings: { '0001': 700, '0010': 300 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-002',
      };

      const decoded = processor.decode(results, defaultScheme);

      expect(decoded.nucleotides).toBe('AC');
      expect(decoded.perBaseConfidence[0]).toBe(1.0);
      expect(decoded.perBaseConfidence[1]).toBeCloseTo(0.7);
      expect(decoded.averageConfidence).toBeCloseTo(0.85);
      expect(decoded.lowConfidenceFlag).toBe(false);
    });

    it('should set lowConfidenceFlag when average confidence < 0.7', () => {
      // 4 qubits (2 bases), highly noisy results
      // Base 0: "00" appears 600 times, "01" appears 400 → confidence 0.6
      // Base 1: "11" appears 500 times, "10" appears 500 → confidence 0.5
      const results: MeasurementResult = {
        bitstrings: {
          '0011': 400,
          '0010': 100,
          '0111': 100,
          '0110': 400,
        },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-003',
      };

      const decoded = processor.decode(results, defaultScheme);

      // Base 0: "00" = 400+100=500, "01" = 100+400=500 → tie, first wins
      // Base 1: "11" = 400+100=500, "10" = 100+400=500 → tie, first wins
      // Both have confidence 0.5
      expect(decoded.averageConfidence).toBeLessThan(0.7);
      expect(decoded.lowConfidenceFlag).toBe(true);
    });

    it('should handle empty measurement results', () => {
      const results: MeasurementResult = {
        bitstrings: {},
        totalShots: 0,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-004',
      };

      const decoded = processor.decode(results, defaultScheme);

      expect(decoded.nucleotides).toBe('');
      expect(decoded.perBaseConfidence).toEqual([]);
      expect(decoded.averageConfidence).toBe(0);
      expect(decoded.lowConfidenceFlag).toBe(true);
    });

    it('should decode a single nucleotide correctly', () => {
      // Single base "G" → "10"
      const results: MeasurementResult = {
        bitstrings: { '10': 950, '11': 50 },
        totalShots: 1000,
        backend: 'braket-local-simulator',
        jobId: 'test-job-005',
      };

      const decoded = processor.decode(results, defaultScheme);

      expect(decoded.nucleotides).toBe('G');
      expect(decoded.perBaseConfidence[0]).toBeCloseTo(0.95);
      expect(decoded.averageConfidence).toBeCloseTo(0.95);
      expect(decoded.lowConfidenceFlag).toBe(false);
    });

    it('should work with a custom encoding scheme', () => {
      const customScheme: EncodingScheme = {
        name: 'custom-3qubit',
        qubitsPerBase: 3,
        mapping: {
          A: '000',
          C: '001',
          G: '010',
          T: '011',
          U: '100',
        } as Record<Nucleotide, string>,
      };

      // Encode "AG" → "000010"
      const results: MeasurementResult = {
        bitstrings: { '000010': 1000 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-006',
      };

      const decoded = processor.decode(results, customScheme);

      expect(decoded.nucleotides).toBe('AG');
      expect(decoded.perBaseConfidence).toEqual([1, 1]);
      expect(decoded.averageConfidence).toBe(1);
    });

    it('should use N for unmapped bit patterns', () => {
      // A scheme that only maps 2-bit patterns 00, 01, 10
      const partialScheme: EncodingScheme = {
        name: 'partial',
        qubitsPerBase: 2,
        mapping: {
          A: '00',
          C: '01',
          G: '10',
          T: '10', // duplicate with G, so only A, C, G are uniquely mapped
          U: '10',
        } as Record<Nucleotide, string>,
      };

      // "11" has no unique reverse mapping in this scheme
      const results: MeasurementResult = {
        bitstrings: { '0011': 1000 },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-007',
      };

      const decoded = processor.decode(results, partialScheme);

      // Base 0: "00" → A
      // Base 1: "11" → not in reverse mapping → N
      expect(decoded.nucleotides).toBe('AN');
    });

    it('should calculate confidence correctly with many different bitstrings', () => {
      // 2 qubits (1 base), many different outcomes
      const results: MeasurementResult = {
        bitstrings: {
          '00': 400, // A
          '01': 300, // C
          '10': 200, // G
          '11': 100, // T
        },
        totalShots: 1000,
        backend: 'ionq-forte-enterprise',
        jobId: 'test-job-008',
      };

      const decoded = processor.decode(results, defaultScheme);

      expect(decoded.nucleotides).toBe('A');
      expect(decoded.perBaseConfidence[0]).toBeCloseTo(0.4);
      expect(decoded.lowConfidenceFlag).toBe(true);
    });
  });

  describe('generateReport()', () => {
    it('should generate a valid FASTA report for a high-confidence sequence', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGTACGT',
        perBaseConfidence: [1, 1, 1, 1, 1, 1, 1, 1],
        averageConfidence: 1.0,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      // Check FASTA format
      expect(report.fasta).toContain('>decoded_test-job-001');
      expect(report.fasta).toContain('Decoded from quantum measurement');
      expect(report.fasta).toContain('confidence=1.00');
      expect(report.fasta).toContain('ACGTACGT');
      expect(report.fasta.startsWith('>')).toBe(true);
      expect(report.fasta.endsWith('\n')).toBe(true);

      // Check other report fields
      expect(report.confidence).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
      expect(report.metadata).toEqual(defaultMetadata);
      expect(report.recommendations).toEqual([]);
      expect(report.vcf).toBeUndefined();
    });

    it('should wrap FASTA sequence lines at 80 characters', () => {
      // Create a sequence longer than 80 characters
      const longSeq = 'A'.repeat(200);
      const decoded: DecodedSequence = {
        nucleotides: longSeq,
        perBaseConfidence: Array(200).fill(1.0),
        averageConfidence: 1.0,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      const lines = report.fasta.split('\n');
      // First line is header
      expect(lines[0].startsWith('>')).toBe(true);
      // Sequence lines should be at most 80 characters
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].length > 0) {
          expect(lines[i].length).toBeLessThanOrEqual(80);
        }
      }
      // Should have 3 sequence lines: 80 + 80 + 40
      expect(lines[1].length).toBe(80);
      expect(lines[2].length).toBe(80);
      expect(lines[3].length).toBe(40);
    });

    it('should include low-confidence recommendation when flag is set', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGT',
        perBaseConfidence: [0.6, 0.6, 0.6, 0.6],
        averageConfidence: 0.6,
        lowConfidenceFlag: true,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(report.recommendations[0]).toContain('Low confidence results');
      expect(report.recommendations[0]).toContain('0.60');
      expect(report.recommendations[0]).toContain('1000');
    });

    it('should include very-low-confidence base recommendation', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGT',
        perBaseConfidence: [0.9, 0.4, 0.3, 0.9],
        averageConfidence: 0.625,
        lowConfidenceFlag: true,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      // Should have both recommendations
      expect(report.recommendations.length).toBe(2);
      expect(report.recommendations[1]).toContain('2 bases have very low confidence');
      expect(report.recommendations[1]).toContain('Results may be unreliable');
    });

    it('should generate VCF when there are very low confidence bases', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGT',
        perBaseConfidence: [0.9, 0.3, 0.9, 0.4],
        averageConfidence: 0.625,
        lowConfidenceFlag: true,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      expect(report.vcf).toBeDefined();
      expect(report.vcf!).toContain('##fileformat=VCFv4.2');
      expect(report.vcf!).toContain('#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO');
      // Position 2 (0-indexed 1) and position 4 (0-indexed 3) should be in VCF
      expect(report.vcf!).toContain('decoded_test-job-001\t2\t');
      expect(report.vcf!).toContain('decoded_test-job-001\t4\t');
    });

    it('should not generate VCF when all bases have high confidence', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGT',
        perBaseConfidence: [0.9, 0.8, 0.7, 0.85],
        averageConfidence: 0.8125,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      expect(report.vcf).toBeUndefined();
    });

    it('should produce parseable FASTA output', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGTACGTACGT',
        perBaseConfidence: Array(12).fill(0.95),
        averageConfidence: 0.95,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      // Parse the FASTA output
      const lines = report.fasta.split('\n').filter((l) => l.length > 0);
      expect(lines.length).toBeGreaterThanOrEqual(2);

      // First line must be a header starting with >
      expect(lines[0][0]).toBe('>');

      // Remaining lines are the sequence
      const sequence = lines.slice(1).join('');
      expect(sequence).toBe('ACGTACGTACGT');

      // All sequence characters should be valid nucleotides or N
      expect(sequence).toMatch(/^[ACGTUN]+$/);
    });

    it('should include execution metadata in the report', () => {
      const metadata: ExecutionMetadata = {
        jobId: 'custom-job-42',
        backend: 'rigetti-cepheus-1',
        shots: 5000,
        encodingScheme: 'custom-scheme',
        executionTimeMs: 12345,
      };

      const decoded: DecodedSequence = {
        nucleotides: 'ACG',
        perBaseConfidence: [1, 1, 1],
        averageConfidence: 1.0,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, metadata);

      expect(report.metadata.jobId).toBe('custom-job-42');
      expect(report.metadata.backend).toBe('rigetti-cepheus-1');
      expect(report.metadata.shots).toBe(5000);
      expect(report.metadata.encodingScheme).toBe('custom-scheme');
      expect(report.metadata.executionTimeMs).toBe(12345);
    });

    it('should handle empty decoded sequence', () => {
      const decoded: DecodedSequence = {
        nucleotides: '',
        perBaseConfidence: [],
        averageConfidence: 0,
        lowConfidenceFlag: true,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      expect(report.fasta).toContain('>decoded_test-job-001');
      expect(report.confidence).toEqual([]);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('should generate no recommendations for high-confidence results', () => {
      const decoded: DecodedSequence = {
        nucleotides: 'ACGT',
        perBaseConfidence: [0.95, 0.92, 0.88, 0.91],
        averageConfidence: 0.915,
        lowConfidenceFlag: false,
      };

      const report = processor.generateReport(decoded, defaultMetadata);

      expect(report.recommendations).toEqual([]);
    });
  });
});
