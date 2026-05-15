/**
 * Grover Search module - builds Grover oracle circuits to locate motifs with quadratic speedup.
 */

export { GroverSearchEngine } from './grover-search-engine.js';
export type {
  GroverSearchConfig,
  GroverSearchResult,
  MotifValidationError,
  CircuitExecutor,
} from './grover-search-engine.js';
