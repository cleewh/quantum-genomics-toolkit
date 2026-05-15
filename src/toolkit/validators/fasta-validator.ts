/**
 * FASTA Validator for the Quantum Genomics Toolkit.
 *
 * Validates FASTA files for toolkit commands with strict requirements:
 * - Only .fa and .fasta extensions accepted
 * - Proper FASTA format (header starting with ">", valid sequence lines)
 * - No ambiguous nucleotide codes (N, R, Y, W, S, M, K, B, D, H, V)
 * - Per-backend sequence length enforcement using QubitLimitEnforcer
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 */

import { ParsedSequence } from '../../types/index.js';
import { ExtendedBackendId, OperationType } from '../types.js';
import { QubitLimitEnforcer } from '../qubit-limits.js';

// ─── FASTA Validation Result Types ───────────────────────────────────────────

export interface FastaValidationResult {
  valid: boolean;
  errors: FastaValidationError[];
  sequence?: ParsedSequence;
}

export interface FastaValidationError {
  type: 'wrong-extension' | 'invalid-format' | 'ambiguous-codes' | 'exceeds-backend-limit';
  message: string;
  details?: {
    invalidCharacters?: { char: string; position: number }[];
    maxAllowed?: number;
    actualLength?: number;
    backend?: ExtendedBackendId;
    operation?: string;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const VALID_EXTENSIONS = ['.fa', '.fasta'];

const VALID_NUCLEOTIDES = new Set(['A', 'C', 'G', 'T', 'U']);

/**
 * IUPAC ambiguous nucleotide codes that quantum encoding cannot handle.
 */
const AMBIGUOUS_CODES = new Set(['N', 'R', 'Y', 'W', 'S', 'M', 'K', 'B', 'D', 'H', 'V']);

// ─── FASTA Validator Options ─────────────────────────────────────────────────

export interface FastaValidationOptions {
  /** If provided, validates sequence length against this backend/operation combination. */
  backend?: ExtendedBackendId;
  /** The operation type for backend limit checking. Defaults to 'encode'. */
  operation?: OperationType;
}

// ─── FASTA Validator ─────────────────────────────────────────────────────────

export class FastaValidator {
  private qubitLimitEnforcer: QubitLimitEnforcer;

  constructor(qubitLimitEnforcer?: QubitLimitEnforcer) {
    this.qubitLimitEnforcer = qubitLimitEnforcer ?? new QubitLimitEnforcer();
  }

  /**
   * Validates a FASTA file for use with toolkit commands.
   *
   * @param filename - The filename (used for extension validation)
   * @param content - The file content as a string
   * @param options - Optional backend/operation for length validation
   * @returns A structured validation result
   */
  validate(filename: string, content: string, options?: FastaValidationOptions): FastaValidationResult {
    const errors: FastaValidationError[] = [];

    // Step 1: Validate file extension
    const extensionError = this.validateExtension(filename);
    if (extensionError) {
      errors.push(extensionError);
      return { valid: false, errors };
    }

    // Step 2: Parse and validate FASTA format
    const parseResult = this.parseFasta(content);
    if (parseResult.errors.length > 0) {
      return { valid: false, errors: parseResult.errors };
    }

    const sequence = parseResult.sequence!;

    // Step 3: Check for ambiguous nucleotide codes
    const ambiguousError = this.detectAmbiguousCodes(sequence.nucleotides);
    if (ambiguousError) {
      errors.push(ambiguousError);
      return { valid: false, errors, sequence };
    }

    // Step 4: Optionally check sequence length against backend/operation limit
    if (options?.backend) {
      const operation = options.operation ?? 'encode';
      const limitError = this.validateSequenceLength(sequence.length, options.backend, operation);
      if (limitError) {
        errors.push(limitError);
        return { valid: false, errors, sequence };
      }
    }

    return { valid: true, errors: [], sequence };
  }

  /**
   * Validates that the file extension is .fa or .fasta.
   */
  private validateExtension(filename: string): FastaValidationError | null {
    const lowerFilename = filename.toLowerCase();
    const hasValidExtension = VALID_EXTENSIONS.some(ext => lowerFilename.endsWith(ext));

    if (!hasValidExtension) {
      return {
        type: 'wrong-extension',
        message: `Only FASTA files are accepted (extensions: .fa, .fasta). Got: "${filename}"`,
      };
    }

    return null;
  }

  /**
   * Parses FASTA content and validates format structure.
   * Returns the parsed sequence or format errors.
   */
  private parseFasta(content: string): { sequence?: ParsedSequence; errors: FastaValidationError[] } {
    const errors: FastaValidationError[] = [];
    const lines = content.split(/\r?\n/);

    let id = '';
    let description = '';
    let nucleotides = '';
    let headerFound = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.trim() === '') continue;

      if (line.startsWith('>')) {
        if (headerFound) {
          // Only parse the first sequence
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
          type: 'invalid-format',
          message: 'Invalid FASTA format: file must begin with a header line starting with ">"',
        });
        return { errors };
      }

      // Validate sequence characters
      for (let col = 0; col < line.length; col++) {
        const char = line[col].toUpperCase();
        if (char.trim() === '') continue; // skip whitespace

        if (VALID_NUCLEOTIDES.has(char) || AMBIGUOUS_CODES.has(char)) {
          // Collect all characters (including ambiguous) for now;
          // ambiguous detection happens in a separate step
          nucleotides += char;
        } else {
          errors.push({
            type: 'invalid-format',
            message: `Invalid FASTA format: sequence contains invalid character '${line[col]}' at line ${i + 1}, column ${col + 1}. Only valid nucleotide characters (A, C, G, T, U) are accepted.`,
          });
          return { errors };
        }
      }
    }

