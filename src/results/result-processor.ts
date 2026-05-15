/**
 * Result Processor implementation.
 * Decodes quantum measurement bitstrings into genomic sequences with confidence scoring,
 * and generates reports in FASTA and VCF formats.
 */

import type {
  MeasurementResult,
  EncodingScheme,
  DecodedSequence,
  ExecutionMetadata,
  Report,
  Nucleotide,
} from '../types/index.js';

/**
 * ResultProcessor interface as defined in the design document.
 */
export interface ResultProcessorInterface {
  decode(results: MeasurementResult, scheme: EncodingScheme): DecodedSequence;
  generateReport(decoded: DecodedSequence, metadata: ExecutionMetadata): Report;
}

/**
 * Standard FASTA line width (characters per line for sequence data).
 */
const FASTA_LINE_WIDTH = 80;

/**
 * Low confidence threshold. If average confidence is below this, flag results.
 */
const LOW_CONFIDENCE_THRESHOLD = 0.7;

/**
 * Very low per-base confidence threshold for individual base warnings.
 */
const VERY_LOW_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Implementation of the ResultProcessor.
 *
 * Decodes quantum measurement results back into nucleotide sequences using
 * majority vote per base position, calculates confidence scores, and generates
 * reports in standard bioinformatics formats.
 */
export class ResultProcessor implements ResultProcessorInterface {
  /**
   * Decodes measurement results into a nucleotide sequence with confidence scores.
   *
   * For each base position:
   * 1. Extract the relevant bits from each measurement bitstring
   * 2. Count how many shots produced each possible bit pattern
   * 3. The majority bit pattern determines the decoded nucleotide (reverse lookup)
   * 4. Confidence = count of majority pattern / totalShots
   *
   * Sets lowConfidenceFlag to true when average confidence < 0.7.
   *
   * @param results - The measurement results from quantum execution
   * @param scheme - The encoding scheme used during encoding
   * @returns A DecodedSequence with nucleotides, confidence scores, and flags
   */
  decode(results: MeasurementResult, scheme: EncodingScheme): DecodedSequence {
    const { bitstrings, totalShots } = results;
    const { qubitsPerBase, mapping } = scheme;

    // Build reverse mapping: bitstring → nucleotide
    // Use first-wins strategy so that T (DNA primary) takes precedence over U
    const reverseMapping: Record<string, Nucleotide> = {};
    for (const [nucleotide, bits] of Object.entries(mapping)) {
      if (!(bits in reverseMapping)) {
        reverseMapping[bits] = nucleotide as Nucleotide;
      }
    }

    // Determine number of bases from the bitstring length
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
    const lowConfidenceFlag = averageConfidence < LOW_CONFIDENCE_THRESHOLD;

    return {
      nucleotides: nucleotides.join(''),
      perBaseConfidence,
      averageConfidence,
      lowConfidenceFlag,
    };
  }

  /**
   * Generates a report from a decoded sequence with FASTA output, confidence scores,
   * and recommendations.
   *
   * FASTA output format:
   * - Header line: >decoded_{jobId} Decoded from quantum measurement | confidence={avg}
   * - Sequence lines: 80 characters per line (standard FASTA line width)
   *
   * Recommendations are generated based on confidence analysis:
   * - If lowConfidenceFlag: suggest re-execution with more shots
   * - If any base has confidence < 0.5: warn about unreliable bases
   *
   * @param decoded - The decoded sequence with confidence scores
   * @param metadata - Execution metadata (jobId, backend, shots, etc.)
   * @returns A Report with FASTA, optional VCF, confidence scores, and recommendations
   */
  generateReport(decoded: DecodedSequence, metadata: ExecutionMetadata): Report {
    const fasta = this.generateFasta(decoded, metadata);
    const vcf = this.generateVcf(decoded, metadata);
    const recommendations = this.generateRecommendations(decoded, metadata);

    return {
      fasta,
      vcf: vcf || undefined,
      confidence: decoded.perBaseConfidence,
      metadata,
      recommendations,
    };
  }

  /**
   * Generates valid FASTA format output.
   *
   * Format:
   * >decoded_{jobId} Decoded from quantum measurement | confidence={avg}
   * NUCLEOTIDES (80 chars per line)
   */
  private generateFasta(decoded: DecodedSequence, metadata: ExecutionMetadata): string {
    const avgConfidence = decoded.averageConfidence.toFixed(2);
    const header = `>decoded_${metadata.jobId} Decoded from quantum measurement | confidence=${avgConfidence}`;

    // Split sequence into lines of FASTA_LINE_WIDTH characters
    const sequenceLines: string[] = [];
    const seq = decoded.nucleotides;
    for (let i = 0; i < seq.length; i += FASTA_LINE_WIDTH) {
      sequenceLines.push(seq.slice(i, i + FASTA_LINE_WIDTH));
    }

    return header + '\n' + sequenceLines.join('\n') + '\n';
  }

  /**
   * Generates VCF output for variant calls (optional).
   * Returns null if no variants are detected (all bases are standard nucleotides).
   *
   * A simple VCF is generated when there are low-confidence bases that might
   * represent variants.
   */
  private generateVcf(decoded: DecodedSequence, metadata: ExecutionMetadata): string | null {
    // Identify positions with low confidence that could represent variants
    const variantPositions: number[] = [];
    for (let i = 0; i < decoded.perBaseConfidence.length; i++) {
      if (decoded.perBaseConfidence[i] < VERY_LOW_CONFIDENCE_THRESHOLD) {
        variantPositions.push(i);
      }
    }

    if (variantPositions.length === 0) {
      return null;
    }

    // Generate minimal VCF format
    const lines: string[] = [];
    lines.push('##fileformat=VCFv4.2');
    lines.push(`##source=QuantumGenomicsPipeline`);
    lines.push(`##jobId=${metadata.jobId}`);
    lines.push(`##backend=${metadata.backend}`);
    lines.push('#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO');

    for (const pos of variantPositions) {
      const base = decoded.nucleotides[pos] || 'N';
      const confidence = decoded.perBaseConfidence[pos];
      const qual = Math.round(confidence * 100);
      lines.push(
        `decoded_${metadata.jobId}\t${pos + 1}\t.\t${base}\t.\t${qual}\tLOW_CONF\tCONF=${confidence.toFixed(4)}`
      );
    }

    return lines.join('\n') + '\n';
  }

  /**
   * Generates recommendations based on confidence analysis.
   */
  private generateRecommendations(decoded: DecodedSequence, metadata: ExecutionMetadata): string[] {
    const recommendations: string[] = [];

    // Recommendation for low average confidence
    if (decoded.lowConfidenceFlag) {
      recommendations.push(
        `Low confidence results (avg: ${decoded.averageConfidence.toFixed(2)}). Consider re-executing with more shots (current: ${metadata.shots}).`
      );
    }

    // Recommendation for very low individual base confidence
    const veryLowConfBases = decoded.perBaseConfidence.filter(
      (c) => c < VERY_LOW_CONFIDENCE_THRESHOLD
    ).length;
    if (veryLowConfBases > 0) {
      recommendations.push(
        `${veryLowConfBases} bases have very low confidence (<0.5). Results may be unreliable.`
      );
    }

    return recommendations;
  }
}
