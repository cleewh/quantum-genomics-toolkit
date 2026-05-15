/**
 * KMS Encryption helpers for S3 data at rest.
 * Ensures all S3 put operations use SSE-KMS encryption with customer-managed keys.
 *
 * Requirements: 10.1
 */

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface S3ClientInterface {
  putObject(params: S3PutParams): Promise<void>;
  getObject(params: S3GetParams): Promise<Buffer>;
}

export interface S3PutParams {
  Bucket: string;
  Key: string;
  Body: string | Buffer;
  ServerSideEncryption?: string;
  SSEKMSKeyId?: string;
}

export interface S3GetParams {
  Bucket: string;
  Key: string;
}

/**
 * EncryptedS3Client wraps an S3 client to always apply KMS encryption on writes.
 * All putObject calls automatically include SSE-KMS encryption headers.
 */
export class EncryptedS3Client {
  private s3Client: S3ClientInterface;
  private kmsKeyId: string;

  constructor(s3Client: S3ClientInterface, kmsKeyId: string) {
    this.s3Client = s3Client;
    this.kmsKeyId = kmsKeyId;
  }

  /**
   * Puts an object to S3 with KMS encryption applied.
   */
  async putObject(bucket: string, key: string, data: string | Buffer): Promise<void> {
    await this.s3Client.putObject({
      Bucket: bucket,
      Key: key,
      Body: data,
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: this.kmsKeyId,
    });
  }

  /**
   * Gets an object from S3 (decryption is handled automatically by AWS).
   */
  async getObject(bucket: string, key: string): Promise<Buffer> {
    return this.s3Client.getObject({ Bucket: bucket, Key: key });
  }

  /**
   * Returns the KMS key ID being used for encryption.
   */
  getKmsKeyId(): string {
    return this.kmsKeyId;
  }
}
