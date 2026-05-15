import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface QuantumGenomicsStackProps extends cdk.StackProps {
  /**
   * List of allowed quantum backend identifiers for this deployment.
   */
  allowedBackends: string[];
}

export class QuantumGenomicsStack extends cdk.Stack {
  /** The API Gateway REST API endpoint URL. */
  public readonly apiEndpoint: string;
  /** The S3 bucket name for pipeline data. */
  public readonly bucketName: string;
  /** The Step Functions state machine ARN. */
  public readonly stateMachineArn: string;

  constructor(scope: Construct, id: string, props: QuantumGenomicsStackProps) {
    super(scope, id, props);

    const { allowedBackends } = props;

    // ─── Tags ──────────────────────────────────────────────────────────────────
    cdk.Tags.of(this).add('Project', 'quantum-genomics-pipeline');
    cdk.Tags.of(this).add('Environment', this.node.tryGetContext('environment') || 'development');
    cdk.Tags.of(this).add('CostAllocation', 'quantum-genomics');

    // ─── S3 Bucket ─────────────────────────────────────────────────────────────
    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
      encryption: s3.BucketEncryption.S3_MANAGED, // AES-256
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'ExpireIntermediateResults',
          prefix: 'intermediate/',
          expiration: cdk.Duration.days(30),
        },
      ],
    });

    // ─── IAM Roles ─────────────────────────────────────────────────────────────

    // Lambda execution role
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Quantum Genomics Lambda functions',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // S3 read/write permissions for Lambda
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'S3ReadWrite',
      effect: iam.Effect.ALLOW,
      actions: [
        's3:GetObject',
        's3:PutObject',
        's3:ListBucket',
        's3:DeleteObject',
      ],
      resources: [
        dataBucket.bucketArn,
        `${dataBucket.bucketArn}/*`,
      ],
    }));

    // Braket permissions for Lambda
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BraketSubmit',
      effect: iam.Effect.ALLOW,
      actions: [
        'braket:CreateQuantumTask',
        'braket:GetQuantumTask',
        'braket:SearchQuantumTasks',
        'braket:CancelQuantumTask',
        'braket:GetDevice',
        'braket:SearchDevices',
      ],
      resources: ['*'],
    }));

    // Step Functions start execution permission for Lambda
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      sid: 'StepFunctionsStart',
      effect: iam.Effect.ALLOW,
      actions: [
        'states:StartExecution',
        'states:DescribeExecution',
      ],
      resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:*`],
    }));

    // Step Functions execution role
    const stepFunctionsRole = new iam.Role(this, 'StepFunctionsRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      description: 'Execution role for Quantum Genomics Step Functions state machine',
    });

    // Step Functions: Lambda invoke permission
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'LambdaInvoke',
      effect: iam.Effect.ALLOW,
      actions: ['lambda:InvokeFunction'],
      resources: [`arn:aws:lambda:${this.region}:${this.account}:function:${id}-*`],
    }));

    // Step Functions: Braket access
    stepFunctionsRole.addToPolicy(new iam.PolicyStatement({
      sid: 'BraketAccess',
      effect: iam.Effect.ALLOW,
      actions: [
        'braket:CreateQuantumTask',
        'braket:GetQuantumTask',
        'braket:CancelQuantumTask',
      ],
      resources: ['*'],
    }));

    // ─── Lambda Functions ──────────────────────────────────────────────────────

    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_18_X,
      memorySize: 1024,
      timeout: cdk.Duration.minutes(5),
      role: lambdaExecutionRole,
      environment: {
        DATA_BUCKET: dataBucket.bucketName,
        ALLOWED_BACKENDS: allowedBackends.join(','),
        NODE_OPTIONS: '--enable-source-maps',
      },
    };

    const encodeLambda = new lambda.Function(this, 'EncodeLambda', {
      ...commonLambdaProps,
      functionName: `${id}-encode`,
      handler: 'handlers/encode.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Encodes genomic sequences into quantum circuits',
    } as lambda.FunctionProps);

    const compareLambda = new lambda.Function(this, 'CompareLambda', {
      ...commonLambdaProps,
      functionName: `${id}-compare`,
      handler: 'handlers/compare.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Compares two sequences using quantum SWAP test',
    } as lambda.FunctionProps);

    const searchLambda = new lambda.Function(this, 'SearchLambda', {
      ...commonLambdaProps,
      functionName: `${id}-search`,
      handler: 'handlers/search.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Searches for DNA motifs using Grover algorithm',
    } as lambda.FunctionProps);

    const benchmarkLambda = new lambda.Function(this, 'BenchmarkLambda', {
      ...commonLambdaProps,
      functionName: `${id}-benchmark`,
      handler: 'handlers/benchmark.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Runs noise benchmarking across configurations',
    } as lambda.FunctionProps);

    // Internal Lambda functions for Step Functions pipeline steps
    const validateLambda = new lambda.Function(this, 'ValidateLambda', {
      ...commonLambdaProps,
      functionName: `${id}-validate`,
      handler: 'handlers/pipeline/validate.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Validates input FASTA sequences',
    } as lambda.FunctionProps);

    const transpileLambda = new lambda.Function(this, 'TranspileLambda', {
      ...commonLambdaProps,
      functionName: `${id}-transpile`,
      handler: 'handlers/pipeline/transpile.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Transpiles quantum circuits for target backend',
    } as lambda.FunctionProps);

    const executeLambda = new lambda.Function(this, 'ExecuteLambda', {
      ...commonLambdaProps,
      functionName: `${id}-execute`,
      handler: 'handlers/pipeline/execute.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      timeout: cdk.Duration.minutes(5),
      description: 'Executes quantum circuits on Braket',
    } as lambda.FunctionProps);

    const decodeLambda = new lambda.Function(this, 'DecodeLambda', {
      ...commonLambdaProps,
      functionName: `${id}-decode`,
      handler: 'handlers/pipeline/decode.handler',
      code: lambda.Code.fromAsset('../dist/lambda'),
      description: 'Decodes quantum measurement results',
    } as lambda.FunctionProps);

    // ─── Step Functions State Machine ──────────────────────────────────────────

    const validateTask = new tasks.LambdaInvoke(this, 'ValidateStep', {
      lambdaFunction: validateLambda,
      outputPath: '$.Payload',
      resultPath: '$.validateResult',
    });

    const encodeTask = new tasks.LambdaInvoke(this, 'EncodeStep', {
      lambdaFunction: encodeLambda,
      outputPath: '$.Payload',
      resultPath: '$.encodeResult',
    });

    const transpileTask = new tasks.LambdaInvoke(this, 'TranspileStep', {
      lambdaFunction: transpileLambda,
      outputPath: '$.Payload',
      resultPath: '$.transpileResult',
    });

    const executeTask = new tasks.LambdaInvoke(this, 'ExecuteStep', {
      lambdaFunction: executeLambda,
      outputPath: '$.Payload',
      resultPath: '$.executeResult',
    });

    const decodeTask = new tasks.LambdaInvoke(this, 'DecodeStep', {
      lambdaFunction: decodeLambda,
      outputPath: '$.Payload',
      resultPath: '$.decodeResult',
    });

    // Pipeline: validate → encode → transpile → execute → decode
    const pipelineDefinition = validateTask
      .next(encodeTask)
      .next(transpileTask)
      .next(executeTask)
      .next(decodeTask);

    const stateMachine = new stepfunctions.StateMachine(this, 'PipelineStateMachine', {
      stateMachineName: `${id}-pipeline`,
      definitionBody: stepfunctions.DefinitionBody.fromChainable(pipelineDefinition),
      role: stepFunctionsRole,
      timeout: cdk.Duration.minutes(30),
      tracingEnabled: true,
    });

    // ─── API Gateway ───────────────────────────────────────────────────────────

    const api = new apigateway.RestApi(this, 'QuantumGenomicsApi', {
      restApiName: 'Quantum Genomics Pipeline API',
      description: 'REST API for the Quantum Genomics Encoding Pipeline',
      deployOptions: {
        stageName: 'prod',
        tracingEnabled: true,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['POST', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // POST /encode
    const encodeResource = api.root.addResource('encode');
    encodeResource.addMethod('POST', new apigateway.LambdaIntegration(encodeLambda, {
      proxy: true,
    }));

    // POST /compare
    const compareResource = api.root.addResource('compare');
    compareResource.addMethod('POST', new apigateway.LambdaIntegration(compareLambda, {
      proxy: true,
    }));

    // POST /search
    const searchResource = api.root.addResource('search');
    searchResource.addMethod('POST', new apigateway.LambdaIntegration(searchLambda, {
      proxy: true,
    }));

    // POST /benchmark
    const benchmarkResource = api.root.addResource('benchmark');
    benchmarkResource.addMethod('POST', new apigateway.LambdaIntegration(benchmarkLambda, {
      proxy: true,
    }));

    // ─── Stack Outputs ─────────────────────────────────────────────────────────

    this.apiEndpoint = api.url;
    this.bucketName = dataBucket.bucketName;
    this.stateMachineArn = stateMachine.stateMachineArn;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
      description: 'API Gateway endpoint URL',
      exportName: `${id}-ApiEndpoint`,
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'S3 bucket name for pipeline data',
      exportName: `${id}-DataBucketName`,
    });

    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: stateMachine.stateMachineArn,
      description: 'Step Functions state machine ARN',
      exportName: `${id}-StateMachineArn`,
    });
  }
}
