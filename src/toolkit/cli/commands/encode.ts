/**
 * CLI encode command.
 *
 * Encodes a FASTA file through the quantum genomics pipeline.
 * Usage: quantum-encode encode <fasta-file> [--backend] [--output] [--format]
 */

import type { Command } from 'commander';
import { GenomeAnalyzer } from '../../genome-analyzer/genome-analyzer.js';
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

export function registerEncodeCommand(program: Command): void {
  program
    .command('encode')
    .description('Encode a FASTA file into a quantum circuit and decode results')
    .argument('<fasta-file>', 'Path to FASTA file')
    .action(async (fastaFile: string, _opts: unknown, cmd: Command) => {
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
          // In non-interactive mode, exit if not confirmed
          if (!skipConfirm) {
            process.stderr.write('Error: Paid backend requires --yes flag for non-interactive execution.\n');
            process.exit(1);
          }
        }

        // Execute analysis
        const executor = new LocalSimulatorExecutor();
        const analyzer = new GenomeAnalyzer(executor);
        const result = await analyzer.analyze(content, filename, {
          backend,
          shots: 1000,
        });

        // Format output
        const outputData = format === 'json' ? {
          sequence: result.sequence.nucleotides,
          sequenceLength: result.sequence.length,
          sequenceType: result.sequence.type,
          decoded: result.decoded.nucleotides,
          averageConfidence: result.decoded.averageConfidence,
          perBaseConfidence: result.decoded.perBaseConfidence,
          backend: result.backend,
          partitioned: result.partitioned,
          segmentCount: result.segmentCount,
          circuitMetadata: {
            qubitCount: result.encodedCircuits[0]?.qubitCount,
            gateCount: result.encodedCircuits[0]?.gateCount,
            depth: result.encodedCircuits[0]?.depth,
          },
          costEstimate: result.costEstimate,
        } : {
          'Sequence': result.sequence.nucleotides,
          'Length': `${result.sequence.length} bases`,
          'Type': result.sequence.type,
          'Decoded': result.decoded.nucleotides,
          'Average Confidence': `${(result.decoded.averageConfidence * 100).toFixed(1)}%`,
          'Backend': result.backend,
          'Partitioned': result.partitioned ? `Yes (${result.segmentCount} segments)` : 'No',
          'Qubits': result.encodedCircuits[0]?.qubitCount,
          'Gates': result.encodedCircuits[0]?.gateCount,
          'Circuit Depth': result.encodedCircuits[0]?.depth,
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
