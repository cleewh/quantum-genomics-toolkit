import { describe, it, expect } from 'vitest';
import { SequenceValidatorImpl, UploadedFile } from '../../src/validators/sequence-validator.js';

const validator = new SequenceValidatorImpl();

// ─── Helper ──────────────────────────────────────────────────────────────────

function makeFile(filename: string, content: string): UploadedFile {
  return { filename, content };
}

// ─── FASTA Tests ─────────────────────────────────────────────────────────────

describe('SequenceValidator - FASTA', () => {
  it('should validate a correct FASTA file', async () => {
    const file = makeFile('test.fasta', '>seq1 Example sequence\nACGTACGT\nACGT\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.format).toBe('FASTA');
    expect(result.sequenceLength).toBe(12);
    expect(result.errors).toHaveLength(0);
  });

  it('should parse a FASTA file and extract sequence data', async () => {
    const file = makeFile('test.fasta', '>myseq A test sequence\nACGTACGT\n');
    const seq = await validator.parse(file);

    expect(seq.id).toBe('myseq');
    expect(seq.description).toBe('A test sequence');
    expect(seq.nucleotides).toBe('ACGTACGT');
    expect(seq.length).toBe(8);
    expect(seq.type).toBe('DNA');
  });

  it('should detect RNA sequences with U nucleotides', async () => {
    const file = makeFile('test.fasta', '>rna_seq RNA example\nACGUACGU\n');
    const seq = await validator.parse(file);

    expect(seq.type).toBe('RNA');
    expect(seq.nucleotides).toBe('ACGUACGU');
  });

  it('should report errors for invalid nucleotide characters', async () => {
    const file = makeFile('test.fasta', '>seq1\nACGXTZ\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    // Check that errors reference correct line and column
    const xError = result.errors.find((e) => e.message.includes("'X'"));
    expect(xError).toBeDefined();
    expect(xError!.line).toBe(2);
    expect(xError!.column).toBe(4);
  });

  it('should report error when no header is found', async () => {
    const file = makeFile('test.fasta', 'ACGTACGT\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('header'))).toBe(true);
  });

  it('should handle multiline sequences', async () => {
    const file = makeFile('test.fa', '>seq1\nACGT\nACGT\nACGT\n');
    const seq = await validator.parse(file);

    expect(seq.nucleotides).toBe('ACGTACGTACGT');
    expect(seq.length).toBe(12);
  });

  it('should handle lowercase nucleotides by converting to uppercase', async () => {
    const file = makeFile('test.fasta', '>seq1\nacgtacgt\n');
    const seq = await validator.parse(file);

    expect(seq.nucleotides).toBe('ACGTACGT');
  });
});

// ─── FASTQ Tests ─────────────────────────────────────────────────────────────

describe('SequenceValidator - FASTQ', () => {
  it('should validate a correct FASTQ file', async () => {
    const file = makeFile('test.fastq', '@seq1 description\nACGTACGT\n+\n!!!!!!!!\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.format).toBe('FASTQ');
    expect(result.sequenceLength).toBe(8);
    expect(result.errors).toHaveLength(0);
  });

  it('should parse a FASTQ file and extract sequence data', async () => {
    const file = makeFile('test.fastq', '@read1 paired-end\nACGTTGCA\n+\nIIIIIIII\n');
    const seq = await validator.parse(file);

    expect(seq.id).toBe('read1');
    expect(seq.description).toBe('paired-end');
    expect(seq.nucleotides).toBe('ACGTTGCA');
    expect(seq.length).toBe(8);
    expect(seq.type).toBe('DNA');
    expect(seq.metadata['quality']).toBe('IIIIIIII');
  });

  it('should report error when header does not start with @', async () => {
    const file = makeFile('test.fastq', '>seq1\nACGT\n+\n!!!!\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('@'))).toBe(true);
  });

  it('should report error when plus line is missing', async () => {
    const file = makeFile('test.fastq', '@seq1\nACGT\nNOPLUS\n!!!!\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('+'))).toBe(true);
  });

  it('should report error when quality length mismatches sequence', async () => {
    const file = makeFile('test.fastq', '@seq1\nACGTACGT\n+\n!!!\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('length'))).toBe(true);
  });

  it('should report error for invalid nucleotides in sequence line', async () => {
    const file = makeFile('test.fq', '@seq1\nACGZ\n+\n!!!!\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    const zError = result.errors.find((e) => e.message.includes("'Z'"));
    expect(zError).toBeDefined();
    expect(zError!.line).toBe(2);
    expect(zError!.column).toBe(4);
  });

  it('should report error for too few lines', async () => {
    const file = makeFile('test.fastq', '@seq1\nACGT\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('4 lines'))).toBe(true);
  });
});

// ─── GenBank Tests ───────────────────────────────────────────────────────────

describe('SequenceValidator - GenBank', () => {
  const validGenBank = `LOCUS       SCU49845     5028 bp    DNA
DEFINITION  Saccharomyces cerevisiae TCP1-beta gene.
ACCESSION   U49845
ORIGIN
        1 agatttcagg ttttgaaaaa gcaacctgat
       31 acgtacgtac gtacgtacgt acgtacgtac
//
`;

  it('should validate a correct GenBank file', async () => {
    const file = makeFile('test.gb', validGenBank);
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.format).toBe('GenBank');
    expect(result.sequenceLength).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it('should parse a GenBank file and extract sequence data', async () => {
    const file = makeFile('test.gbk', validGenBank);
    const seq = await validator.parse(file);

    expect(seq.id).toBe('SCU49845');
    expect(seq.description).toBe('Saccharomyces cerevisiae TCP1-beta gene.');
    expect(seq.nucleotides).toMatch(/^[ACGTU]+$/);
    expect(seq.length).toBeGreaterThan(0);
    expect(seq.type).toBe('DNA');
    expect(seq.metadata['locus']).toBeDefined();
    expect(seq.metadata['accession']).toBe('U49845');
  });

  it('should report error for invalid characters in ORIGIN section', async () => {
    const gbWithInvalid = `LOCUS       TEST1
ORIGIN
        1 acgtxzacgt
//
`;
    const file = makeFile('test.gb', gbWithInvalid);
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message.includes('Invalid nucleotide'))).toBe(true);
  });

  it('should report error when no LOCUS line is found', async () => {
    const noLocus = `ORIGIN
        1 acgtacgt
//
`;
    const file = makeFile('test.gb', noLocus);
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('LOCUS'))).toBe(true);
  });

  it('should report error when no sequence data in ORIGIN', async () => {
    const noOrigin = `LOCUS       TEST1
DEFINITION  Test sequence.
//
`;
    const file = makeFile('test.gb', noOrigin);
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('sequence data'))).toBe(true);
  });
});

// ─── Format Detection Tests ──────────────────────────────────────────────────

describe('SequenceValidator - Format Detection', () => {
  it('should detect FASTA format from content when extension is unknown', async () => {
    const file = makeFile('data.txt', '>seq1\nACGT\n');
    const result = await validator.validate(file);

    expect(result.format).toBe('FASTA');
  });

  it('should detect FASTQ format from content when extension is unknown', async () => {
    const file = makeFile('data.txt', '@seq1\nACGT\n+\n!!!!\n');
    const result = await validator.validate(file);

    expect(result.format).toBe('FASTQ');
  });

  it('should detect GenBank format from content when extension is unknown', async () => {
    const file = makeFile('data.txt', 'LOCUS TEST1\nORIGIN\n        1 acgt\n//\n');
    const result = await validator.validate(file);

    expect(result.format).toBe('GenBank');
  });

  it('should return error for unrecognized format', async () => {
    const file = makeFile('data.xyz', 'random content that is not a genomic format');
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Unable to detect'))).toBe(true);
  });
});

// ─── Buffer Input Tests ──────────────────────────────────────────────────────

describe('SequenceValidator - Buffer Input', () => {
  it('should handle Buffer content the same as string content', async () => {
    const content = '>seq1\nACGTACGT\n';
    const file: UploadedFile = {
      filename: 'test.fasta',
      content: Buffer.from(content, 'utf-8'),
    };
    const seq = await validator.parse(file);

    expect(seq.nucleotides).toBe('ACGTACGT');
    expect(seq.length).toBe(8);
  });
});

// ─── Size Validation Tests (Requirement 1.4) ─────────────────────────────────

describe('SequenceValidator - Size Validation', () => {
  it('should add a warning when sequence exceeds all backend capacities', async () => {
    // 55 nucleotides exceeds Rigetti Cepheus-1 max of 54
    const longSequence = 'A'.repeat(55);
    const file = makeFile('test.fasta', `>seq1 Long sequence\n${longSequence}\n`);
    const result = await validator.validate(file);

    expect(result.valid).toBe(true); // still valid, just has a warning
    expect(result.sequenceLength).toBe(55);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('exceeds the maximum supported length'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('54 nucleotides'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Genome_Compressor'))).toBe(true);
  });

  it('should not add a warning when sequence fits within the largest backend', async () => {
    // 54 nucleotides fits exactly in Rigetti Cepheus-1
    const sequence = 'ACGT'.repeat(13) + 'AC'; // 54 nucleotides
    const file = makeFile('test.fasta', `>seq1 Fits in Rigetti\n${sequence}\n`);
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should not add a warning for short sequences', async () => {
    const file = makeFile('test.fasta', '>seq1\nACGTACGT\n');
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should include sequence length and required qubits in the warning message', async () => {
    const longSequence = 'ACGT'.repeat(20); // 80 nucleotides
    const file = makeFile('test.fasta', `>seq1\n${longSequence}\n`);
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    const warning = result.warnings.find((w) => w.includes('Genome_Compressor'))!;
    expect(warning).toContain('80 nucleotides');
    expect(warning).toContain('160 qubits'); // 80 * 2 qubits per base
    expect(warning).toContain('partition');
  });

  it('should not add size warning when file has parse errors', async () => {
    // Invalid characters mean the sequence won't be fully parsed
    const longInvalid = 'X'.repeat(100);
    const file = makeFile('test.fasta', `>seq1\n${longInvalid}\n`);
    const result = await validator.validate(file);

    expect(result.valid).toBe(false);
    // Should not have the size warning since there are parse errors
    expect(result.warnings.every((w) => !w.includes('exceeds the maximum supported length'))).toBe(true);
  });

  it('should add warning for FASTQ files that exceed all backends', async () => {
    const longSequence = 'A'.repeat(60);
    const quality = '!'.repeat(60);
    const file = makeFile('test.fastq', `@seq1\n${longSequence}\n+\n${quality}\n`);
    const result = await validator.validate(file);

    expect(result.valid).toBe(true);
    expect(result.warnings.some((w) => w.includes('exceeds the maximum supported length'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('Genome_Compressor'))).toBe(true);
  });
});
