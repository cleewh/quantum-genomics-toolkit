#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { QuantumGenomicsStack } from '../lib/quantum-genomics-stack';

const app = new cdk.App();

const region = app.node.tryGetContext('region') || process.env.CDK_DEFAULT_REGION || 'us-east-1';
const stackName = app.node.tryGetContext('stackName') || 'QuantumGenomicsStack';
const allowedBackends = app.node.tryGetContext('allowedBackends') || 'braket-local-simulator,braket-sv1,braket-dm1,ionq-forte-enterprise,rigetti-cepheus-1';

new QuantumGenomicsStack(app, stackName, {
  env: {
    region,
    account: process.env.CDK_DEFAULT_ACCOUNT,
  },
  allowedBackends: allowedBackends.split(',').map((b: string) => b.trim()),
});

app.synth();
