/**
 * CLI benchmark command.
 *
 * Runs noise benchmarking across configurations.
 * Usage: quantum-encode benchmark [--lengths] [--backends] [--shots] [--output] [--format]
 */

import type { Command } from 'commander';
import { NoiseBenchmarker, type BenchmarkConfig } from '../../noise-benchmarker/noise-benchmarker.js';
import { LocalSimulatorExecutor } from '../executor.js';
import {
  resolveBackend,
  formatOutput,
  writeOutput,
  isPaidBackend,
  type OutputFormat,
} from '../utils.js';
import { CostEstimator } from '../../cost-estimator/cost-estimator.js';
import type { ExtendedBackendId } from '../../types.js';

export function registerBenchmarkCommand(program: Command): void {
  program
    .command('benchmark')
    .description('Run noise benchmarking across sequence lengths, backends, and shot counts')
    .option('--lengths <lengths>', 'Comma-separated sequence lengths (e.g., 2,4,8)', '2,4,8')
    .option('--backends <backends>', 'Comma-separated backend names (e.g., local,sv1)', 'local')
    .option('--shots <shots>', 'Comma-separated shot counts (e.g., 100,500,1000)', '100,500,1000')
    .action(async (opts: { lengths: string; backends: string; shots: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const format: OutputFormat = globalOpts.format ?? 'text';
      const outputPath: string | undefined = globalOpts.output;
      const skipConfirm: boolean = globalOpts.yes ?? false;

      try {
        // Parse options
        const sequenceLengths = opts.lengths.split(',').map(s => parseInt(s.trim(), 10));
        const backendNames = opts.backends.split(',').map(s => s.trim());
        const shotCounts = opts.shots.split(',').map(s => parseInt(s.trim(), 10));

        // Resolve backend names
        const backends: ExtendedBackendId[] = backendNames.map(name => resolveBackend(name));

        // Check for paid backends
        const hasPaidBackends = backends.some(b => isPaidBackend(b));
        if (hasPaidBackends && !skipConfirm) {
          const costEstimator = new CostEstimator();
          const totalCombinations = sequenceLengths.length * backends.length * shotCounts.length;
          process.stderr.write(
            `Benchmark will run ${totalCombinations} combinations.\n` +
            `Some backends are paid. Use --yes to skip confirmation, or Ctrl+C to cancel.\n`
          );
          if (!skipConfirm) {
            process.stderr.write('Error: Paid backend requires --yes flag for non-interactive execution.\n');
            process.exit(1);
          }
        }

        // Build config
        const config: BenchmarkConfig = {
          sequenceLengths,
          backends,
          shotCounts,
        };

        // Execute benchmark with progress
        const benchmarker = new NoiseBenchmarker();
        const executor = new LocalSimulatorExecutor();

        const report = await benchmarker.run(config, executor, (progress) => {
          process.stderr.write(`\r[${progress.completedPercent.toFixed(0)}%] ${progress.currentCombination}`);
        });

        // Clear progress line
        process.stderr.write('\n');

        // Format output
        if (format === 'json') {
          const output = formatOutput(report, 'json');
          writeOutput(output, outputPath);
        } else {
          const textReport = benchmarker.formatReport(report);
          writeOutput(textReport, outputPath);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