    if (!headerFound) {
      errors.push({
        type: 'invalid-format',
        message: 'Invalid FASTA format: no header line found (expected line starting with ">")',
      });
      return { errors };
    }

    if (nucleotides.length === 0) {
      errors.push({
        type: 'invalid-format',
        message: 'Invalid FASTA format: no sequence data found after header line',
      });
      return { errors };
    }

    const type = nucleotides.includes('U') ? 'RNA' : 'DNA';

    const sequence: ParsedSequence = {
      id,
      description,
      nucleotides,
      length: nucleotides.length,
      type,
      metadata: {},
    };

    return { sequence, errors: [] };
  }

  /**
   * Detects ambiguous IUPAC nucleotide codes that quantum encoding cannot handle.
   * Reports all ambiguous characters with their positions.
   */
  private detectAmbiguousCodes(nucleotides: string): FastaValidationError | null {
    const invalidCharacters: { char: string; position: number }[] = [];

    for (let i = 0; i < nucleotides.length; i++) {
      const char = nucleotides[i];
      if (AMBIGUOUS_CODES.has(char)) {
        invalidCharacters.push({ char, position: i });
      }
    }

    if (invalidCharacters.length === 0) {
      return null;
    }

    const charList = invalidCharacters
      .map(c => `'${c.char}' at position ${c.position}`)
      .join(', ');

    return {
      type: 'ambiguous-codes',
      message: `FASTA file contains ambiguous nucleotide codes that quantum encoding cannot handle: ${charList}`,
      details: {
        invalidCharacters,
      },
    };
  }

  /**
   * Validates that the sequence length does not exceed the backend's capacity
   * for the given operation.
   */
  private validateSequenceLength(
    sequenceLength: number,
    backend: ExtendedBackendId,
    operation: OperationType
  ): FastaValidationError | null {
    const result = this.qubitLimitEnforcer.enforce(operation, sequenceLength, backend);

    if (result.allowed) {
      return null;
    }

    const maxAllowed = this.qubitLimitEnforcer.getMaxSequenceLength(operation, backend);

    return {
      type: 'exceeds-backend-limit',
      message: `Sequence length (${sequenceLength} bases) exceeds the maximum allowed for operation '${operation}' on backend '${backend}' (max: ${maxAllowed} bases)`,
      details: {
        maxAllowed,
        actualLength: sequenceLength,
        backend,
        operation,
      },
    };
  }
}
