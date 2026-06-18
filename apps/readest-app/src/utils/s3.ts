import { S3Client } from '@aws-sdk/client-s3';
import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const S3_ENDPOINT = process.env['S3_ENDPOINT'] || '';
// S3_PUBLIC_ENDPOINT is the MinIO URL reachable by browsers (e.g. http://<host-ip>:9000).
// When unset it falls back to S3_ENDPOINT so single-endpoint setups are unaffected.
const S3_PUBLIC_ENDPOINT = process.env['S3_PUBLIC_ENDPOINT'] || S3_ENDPOINT;
const S3_REGION = process.env['S3_REGION'] || 'auto';
const S3_ACCESS_KEY_ID = process.env['S3_ACCESS_KEY_ID'] || '';
const S3_SECRET_ACCESS_KEY = process.env['S3_SECRET_ACCESS_KEY'] || '';

const s3ClientCredentials = {
  accessKeyId: S3_ACCESS_KEY_ID,
  secretAccessKey: S3_SECRET_ACCESS_KEY,
};

// Internal client used for server-side SDK calls (PutObject, CopyObject, etc.)
export const s3Client = new S3Client({
  forcePathStyle: true,
  region: S3_REGION,
  endpoint: S3_ENDPOINT,
  credentials: s3ClientCredentials,
});

// Signing client uses S3_PUBLIC_ENDPOINT so presigned URLs contain a hostname
// that browsers can reach (S3_ENDPOINT may be an internal docker hostname like
// "minio:9000" which is not resolvable outside the docker network).
const s3SigningClient = new S3Client({
  forcePathStyle: true,
  region: S3_REGION,
  endpoint: S3_PUBLIC_ENDPOINT,
  credentials: s3ClientCredentials,
});

export const s3Storage = {
  getClient: () => {
    return new S3Client({
      forcePathStyle: true,
      region: S3_REGION,
      endpoint: S3_ENDPOINT,
      credentials: s3ClientCredentials,
    });
  },

  getDownloadSignedUrl: async (bucketName: string, fileKey: string, expiresIn: number) => {
    const getCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(s3SigningClient, getCommand, {
      expiresIn: expiresIn,
    });
    return downloadUrl;
  },

  getUploadSignedUrl: async (
    bucketName: string,
    fileKey: string,
    contentLength: number,
    expiresIn: number,
  ) => {
    const signableHeaders = new Set<string>();
    signableHeaders.add('content-length');
    const putCommand = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      ContentLength: contentLength,
    });

    const uploadUrl = await getSignedUrl(s3SigningClient, putCommand, {
      expiresIn: expiresIn,
      signableHeaders,
    });

    return uploadUrl;
  },

  deleteObject: async (bucketName: string, fileKey: string) => {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
    });

    return await s3Storage.getClient().send(deleteCommand);
  },
};
