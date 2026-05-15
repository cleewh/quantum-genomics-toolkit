/**
 * Unit tests for the FASTA Validator.
 *
 * Tests file extension validation, format validation, ambiguous code detection,
 * and per-backend sequence length validation.
 */

import { describe, it, expect } from 'vitest';
import { FastaValidator } from '../../src/toolkit/validators/fasta-validator.js';

describe('FastaValidator', () => {
  const validator = new FastaValidator();

  describe('file extension validation', () => {
    it('accepts .fa extension', () => {
      const result = validator.validate('sequence.fa', '>seq1\nACGT');
      expect(result.valid).toBe(true);
    });

    it('accepts .fasta extension', () => {
      const result = validator.validate('sequence.fasta', '>seq1\nACGT');
      expect(result.valid).toBe(true);
    });

    it('accepts uppercase .FA extension', () => {
      const result = validator.validate('sequence.FA', '>seq1\nACGT');
      expect(result.valid).toBe(true);
    });

    it('accepts uppercase .FASTA extension', () => {
      const result = validator.validate('sequence.FASTA', '>seq1\nACGT');
      expect(result.valid).toBe(true);
    });

    it('rejects .fastq extension', () => {
      const result = validator.validate('sequence.fastq', '>seq1\nACGT');
      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].type).toBe('wrong-extension');
      expect(result.errors[0].message).toContain('.fa, .fasta');
    });

    it('rejects .txt extension', () => {
      const result = validator.validate('data.txt', '>seq1\nACGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('wrong-extension');
    });

    it('rejects .gb extension', () => {
      const result = validator.validate('genome.gb', '>seq1\nACGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('wrong-extension');
    });

    it('rejects file with no extension', () => {
      const result = validator.validate('sequence', '>seq1\nACGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('wrong-extension');
    });
  });

  describe('format validation', () => {
    it('accepts valid single-line FASTA', () => {
      const result = validator.validate('test.fa', '>seq1\nACGTACGT');
      expect(result.valid).toBe(true);
      expect(result.sequence).toBeDefined();
      expect(result.sequence!.nucleotides).toBe('ACGTACGT');
      expect(result.sequence!.id).toBe('seq1');
    });

    it('accepts valid multi-line FASTA', () => {
      const content = '>seq1 Human gene\nACGT\nTGCA\nAAAA';
      const result = validator.validate('test.fasta', content);
      expect(result.valid).toBe(true);
      expect(result.sequence!.nucleotides).toBe('ACGTTGCAAAAA');
      expect(result.sequence!.description).toBe('Human gene');
    });

    it('accepts RNA sequences (with U)', () => {
      const result = validator.validate('rna.fa', '>rna1\nACGUACGU');
      expect(result.valid).toBe(true);
      expect(result.sequence!.type).toBe('RNA');
    });

    it('rejects content without header line', () => {
      const result = validator.validate('test.fa', 'ACGTACGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid-format');
      expect(result.errors[0].message).toContain('>');
    });

    it('rejects empty content', () => {
      const result = validator.validate('test.fa', '');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid-format');
    });

    it('rejects header-only content (no sequence data)', () => {
      const result = validator.validate('test.fa', '>seq1\n');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid-format');
      expect(result.errors[0].message).toContain('no sequence data');
    });

    it('rejects invalid characters in sequence', () => {
      const result = validator.validate('test.fa', '>seq1\nACGT123');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('invalid-format');
      expect(result.errors[0].message).toContain('invalid character');
    });

    it('handles Windows-style line endings', () => {
      const result = validator.validate('test.fa', '>seq1\r\nACGT\r\nTGCA');
      expect(result.valid).toBe(true);
      expect(result.sequence!.nucleotides).toBe('ACGTTGCA');
    });

    it('handles blank lines in content', () => {
      const result = validator.validate('test.fa', '>seq1\n\nACGT\n\nTGCA\n');
      expect(result.valid).toBe(true);
      expect(result.sequence!.nucleotides).toBe('ACGTTGCA');
    });
  });

  describe('ambiguous code detection', () => {
    it('detects N (any base) ambiguous code', () => {
      const result = validator.validate('test.fa', '>seq1\nACNGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('ambiguous-codes');
      expect(result.errors[0].details?.invalidCharacters).toHaveLength(1);
      expect(result.errors[0].details!.invalidCharacters![0]).toEqual({ char: 'N', position: 2 });
    });

    it('detects multiple ambiguous codes with positions', () => {
      const result = validator.validate('test.fa', '>seq1\nARYACGT');
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('ambiguous-codes');
      const chars = result.errors[0].details!.invalidCharacters!;
      expect(chars).toHaveLength(2);
      expect(chars[0]).toEqual({ char: 'R', position: 1 });
      expect(chars[1]).toEqual({ char: 'Y', position: 2 });
    });

    it('detects all IUPAC ambiguous codes', () => {
      const ambiguousCodes = ['N', 'R', 'Y', 'W', 'S', 'M', 'K', 'B', 'D', 'H', 'V'];
      for (const code of ambiguousCodes) {
        const result = validator.validate('test.fa', `>seq1\nA${code}G`);
        expect(result.valid).toBe(false);
        expect(result.errors[0].type).toBe('ambiguous-codes');
        expect(result.errors[0].details!.invalidCharacters![0].char).toBe(code);
      }
    });

    it('still returns parsed sequence when ambiguous codes found', () => {
      const result = validator.validate('test.fa', '>seq1\nACNGT');
      expect(result.sequence).toBeDefined();
      expect(result.sequence!.nucleotides).toBe('ACNGT');
    });
  });

  describe('per-backend sequence length validation', () => {
    it('accepts sequence within local simulator limit for encode', () => {
      // Local simulator: 34 qubits, encode needs 2N → max 17 bases
      const seq = 'A'.repeat(17);
      const result = validator.validate('test.fa', `>seq1\n${seq}`, {
        backend: 'braket-local-simulator',
        operation: 'encode',
      });
      expect(result.valid).toBe(true);
    });

    it('rejects sequence exceeding local simulator limit for encode', () => {
      // Local simulator: max 17 bases for encode
      const seq = 'A'.repeat(18);
      const result = validator.validate('test.fa', `>seq1\n${seq}`, {
        backend: 'braket-local-simulator',
        operation: 'encode',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('exceeds-backend-limit');
      expect(result.errors[0].details!.maxAllowed).toBe(17);
      expect(result.errors[0].details!.actualLength).toBe(18);
      expect(result.errors[0].details!.backend).toBe('braket-local-simulator');
    });

    it('rejects sequence exceeding DM1 limit for swap-test', () => {
      // DM1: 17 qubits, swap-test needs 4N+1 → max 4 bases
      const seq = 'A'.repeat(5);
      const result = validator.validate('test.fa', `>seq1\n${seq}`, {
        backend: 'braket-dm1',
        operation: 'swap-test',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].type).toBe('exceeds-backend-limit');
      expect(result.errors[0].details!.maxAllowed).toBe(4);
    });

    it('accepts sequence within IonQ limit for encode', () => {
      // IonQ: 36 qubits, encode needs 2N → max 18 bases
      const seq = 'A'.repeat(18);
      const result = validator.validate('test.fa', `>seq1\n${seq}`, {
        backend: 'ionq-forte-enterprise',
        operation: 'encode',
      });
      expect(result.valid).toBe(true);
    });

    it('defaults to encode operation when not specified', () => {
      // Local simulator: max 17 bases for encode
      const seq = 'A'.repeat(18);
      const result = validator.validate('test.fa', `>seq1\n${seq}`, {
        backend: 'braket-local-simulator',
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0].details!.operation).toBe('encode');
    });

    it('does not check backend limit when no backend specified', () => {
      // Very long sequence, but no backend specified → should pass
      const seq = 'A'.repeat(200);
      const result = validator.validate('test.fa', `>seq1\n${seq}`);
      expect(result.valid).toBe(true);
    });
  });
});
