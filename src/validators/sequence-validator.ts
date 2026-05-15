/**
 * Sequence Validator - Parses and validates genomic files in FASTA, FASTQ, and GenBank formats.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5
 */

import { ValidationResult, ValidationError, ParsedSequence } from '../types/index.js';
import { BACKENDS, MAX_SEQUENCE_LENGTH } from '../types/backends.js';

// ─── UploadedFile Interface ──────────────────────────────────────────────────

export interface UploadedFile {
  filename: string;
  content: string | Buffer;
}

// ─── SequenceValidator Interface ─────────────────────────────────────────────

export interface SequenceValidator {
  validate(file: UploadedFile): Promise<ValidationResult>;
  parse(file: UploadedFile): Promise<ParsedSequence>;
}

// ─── Format Detection ────────────────────────────────────────────────────────

type SequenceFormat = 'FASTA' | 'FASTQ' | 'GenBank';

function detectFormat(file: UploadedFile): SequenceFormat | null {
  const ext = file.filename.toLowerCase();
  if (ext.endsWith('.fasta') || ext.endsWith('.fa') || ext.endsWith('.fna')) {
    return 'FASTA';
  }
  if (ext.endsWith('.fastq') || ext.endsWith('.fq')) {
    return 'FASTQ';
  }
  if (ext.endsWith('.gb') || ext.endsWith('.gbk') || ext.endsWith('.genbank')) {
    return 'GenBank';
  }

  // Fallback: detect from content
  const text = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');
  const trimmed = text.trimStart();

  if (trimmed.startsWith('>')) return 'FASTA';
  if (trimmed.startsWith('@')) return 'FASTQ';
  if (trimmed.startsWith('LOCUS')) return 'GenBank';

  return null;
}

// ─── Valid Nucleotide Characters ─────────────────────────────────────────────

const VALID_NUCLEOTIDES = new Set(['A', 'C', 'G', 'T', 'U']);

function isValidNucleotide(char: string): boolean {
  return VALID_NUCLEOTIDES.has(char.toUpperCase());
}

// ─── FASTA Parser ────────────────────────────────────────────────────────────

function parseFasta(text: string): { sequence: ParsedSequence; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const lines = text.split(/\r?\n/);

  let id = '';
  let description = '';
  let nucleotides = '';
  let headerFound = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.trim() === '') continue;

    if (line.startsWith('>')) {
      if (headerFound) {
        // We only parse the first sequence for simplicity
        break;
      }
      headerFound = true;
      const headerContent = line.substring(1).trim();
      const spaceIdx = headerContent.indexOf(' ');
      if (spaceIdx === -1) {
        id = headerContent;
        description = '';
      } else {
        id = headerContent.substring(0, spaceIdx);
        description = headerContent.substring(spaceIdx + 1);
      }
      continue;
    }

    if (!headerFound) {
      errors.push({
        line: lineNum,
        column: 1,
        message: 'Sequence data found before header line (expected line starting with ">")',
        severity: 'error',
      });
      continue;
    }

    // Validate each character in the sequence line
    for (let col = 0; col < line.length; col++) {
      const char = line[col];
      if (char.trim() === '') continue; // skip whitespace
      if (!isValidNucleotide(char)) {
        errors.push({
          line: lineNum,
          column: col + 1,
          message: `Invalid nucleotide character '${char}' (expected A, C, G, T, or U)`,
          severity: 'error',
        });
      } else {
        nucleotides += char.toUpperCase();
      }
    }
  }

  if (!headerFound) {
    errors.push({
      line: 1,
      column: 1,
      message: 'No FASTA header found (expected line starting with ">")',
      severity: 'error',
    });
  }

  const type = nucleotides.includes('U') ? 'RNA' : 'DNA';

  return {
    sequence: {
      id,
      description,
      nucleotides,
      length: nucleotides.length,
      type,
      metadata: {},
    },
    errors,
  };
}

// ─── FASTQ Parser ────────────────────────────────────────────────────────────

