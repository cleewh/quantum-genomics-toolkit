/**
 * Genome Compressor
 * Partitions genomes that exceed backend capacity into overlapping segments
 * and reassembles them back into the original sequence.
 */

import {
  ParsedSequence,
  EncodingScheme,
  PartitionedGenome,
  GenomeSegment,
} from '../types/index.js';

export interface GenomeCompressor {
  partition(
    sequence: ParsedSequence,
    targetQubitCount: number,
    scheme: EncodingScheme,
    overlapNucleotides?: number
  ): PartitionedGenome;

  reassemble(partitions: PartitionedGenome): ParsedSequence;
}

const DEFAULT_OVERLAP_NUCLEOTIDES = 10;

/**
 * Default implementation of the GenomeCompressor interface.
 * Uses a sliding window approach with overlapping segments.
 */
export class DefaultGenomeCompressor implements GenomeCompressor {
  /**
   * Partitions a genome into segments that each fit within the target backend's qubit capacity.
   *
   * Algorithm:
   * - maxBasesPerSegment = floor(targetQubitCount / qubitsPerBase)
   * - effectiveStep = maxBasesPerSegment - overlapNucleotides
   * - Slide a window of size maxBasesPerSegment with step size effectiveStep
   */
  partition(
    sequence: ParsedSequence,
    targetQubitCount: number,
    scheme: EncodingScheme,
    overlapNucleotides: number = DEFAULT_OVERLAP_NUCLEOTIDES
  ): PartitionedGenome {
    const maxBasesPerSegment = Math.floor(targetQubitCount / scheme.qubitsPerBase);

    if (maxBasesPerSegment <= overlapNucleotides) {
      throw new Error(
        `Target qubit count (${targetQubitCount}) is too small to accommodate overlap of ${overlapNucleotides} nucleotides with ${scheme.qubitsPerBase} qubits per base. ` +
        `Max bases per segment (${maxBasesPerSegment}) must exceed overlap size.`
      );
    }

    const nucleotides = sequence.nucleotides;
    const seqLength = nucleotides.length;

    // If the sequence already fits in a single segment, return it as one segment
    if (seqLength <= maxBasesPerSegment) {
      return {
        segments: [
          {
            index: 0,
            nucleotides: nucleotides,
            startPosition: 0,
            endPosition: seqLength - 1,
            overlapWithNext: 0,
          },
        ],
        originalLength: seqLength,
        overlapSize: overlapNucleotides,
        totalSegments: 1,
      };
    }

    const effectiveStep = maxBasesPerSegment - overlapNucleotides;
    const segments: GenomeSegment[] = [];
    let startPos = 0;
    let index = 0;

    while (startPos < seqLength) {
      const endPos = Math.min(startPos + maxBasesPerSegment, seqLength);
      const segmentNucleotides = nucleotides.slice(startPos, endPos);

      const isLastSegment = endPos >= seqLength;
      const overlapWithNext = isLastSegment ? 0 : overlapNucleotides;

      segments.push({
        index,
        nucleotides: segmentNucleotides,
        startPosition: startPos,
        endPosition: endPos - 1,
        overlapWithNext,
      });

      if (isLastSegment) {
        break;
      }

      startPos += effectiveStep;
      index++;
    }

    return {
      segments,
      originalLength: seqLength,
      overlapSize: overlapNucleotides,
      totalSegments: segments.length,
    };
  }

  /**
   * Reassembles a partitioned genome back into the original sequence.
   *
   * Algorithm:
   * - Take the first segment fully
   * - For each subsequent segment, skip the first `overlapSize` nucleotides and append the rest
   */
  reassemble(partitions: PartitionedGenome): ParsedSequence {
    if (partitions.segments.length === 0) {
      return {
        id: 'reassembled',
        description: 'Reassembled from partitions',
        nucleotides: '',
        length: 0,
        type: 'DNA',
        metadata: {},
      };
    }

    const sortedSegments = [...partitions.segments].sort((a, b) => a.index - b.index);

    let reassembled = sortedSegments[0].nucleotides;

    for (let i = 1; i < sortedSegments.length; i++) {
      const segment = sortedSegments[i];
      // Skip the overlap portion and append the rest
      const newContent = segment.nucleotides.slice(partitions.overlapSize);
      reassembled += newContent;
    }

    return {
      id: 'reassembled',
      description: 'Reassembled from partitions',
      nucleotides: reassembled,
      length: reassembled.length,
      type: 'DNA',
      metadata: {},
    };
  }
}
