/**
 * Webhook Signature Verification
 *
 * Implements multiple signature verification methods for webhook authentication:
 * - HMAC-SHA256 / HMAC-SHA512
 * - JWT (HS256, RS256)
 * - API Key
 * - Basic Auth
 *
 * SECURITY NOTES:
 * - Secrets are never persisted
 * - Timing-safe comparison is used for HMAC verification
 * - Replay protection via timestamp validation
 */

import * as crypto from 'crypto';
import type {
  SignatureConfig,
  SignatureVerificationResult,
} from '../contracts/index.js';

/**
 * Signature Verifier - Validates webhook signatures
 */
export class SignatureVerifier {
  private readonly config: SignatureConfig;

  constructor(config: SignatureConfig) {
    this.config = config;
  }

  /**
   * Verify the signature of an incoming webhook request
   */
  async verify(
    headers: Record<string, string>,
    body: string,
    timestamp?: string
  ): Promise<SignatureVerificationResult> {
    try {
      // Handle 'none' method - no verification required
      if (this.config.method === 'none') {
        return {
          valid: true,
          method: 'none',
          timestamp_valid: true,
        };
      }

      // Validate timestamp for replay protection
      const timestampValid = this.validateTimestamp(headers, timestamp);
      if (!timestampValid.valid && this.config.timestamp_tolerance_seconds > 0) {
        return {
          valid: false,
          method: this.config.method,
          timestamp_valid: false,
          error: timestampValid.error,
        };
      }

      // Route to appropriate verification method
      switch (this.config.method) {
        case 'hmac_sha256':
          return await this.verifyHmac(headers, body, 'sha256');

        case 'hmac_sha512':
          return await this.verifyHmac(headers, body, 'sha512');

        case 'jwt_hs256':
          return await this.verifyJwt(headers, 'HS256');

        case 'jwt_rs256':
          return await this.verifyJwt(headers, 'RS256');

        case 'api_key':
          return this.verifyApiKey(headers);

        case 'basic_auth':
          return this.verifyBasicAuth(headers);

        default:
          return {
            valid: false,
            method: this.config.method,
            error: `Unsupported signature method: ${this.config.method}`,
          };
      }
    } catch (error) {
      return {
        valid: false,
        method: this.config.method,
        error: error instanceof Error ? error.message : 'Unknown verification error',
      };
    }
  }

  /**
   * Verify HMAC signature (SHA256 or SHA512)
   */
  private async verifyHmac(
    headers: Record<string, string>,
    body: string,
    algorithm: 'sha256' | 'sha512'
  ): Promise<SignatureVerificationResult> {
    const signature = this.getHeaderValue(headers, this.config.header_name);

    if (!signature) {
      return {
        valid: false,
        method: algorithm === 'sha256' ? 'hmac_sha256' : 'hmac_sha512',
        error: `Missing signature header: ${this.config.header_name}`,
      };
    }

    if (!this.config.secret_key) {
      return {
        valid: false,
        method: algorithm === 'sha256' ? 'hmac_sha256' : 'hmac_sha512',
        error: 'Secret key not configured',
      };
    }

    // Compute expected signature
    const hmac = crypto.createHmac(algorithm, this.config.secret_key);
    hmac.update(body);
    const expectedSignature = hmac.digest('hex');

    // Handle various signature formats (with/without prefix)
    const normalizedSignature = this.normalizeSignature(signature, algorithm);

    // Timing-safe comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(normalizedSignature),
      Buffer.from(expectedSignature)
    );