function parseFastq(text: string): { sequence: ParsedSequence; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const lines = text.split(/\r?\n/);

  // Remove trailing empty lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  let id = '';
  let description = '';
  let nucleotides = '';

  // FASTQ format: 4-line records: @header, sequence, +, quality
  if (lines.length < 4) {
    errors.push({
      line: 1,
      column: 1,
      message: 'FASTQ file must contain at least 4 lines (@header, sequence, +, quality)',
      severity: 'error',
    });
    return {
      sequence: { id: '', description: '', nucleotides: '', length: 0, type: 'DNA', metadata: {} },
      errors,
    };
  }

  // Parse first record
  const headerLine = lines[0];
  const seqLine = lines[1];
  const plusLine = lines[2];
  const qualLine = lines[3];

  // Validate header
  if (!headerLine.startsWith('@')) {
    errors.push({
      line: 1,
      column: 1,
      message: 'FASTQ header must start with "@"',
      severity: 'error',
    });
  } else {
    const headerContent = headerLine.substring(1).trim();
    const spaceIdx = headerContent.indexOf(' ');
    if (spaceIdx === -1) {
      id = headerContent;
      description = '';
    } else {
      id = headerContent.substring(0, spaceIdx);
      description = headerContent.substring(spaceIdx + 1);
    }
  }

  // Validate sequence line
  for (let col = 0; col < seqLine.length; col++) {
    const char = seqLine[col];
    if (!isValidNucleotide(char)) {
      errors.push({
        line: 2,
        column: col + 1,
        message: `Invalid nucleotide character '${char}' (expected A, C, G, T, or U)`,
        severity: 'error',
      });
    } else {
      nucleotides += char.toUpperCase();
    }
  }

  // Validate plus line
  if (!plusLine.startsWith('+')) {
    errors.push({
      line: 3,
      column: 1,
      message: 'Third line of FASTQ record must start with "+"',
      severity: 'error',
    });
  }

  // Validate quality line length matches sequence length
  if (qualLine.length !== seqLine.length) {
    errors.push({
      line: 4,
      column: 1,
      message: `Quality line length (${qualLine.length}) does not match sequence length (${seqLine.length})`,
      severity: 'error',
    });
  }

  const type = nucleotides.includes('U') ? 'RNA' : 'DNA';

  return {
    sequence: {
      id,
      description,
      nucleotides,
      length: nucleotides.length,
      type,
      metadata: { quality: qualLine },
    },
    errors,
  };
}

// ─── GenBank Parser ──────────────────────────────────────────────────────────

function parseGenBank(text: string): { sequence: ParsedSequence; errors: ValidationError[] } {
  const errors: ValidationError[] = [];
  const lines = text.split(/\r?\n/);

  let id = '';
  let description = '';
  let nucleotides = '';
  let inOrigin = false;
  const metadata: Record<string, string> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    if (line.startsWith('LOCUS')) {
      const parts = line.substring(5).trim().split(/\s+/);
      if (parts.length > 0) {
        id = parts[0];
      }
      metadata['locus'] = line.substring(5).trim();
      continue;
    }

    if (line.startsWith('DEFINITION')) {
      description = line.substring(10).trim();
      continue;
    }

    if (line.startsWith('ACCESSION')) {
      metadata['accession'] = line.substring(9).trim();
      continue;
    }

    if (line.startsWith('ORIGIN')) {
      inOrigin = true;
      continue;
    }

    if (line.startsWith('//')) {
      inOrigin = false;
      break;
    }

    if (inOrigin) {
      // GenBank ORIGIN lines: positions followed by sequence in groups of 10
      // e.g., "        1 agatttcagg tttgaaaaag ..."
      const seqContent = line.replace(/[0-9]/g, '').replace(/\s/g, '');
      for (let col = 0; col < seqContent.length; col++) {
        const char = seqContent[col];
        if (!isValidNucleotide(char)) {
          errors.push({
            line: lineNum,
            column: col + 1,
            message: `Invalid nucleotide character '${char}' in ORIGIN section (expected A, C, G, T, or U)`,
            severity: 'error',
          });
        } else {
          nucleotides += char.toUpperCase();
        }
      }
    }
  }

  if (!id) {
    errors.push({
      line: 1,
      column: 1,
      message: 'No LOCUS line found in GenBank file',
      severity: 'error',
    });
  }

  if (nucleotides.length === 0 && errors.length === 0) {
    errors.push({
      line: 1,
      column: 1,
      message: 'No sequence data found in ORIGIN section',
      severity: 'error',
    });
  }

  const type = nucleotides.includes('U') ? 'RNA' : 'DNA';

  return {
    sequence: {
      id,
      description,
      nucleotides,
      length: nucleotides.length,
      type,
      metadata,
    },
    errors,
  };
}

