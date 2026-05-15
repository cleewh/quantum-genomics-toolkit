/**
 * CLI compare command.
 *
 * Compares two FASTA files using a quantum SWAP test.
 * Usage: quantum-encode compare <fasta-a> <fasta-b> [--backend] [--output] [--format]
 */

import type { Command } from 'commander';
import { SwapTestComparator } from '../../swap-test/swap-test-comparator.js';
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

export function registerCompareCommand(program: Command): void {
  program
    .command('compare')
    .description('Compare two FASTA sequences using a quantum SWAP test')
    .argument('<fasta-a>', 'Path to first FASTA file')
    .argument('<fasta-b>', 'Path to second FASTA file')
    .action(async (fastaA: string, fastaB: string, _opts: unknown, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const backend = resolveBackend(globalOpts.backend ?? 'local');
      const region: string = getEffectiveRegion(backend, globalOpts.region);
      const format: OutputFormat = globalOpts.format ?? 'text';
      const outputPath: string | undefined = globalOpts.output;
      const skipConfirm: boolean = globalOpts.yes ?? false;

      try {
        // Read and validate both files
        const contentA = readFastaFile(fastaA);
        const contentB = readFastaFile(fastaB);
        const filenameA = getFilename(fastaA);
        const filenameB = getFilename(fastaB);

        // Pre-check: show friendly limit message for SWAP test
        const enforcer = new QubitLimitEnforcer();
        const maxLen = enforcer.getMaxSequenceLength('swap-test', backend);
        const backendConfig = EXTENDED_BACKENDS[backend];
        process.stderr.write(
          `SWAP test limit: max ${maxLen} bases per sequence on ${backendConfig.name} (${backendConfig.qubitCount} qubits, region: ${region})\n`
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

        // Execute comparison
        const executor = new LocalSimulatorExecutor();
        const comparator = new SwapTestComparator(executor);
        const result = await comparator.compare(contentA, filenameA, contentB, filenameB, {
          backend,
          shots: 1000,
        });

        // Format output
        const outputData = format === 'json' ? {
          similarityScore: result.similarityScore,
          sequenceA: result.sequenceA.nucleotides,
          sequenceB: result.sequenceB.nucleotides,
          sequenceLength: result.sequenceA.length,
          totalShots: result.totalShots,
          ancillaMeasurements: result.ancillaMeasurements,
          circuitMetadata: result.circuitMetadata,
          backend,
          costEstimate: result.costEstimate,
        } : {
          'Similarity Score': result.similarityScore.toFixed(4),
          'Sequence A': result.sequenceA.nucleotides,
          'Sequence B': result.sequenceB.nucleotides,
          'Sequence Length': `${result.sequenceA.length} bases`,
          'Total Shots': result.totalShots,
          'Backend': backend,
          'Qubits': result.circuitMetadata.qubitCount,
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
