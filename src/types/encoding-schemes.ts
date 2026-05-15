/**
 * Default and predefined encoding schemes for nucleotide-to-qubit mapping.
 */

import { EncodingScheme, Nucleotide } from './index.js';

/**
 * Default 2-qubit computational basis encoding for DNA.
 * Maps each nucleotide to a unique 2-bit string:
 *   A → 00, C → 01, G → 10, T → 11
 */
export const DEFAULT_DNA_ENCODING_SCHEME: EncodingScheme = {
  name: 'default-2qubit-basis',
  qubitsPerBase: 2,
  mapping: {
    A: '00',
    C: '01',
    G: '10',
    T: '11',
    U: '11', // U treated same as T for DNA/RNA compatibility
  } as Record<Nucleotide, string>,
};

/**
 * Default 2-qubit computational basis encoding for RNA.
 * Maps each nucleotide to a unique 2-bit string:
 *   A → 00, C → 01, G → 10, U → 11
 */
export const DEFAULT_RNA_ENCODING_SCHEME: EncodingScheme = {
  name: 'default-2qubit-basis-rna',
  qubitsPerBase: 2,
  mapping: {
    A: '00',
    C: '01',
    G: '10',
    T: '11', // T treated same as U for RNA/DNA compatibility
    U: '11',
  } as Record<Nucleotide, string>,
};

/**
 * Returns the appropriate default encoding scheme for the given sequence type.
 */
export function getDefaultEncodingScheme(sequenceType: 'DNA' | 'RNA'): EncodingScheme {
  return sequenceType === 'RNA' ? DEFAULT_RNA_ENCODING_SCHEME : DEFAULT_DNA_ENCODING_SCHEME;
}
