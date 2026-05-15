/**
 * CLI deploy command.
 *
 * Invokes CDK stack deployment for the quantum genomics pipeline.
 * Usage: quantum-encode deploy [--region] [--stack-name] [--backends]
 */

import type { Command } from 'commander';
import { writeOutput } from '../utils.js';

export function registerDeployCommand(program: Command): void {
  program
    .command('deploy')
    .description('Deploy the quantum genomics pipeline as a managed service using AWS CDK')
    .option('--region <region>', 'AWS region for deployment', 'us-east-1')
    .option('--stack-name <name>', 'CloudFormation stack name', 'quantum-genomics-stack')
    .option('--backends <backends>', 'Comma-separated allowed backends', 'local,sv1')
    .action(async (opts: { region: string; stackName: string; backends: string }, cmd: Command) => {
      const globalOpts = cmd.parent?.opts() ?? {};
      const outputPath: string | undefined = globalOpts.output;

      try {
        process.stderr.write(`Deploying quantum genomics stack...\n`);
        process.stderr.write(`  Region: ${opts.region}\n`);
        process.stderr.write(`  Stack name: ${opts.stackName}\n`);
        process.stderr.write(`  Backends: ${opts.backends}\n`);
        process.stderr.write(`\n`);

        // CDK deployment would be invoked here
        // For now, output the deployment configuration
        const deployConfig = {
          region: opts.region,
          stackName: opts.stackName,
          backends: opts.backends.split(',').map(s => s.trim()),
          status: 'CDK stack not yet implemented — use `cdk deploy` from the infra/ directory',
          instructions: [
            '1. cd infra/',
            '2. npm install',
            `3. cdk deploy --context region=${opts.region} --context stackName=${opts.stackName}`,
          ],
        };

        const output = JSON.stringify(deployConfig, null, 2);
        writeOutput(output, outputPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
