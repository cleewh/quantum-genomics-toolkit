/**
 * CLI search command.
 *
 * Searches for a motif within a FASTA sequence using Grover's algorithm.
 * Usage: quantum-encode search <fasta-file> --motif <pattern> [--backend] [--output] [--format]
 */

import type { Command } from 'commander';
import { GroverSearchEngine } from '../../grover-search/grover-search-engine.js';
import { LocalSimulatorExecutor } from '../executor.js';
import {
  resolveBackend,
  readFastaFile,
  getFilename,
  formatOutput,
  writeOutput,
  isPaidBackend,
  getEffectiveRegion,
  type OutputFormat,
} from '../utils.js';
import { CostEstimator } from '../../cost-estimator/cost-estimator.js';
import { QubitLimitEnforcer } from '../../qubit-limits.js';
import { EXTENDED_BACKENDS } from '../../types.js';

export function registerSearchCommand(program: Command): void {
  program
    .command('search')
    .description('Search for a DNA motif within a FASTA sequence using Grover\'s algorithm')
    .argument('<fasta-file>', 'Path to FASTA file')
    .requiredOption('--motif <pattern>', 'Nucleotide motif to search for')
    .action(async (fastaFile: string, opts: { motif: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const backend = resolveBackend(globalOpts.backend ?? 'local');
      const region: string = getEffectiveRegion(backend, globalOpts.region);
      const format: OutputFormat = globalOpts.format ?? 'text';
      const outputPath: string | undefined = globalOpts.output;
      const skipConfirm: boolean = globalOpts.yes ?? false;

      try {
        // Read and validate file
        const content = readFastaFile(fastaFile);
        const filename = getFilename(fastaFile);

        // Show Grover search limit info
        const enforcer = new QubitLimitEnforcer();
        const maxLen = enforcer.getMaxSequenceLength('grover-search', backend);
        const backendConfig = EXTENDED_BACKENDS[backend];
        process.stderr.write(
          `Grover search limit: max ${maxLen} bases on ${backendConfig.name} (${backendConfig.qubitCount} qubits, region: ${region})\n`
        );

        // Cost confirmation for paid backends
        if (isPaidBackend(backend) && !skipConfirm) {
          const costEstimator = new CostEstimator();
          const estimate = costEstimator.estimate({
            backend,
            shots: 1000,
            circuitCount: 1,
            estimatedCircuitDepth: 10,
          });
          process.stderr.write(
            `Estimated cost: $${estimate.totalCost.toFixed(4)} on ${backend}\n` +
            `Use --yes to skip confirmation, or Ctrl+C to cancel.\n`
          );
          if (!skipConfirm) {
            process.stderr.write('Error: Paid backend requires --yes flag for non-interactive execution.\n');
            process.exit(1);
          }
        }

        // Execute search
        const executor = new LocalSimulatorExecutor();
        const engine = new GroverSearchEngine(executor);
        const result = await engine.search(content, filename, opts.motif, {
          backend,
          shots: 1000,
        });

        // Format output
        const outputData = format === 'json' ? {
          positions: result.positions,
          motif: result.motif,
          sequenceLength: result.sequenceLength,
          probability: result.probability,
          iterations: result.iterations,
          circuitMetadata: result.circuitMetadata,
          backend,
          message: result.message,
          costEstimate: result.costEstimate,
        } : {
          'Motif': result.motif,
          'Positions Found': result.positions.length > 0
            ? result.positions.join(', ')
            : '(none)',
          'Sequence Length': `${result.sequenceLength} bases`,
          'Probability': result.probability.toFixed(4),
          'Grover Iterations': result.iterations,
          'Backend': backend,
          ...(result.message ? { 'Message': result.message } : {}),
        };

        const output = formatOutput(outputData, format);
        writeOutput(output, outputPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