// ─── SequenceValidator Implementation ────────────────────────────────────────

export class SequenceValidatorImpl implements SequenceValidator {
  async validate(file: UploadedFile): Promise<ValidationResult> {
    const text = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');

    const format = detectFormat(file);
    if (!format) {
      return {
        valid: false,
        errors: [
          {
            line: 1,
            column: 1,
            message: 'Unable to detect file format. Supported formats: FASTA, FASTQ, GenBank',
            severity: 'error',
          },
        ],
        warnings: [],
        sequenceLength: 0,
        format: 'FASTA', // default fallback
      };
    }

    let result: { sequence: ParsedSequence; errors: ValidationError[] };

    switch (format) {
      case 'FASTA':
        result = parseFasta(text);
        break;
      case 'FASTQ':
        result = parseFastq(text);
        break;
      case 'GenBank':
        result = parseGenBank(text);
        break;
    }

    const warnings: string[] = [];
    if (result.sequence.length === 0 && result.errors.length === 0) {
      warnings.push('File parsed successfully but no nucleotide sequence data was found');
    }

    // Check if sequence exceeds all backend capacities (Requirement 1.4)
    const hasParseErrors = result.errors.filter((e) => e.severity === 'error').length > 0;
    if (!hasParseErrors && result.sequence.length > 0) {
      const sizeWarning = this.checkSizeAgainstBackends(result.sequence.length);
      if (sizeWarning) {
        warnings.push(sizeWarning);
      }
    }

    return {
      valid: result.errors.filter((e) => e.severity === 'error').length === 0,
      errors: result.errors,
      warnings,
      sequenceLength: result.sequence.length,
      format,
    };
  }

  /**
   * Checks if the sequence length exceeds the maximum capacity of all available backends.
   * Uses the default encoding of 2 qubits per base to calculate the maximum nucleotide
   * length each backend can handle.
   *
   * Returns a warning message if the sequence exceeds ALL backends, or null if at least
   * one backend can handle it.
   */
  private checkSizeAgainstBackends(sequenceLength: number): string | null {
    const DEFAULT_QUBITS_PER_BASE = 2;
    const requiredQubits = sequenceLength * DEFAULT_QUBITS_PER_BASE;

    // Find the maximum supported sequence length across all backends
    let maxSupportedLength = 0;
    for (const backendId of Object.keys(BACKENDS)) {
      const maxLen = MAX_SEQUENCE_LENGTH[backendId] ?? Math.floor(BACKENDS[backendId].qubitCount / DEFAULT_QUBITS_PER_BASE);
      if (maxLen > maxSupportedLength) {
        maxSupportedLength = maxLen;
      }
    }

    // If the sequence fits in at least one backend, no warning needed
    if (sequenceLength <= maxSupportedLength) {
      return null;
    }

    return (
      `Sequence length (${sequenceLength} nucleotides) exceeds the maximum supported length ` +
      `(${maxSupportedLength} nucleotides, requiring ${requiredQubits} qubits with 2 qubits per base) ` +
      `for all available quantum backends. Consider using the Genome_Compressor to partition ` +
      `the sequence into smaller segments that fit within backend capacity.`
    );
  }

  async parse(file: UploadedFile): Promise<ParsedSequence> {
    const text = typeof file.content === 'string' ? file.content : file.content.toString('utf-8');

    const format = detectFormat(file);
    if (!format) {
      throw new Error('Unable to detect file format. Supported formats: FASTA, FASTQ, GenBank');
    }

    let result: { sequence: ParsedSequence; errors: ValidationError[] };

    switch (format) {
      case 'FASTA':
        result = parseFasta(text);
        break;
      case 'FASTQ':
        result = parseFastq(text);
        break;
      case 'GenBank':
        result = parseGenBank(text);
        break;
    }

    if (result.errors.filter((e) => e.severity === 'error').length > 0) {
      throw new Error(
        `Parsing failed with errors: ${result.errors.map((e) => `Line ${e.line}, Col ${e.column}: ${e.message}`).join('; ')}`
      );
    }

    return result.sequence;
  }
}