    return {
      valid: isValid,
      method: algorithm === 'sha256' ? 'hmac_sha256' : 'hmac_sha512',
      timestamp_valid: true,
      error: isValid ? undefined : 'Invalid signature',
    };
  }

  /**
   * Verify JWT token
   */
  private async verifyJwt(
    headers: Record<string, string>,
    algorithm: 'HS256' | 'RS256'
  ): Promise<SignatureVerificationResult> {
    const authHeader = this.getHeaderValue(headers, 'Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        valid: false,
        method: algorithm === 'HS256' ? 'jwt_hs256' : 'jwt_rs256',
        error: 'Missing or invalid Authorization header',
      };
    }

    const token = authHeader.substring(7);

    try {
      // Parse JWT parts
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];
      const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

      // Verify algorithm matches
      if (header.alg !== algorithm) {
        throw new Error(`Algorithm mismatch: expected ${algorithm}, got ${header.alg}`);
      }

      // Verify signature
      const data = `${headerB64}.${payloadB64}`;
      let isValid: boolean;

      if (algorithm === 'HS256') {
        if (!this.config.secret_key) {
          throw new Error('Secret key not configured for HS256');
        }
        const hmac = crypto.createHmac('sha256', this.config.secret_key);
        hmac.update(data);
        const expectedSignature = hmac.digest('base64url');
        isValid = crypto.timingSafeEqual(
          Buffer.from(signatureB64),
          Buffer.from(expectedSignature)
        );
      } else {
        if (!this.config.public_key) {
          throw new Error('Public key not configured for RS256');
        }
        const verify = crypto.createVerify('RSA-SHA256');
        verify.update(data);
        isValid = verify.verify(this.config.public_key, signatureB64, 'base64url');
      }

      // Verify expiration
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());
      if (payload.exp && payload.exp < Date.now() / 1000) {
        return {
          valid: false,
          method: algorithm === 'HS256' ? 'jwt_hs256' : 'jwt_rs256',
          error: 'JWT has expired',
        };
      }

      return {
        valid: isValid,
        method: algorithm === 'HS256' ? 'jwt_hs256' : 'jwt_rs256',
        timestamp_valid: true,
        error: isValid ? undefined : 'Invalid JWT signature',
      };
    } catch (error) {
      return {
        valid: false,
        method: algorithm === 'HS256' ? 'jwt_hs256' : 'jwt_rs256',
        error: error instanceof Error ? error.message : 'JWT verification failed',
      };
    }
  }

  /**
   * Verify API key
   */
  private verifyApiKey(headers: Record<string, string>): SignatureVerificationResult {
    const apiKey = this.getHeaderValue(headers, this.config.api_key_header);

    if (!apiKey) {
      return {
        valid: false,
        method: 'api_key',
        error: `Missing API key header: ${this.config.api_key_header}`,
      };
    }

    if (!this.config.secret_key) {
      return {
        valid: false,
        method: 'api_key',
        error: 'API key not configured for verification',
      };
    }

    // Timing-safe comparison
    const isValid = crypto.timingSafeEqual(
      Buffer.from(apiKey),
      Buffer.from(this.config.secret_key)
    );

    return {
      valid: isValid,
      method: 'api_key',
      timestamp_valid: true,
      error: isValid ? undefined : 'Invalid API key',
    };
  }

  /**
   * Verify Basic Auth credentials
   */
  private verifyBasicAuth(headers: Record<string, string>): SignatureVerificationResult {
    const authHeader = this.getHeaderValue(headers, 'Authorization');

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return {
        valid: false,
        method: 'basic_auth',
        error: 'Missing or invalid Basic Auth header',
      };
    }

    if (!this.config.secret_key) {
      return {
        valid: false,
        method: 'basic_auth',
        error: 'Credentials not configured for verification',
      };
    }

    try {
      const credentials = Buffer.from(authHeader.substring(6), 'base64').toString();

      // Timing-safe comparison
      const isValid = crypto.timingSafeEqual(
        Buffer.from(credentials),
        Buffer.from(this.config.secret_key)
      );

      return {
        valid: isValid,
        method: 'basic_auth',
        timestamp_valid: true,
        error: isValid ? undefined : 'Invalid credentials',
      };
    } catch {
      return {
        valid: false,
        method: 'basic_auth',
        error: 'Invalid Basic Auth encoding',
      };
    }
  }

  /**
   * Validate timestamp for replay protection
   */
  private validateTimestamp(
    headers: Record<string, string>,
    providedTimestamp?: string
  ): { valid: boolean; error?: string } {
    if (this.config.timestamp_tolerance_seconds === 0) {
      return { valid: true };
    }

    const timestampStr =
      providedTimestamp || this.getHeaderValue(headers, this.config.timestamp_header);

    if (!timestampStr) {
      return {
        valid: false,
        error: `Missing timestamp header: ${this.config.timestamp_header}`,
      };
    }

    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) {
      return {
        valid: false,
        error: 'Invalid timestamp format',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    const diff = Math.abs(now - timestamp);

    if (diff > this.config.timestamp_tolerance_seconds) {
      return {
        valid: false,
        error: `Timestamp out of tolerance: ${diff}s (max: ${this.config.timestamp_tolerance_seconds}s)`,
      };
    }

    return { valid: true };
  }

  /**
   * Get header value (case-insensitive)
   */
  private getHeaderValue(headers: Record<string, string>, name: string): string | undefined {
    const lowerName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }
    return undefined;
  }

  /**
   * Normalize signature by removing common prefixes
   */
  private normalizeSignature(signature: string, algorithm: 'sha256' | 'sha512'): string {
    // Remove common prefixes like "sha256=", "sha512=", "v1=", etc.
    const prefixes = [`${algorithm}=`, 'sha256=', 'sha512=', 'v1=', 'v0='];
    let normalized = signature;

    for (const prefix of prefixes) {
      if (normalized.toLowerCase().startsWith(prefix)) {
        normalized = normalized.substring(prefix.length);
        break;
      }
    }

    return normalized.toLowerCase();
  }
}

/**
 * Create a signature for testing/debugging purposes
 */
export function createTestSignature(
  body: string,
  secret: string,
  algorithm: 'sha256' | 'sha512' = 'sha256'
): string {
  const hmac = crypto.createHmac(algorithm, secret);
  hmac.update(body);
  return `${algorithm}=${hmac.digest('hex')}`;
}

/**
 * Create a test JWT token
 */
export function createTestJwt(
  payload: Record<string, unknown>,
  secret: string,
  expiresIn: number = 3600
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresIn,
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const data = `${headerB64}.${payloadB64}`;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(data);
  const signature = hmac.digest('base64url');

  return `${headerB64}.${payloadB64}.${signature}`;
}
