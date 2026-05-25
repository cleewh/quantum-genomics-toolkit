/**
 * Shared AWS helpers for Braket scripts.
 *
 * Resolves the caller's AWS account ID at runtime (no hardcoded IDs) and
 * ensures the Braket-results S3 bucket exists in the target region.
 *
 * Used by all scripts/*.ts so the repo is portable across AWS accounts.
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import {
  S3Client,
  CreateBucketCommand,
  HeadBucketCommand,
  PutBucketEncryptionCommand,
} from '@aws-sdk/client-s3';

let cachedAccountId: string | undefined;

/**
 * Resolve the current AWS account ID from STS GetCallerIdentity.
 *
 * Caches the result for the lifetime of the process.
 *
 * @param region AWS region for the STS client (any region works for STS)
 */
export async function getAccountId(region: string): Promise<string> {
  if (cachedAccountId) return cachedAccountId;

  const sts = new STSClient({ region });
  const response = await sts.send(new GetCallerIdentityCommand({}));
  if (!response.Account) {
    throw new Error(
      'Could not resolve AWS account ID. Run "aws sts get-caller-identity" to verify your credentials are configured.'
    );
  }
  cachedAccountId = response.Account;
  return cachedAccountId;
}

/**
 * Resolve the AWS region from standard AWS SDK precedence:
 *   1. Explicit override (function argument)
 *   2. AWS_REGION env var
 *   3. AWS_DEFAULT_REGION env var
 *   4. Falls back to "us-east-1"
 */
export function resolveRegion(override?: string): string {
  return (
    override ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  );
}

/**
 * Build the Braket-results bucket name following the standard convention:
 *   amazon-braket-results-<region>-<accountId>
 */
export function braketBucketName(region: string, accountId: string): string {
  return `amazon-braket-results-${region}-${accountId}`;
}

/**
 * Ensure the Braket-results bucket exists in the given region.
 *
 * Idempotent: HEADs the bucket first; only creates it if missing.
 * Applies AES-256 default encryption when creating.
 *
 * @returns the bucket name
 */
export async function ensureBraketBucket(region: string): Promise<string> {
  const accountId = await getAccountId(region);
  const bucket = braketBucketName(region, accountId);
  const s3 = new S3Client({ region });

  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return bucket;
  } catch (e: any) {
    // 404/NotFound means we need to create it.
    // 403 means it exists but we cannot access it (likely owned by another account).
    if (e.$metadata?.httpStatusCode === 403) {
      throw new Error(
        `Bucket ${bucket} exists but is not accessible. ` +
          `This usually means another account owns it. Check your AWS credentials.`
      );
    }
  }

  try {
    await s3.send(
      new CreateBucketCommand({
        Bucket: bucket,
        ...(region !== 'us-east-1'
          ? { CreateBucketConfiguration: { LocationConstraint: region } }
          : {}),
      })
    );
    console.log(`  Created S3 bucket: ${bucket}`);
  } catch (e: any) {
    // BucketAlreadyOwnedByYou: race condition or stale HEAD response. Safe to ignore.
    if (
      !e.message?.includes('already own') &&
      e.name !== 'BucketAlreadyOwnedByYou'
    ) {
      throw e;
    }
  }

  // Apply default encryption (best practice; ignore failures on legacy buckets)
  try {
    await s3.send(
      new PutBucketEncryptionCommand({
        Bucket: bucket,
        ServerSideEncryptionConfiguration: {
          Rules: [
            {
              ApplyServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      })
    );
  } catch {
    // Non-fatal — bucket usable without explicit encryption config
  }

  return bucket;
}

/**
 * Build the Braket task ARN for a given account and task ID.
 * Useful for decoder scripts that report the ARN.
 */
export function braketTaskArn(
  region: string,
  accountId: string,
  taskId: string
): string {
  return `arn:aws:braket:${region}:${accountId}:quantum-task/${taskId}`;
}
