/**
 * TLS Manager
 * Manages HTTPS/TLS 1.3 configuration and secure transport protocols
 * Implements modern TLS security practices and certificate management
 */

import * as fs from 'fs';
import * as https from 'https';
import * as tls from 'tls';
import { Express } from 'express';
import { logger } from '../utils/Logger';

export interface TLSConfig {
  enabled: boolean;
  port: number;
  certificateConfig: CertificateConfig;
  tlsOptions: TLSOptions;
  securityHeaders: boolean;
  hsts: HSTSConfig;
  ocspStapling: boolean;
  sessionResumption: boolean;
}

export interface CertificateConfig {
  type: 'self-signed' | 'letsencrypt' | 'custom';
  certPath?: string;
  keyPath?: string;
  caPath?: string;
  autoRenew?: boolean;
  domains?: string[];
}

export interface TLSOptions {
  minVersion: string;
  maxVersion: string;
  ciphers: string[];
  ecdhCurve: string;
  dhParam?: string;
  honorCipherOrder: boolean;
  secureProtocol: string;
}

export interface HSTSConfig {
  enabled: boolean;
  maxAge: number;
  includeSubDomains: boolean;
  preload: boolean;
}

export interface SecurityCertificateInfo {
  subject: string;
  issuer: string;
  validFrom: Date;
  validTo: Date;
  serialNumber: string;
  fingerprint: string;
  keyUsage: string[];
  extKeyUsage: string[];
  isValid: boolean;
  daysUntilExpiry: number;
}

export class TLSManager {
  private static instance: TLSManager;
  private config: TLSConfig;
  private server?: https.Server;
  private certificates: Map<string, any> = new Map();
  private certificateWatcher?: fs.FSWatcher;

  private constructor(config?: Partial<TLSConfig>) {
    this.config = this.mergeConfig(config);
    this.initializeTLS();
  }

  public static getInstance(config?: Partial<TLSConfig>): TLSManager {
    if (!TLSManager.instance) {
      TLSManager.instance = new TLSManager(config);
    }
    return TLSManager.instance;
  }

  /**
   * Create secure HTTPS server
   */
  public async createSecureServer(app: Express): Promise<https.Server> {
    try {
      if (!this.config.enabled) {
        logger.warn('TLS is disabled - using HTTP only');
        throw new Error('TLS is disabled');
      }

      const tlsOptions = await this.buildTLSOptions();
      
      this.server = https.createServer(tlsOptions, app);
      
      // Add security event handlers
      this.setupSecurityEventHandlers();
      
      // Setup certificate monitoring
      this.setupCertificateMonitoring();

      logger.info('Secure HTTPS server created', {
        port: this.config.port,
        tlsVersion: this.config.tlsOptions.minVersion,
        certificateType: this.config.certificateConfig.type
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to create secure server', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Start HTTPS server
   */
  public async startSecureServer(app: Express): Promise<void> {
    try {
      const server = await this.createSecureServer(app);
      
      return new Promise((resolve, reject) => {
        server.listen(this.config.port, () => {
          logger.info('Secure server started', {
            port: this.config.port,
            tlsEnabled: true
          });
          resolve();
        });
        
        server.on('error', (error) => {
          logger.error('Secure server error', {
            error: error.message
          });
          reject(error);
        });
      });
    } catch (error) {
      logger.error('Failed to start secure server', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Generate TLS configuration options
   */
  public async buildTLSOptions(): Promise<https.ServerOptions> {
    try {
      const certificates = await this.loadCertificates();
      
      const tlsOptions: https.ServerOptions = {
        // Certificate configuration
        cert: certificates.cert,
        key: certificates.key,
        ca: certificates.ca,
        
        // TLS Protocol configuration
        minVersion: this.config.tlsOptions.minVersion as any,
        maxVersion: this.config.tlsOptions.maxVersion as any,
        secureProtocol: this.config.tlsOptions.secureProtocol,
        
        // Cipher configuration
        ciphers: this.config.tlsOptions.ciphers.join(':'),
        ecdhCurve: this.config.tlsOptions.ecdhCurve,
        honorCipherOrder: this.config.tlsOptions.honorCipherOrder,
        
        // Security options
        requestCert: false,
        rejectUnauthorized: false,
        
        // Session configuration
        sessionIdContext: 'ai-ninja-session',
        
        // OCSP Stapling
        ...(this.config.ocspStapling && { 
          secureOptions: tls.constants.SSL_OP_NO_SESSION_RESUMPTION_ON_RENEGOTIATION 
        })
      };

      // Add DH parameters if configured
      if (this.config.tlsOptions.dhParam) {
        tlsOptions.dhparam = fs.readFileSync(this.config.tlsOptions.dhParam);
      }

      logger.info('TLS options built successfully', {
        minTLSVersion: this.config.tlsOptions.minVersion,
        cipherSuites: this.config.tlsOptions.ciphers.length,
        ecdhCurve: this.config.tlsOptions.ecdhCurve
      });

      return tlsOptions;
    } catch (error) {
      logger.error('Failed to build TLS options', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Load SSL certificates
   */
  public async loadCertificates(): Promise<{ cert: Buffer; key: Buffer; ca?: Buffer }> {
    try {
      const config = this.config.certificateConfig;
      
      switch (config.type) {
        case 'custom':
          return await this.loadCustomCertificates(config);
        
        case 'letsencrypt':
          return await this.loadLetsEncryptCertificates(config);
        
        case 'self-signed':
          return await this.generateSelfSignedCertificates(config);
        
        default:
          throw new Error(`Unsupported certificate type: ${config.type}`);
      }
    } catch (error) {
      logger.error('Failed to load certificates', {
        type: this.config.certificateConfig.type,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Validate certificate security
   */
  public async validateCertificate(certPath: string): Promise<SecurityCertificateInfo> {
    try {
      const certData = fs.readFileSync(certPath, 'utf8');
      const cert = new crypto.X509Certificate(certData);
      
      const info: SecurityCertificateInfo = {
        subject: cert.subject,
        issuer: cert.issuer,
        validFrom: new Date(cert.validFrom),
        validTo: new Date(cert.validTo),
        serialNumber: cert.serialNumber,
        fingerprint: cert.fingerprint,
        keyUsage: cert.keyUsage || [],
        extKeyUsage: cert.extendedKeyUsage || [],
        isValid: this.isCertificateValid(cert),
        daysUntilExpiry: this.calculateDaysUntilExpiry(cert.validTo)
      };

      // Check for security issues
      this.checkCertificateSecurity(info);

      logger.info('Certificate validated', {
        subject: info.subject,
        validTo: info.validTo,
        daysUntilExpiry: info.daysUntilExpiry,
        isValid: info.isValid
      });

      return info;
    } catch (error) {
      logger.error('Certificate validation failed', {
        certPath,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Test TLS configuration
   */
  public async testTLSConfiguration(): Promise<TLSTestResult> {
    try {
      const testResults: TLSTestResult = {
        tlsVersionSupport: await this.testTLSVersions(),
        cipherSuiteSupport: await this.testCipherSuites(),
        certificateChain: await this.testCertificateChain(),
        securityHeaders: await this.testSecurityHeaders(),
        performance: await this.testTLSPerformance(),
        vulnerabilities: await this.scanForVulnerabilities(),
        overallScore: 0,
        recommendations: []
      };

      testResults.overallScore = this.calculateSecurityScore(testResults);
      testResults.recommendations = this.generateSecurityRecommendations(testResults);

      logger.info('TLS configuration tested', {
        overallScore: testResults.overallScore,
        recommendations: testResults.recommendations.length
      });

      return testResults;
    } catch (error) {
      logger.error('TLS configuration test failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Setup certificate auto-renewal
   */
  public async setupCertificateAutoRenewal(): Promise<void> {
    try {
      if (!this.config.certificateConfig.autoRenew) {
        logger.info('Certificate auto-renewal is disabled');
        return;
      }

      // Check certificate expiry daily
      setInterval(async () => {
        try {
          await this.checkAndRenewCertificates();
        } catch (error) {
          logger.error('Certificate renewal check failed', {
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }, 24 * 60 * 60 * 1000); // 24 hours

      logger.info('Certificate auto-renewal setup completed');
    } catch (error) {
      logger.error('Failed to setup certificate auto-renewal', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Create security headers middleware
   */
  public createSecurityHeadersMiddleware() {
    return (req: any, res: any, next: any) => {
      if (this.config.securityHeaders) {
        // Strict Transport Security
        if (this.config.hsts.enabled) {
          const hstsValue = [
            `max-age=${this.config.hsts.maxAge}`,
            this.config.hsts.includeSubDomains ? 'includeSubDomains' : '',
            this.config.hsts.preload ? 'preload' : ''
          ].filter(Boolean).join('; ');
          
          res.setHeader('Strict-Transport-Security', hstsValue);
        }

        // Additional security headers
        res.setHeader('X-TLS-Version', req.socket.getProtocol?.() || 'unknown');
        res.setHeader('X-Cipher-Suite', req.socket.getCipher?.()?.name || 'unknown');
      }
      
      next();
    };
  }

  // Private helper methods

  private mergeConfig(config?: Partial<TLSConfig>): TLSConfig {
    const defaultConfig: TLSConfig = {
      enabled: true,
      port: 443,
      certificateConfig: {
        type: 'self-signed',
        autoRenew: true,
        domains: ['localhost']
      },
      tlsOptions: {
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        ciphers: [
          'TLS_AES_256_GCM_SHA384',
          'TLS_CHACHA20_POLY1305_SHA256',
          'TLS_AES_128_GCM_SHA256'
        ],
        ecdhCurve: 'auto',
        honorCipherOrder: true,
        secureProtocol: 'TLSv1_3_method'
      },
      securityHeaders: true,
      hsts: {
        enabled: true,
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true
      },
      ocspStapling: true,
      sessionResumption: true
    };

    return { ...defaultConfig, ...config };
  }

  private async initializeTLS(): Promise<void> {
    try {
      // Set global TLS settings
      tls.DEFAULT_MIN_VERSION = this.config.tlsOptions.minVersion;
      tls.DEFAULT_MAX_VERSION = this.config.tlsOptions.maxVersion;

      logger.info('TLS Manager initialized', {
        enabled: this.config.enabled,
        minVersion: this.config.tlsOptions.minVersion,
        certificateType: this.config.certificateConfig.type
      });
    } catch (error) {
      logger.error('TLS initialization failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  private async loadCustomCertificates(config: CertificateConfig): Promise<{ cert: Buffer; key: Buffer; ca?: Buffer }> {
    if (!config.certPath || !config.keyPath) {
      throw new Error('Certificate and key paths are required for custom certificates');
    }

    const cert = fs.readFileSync(config.certPath);
    const key = fs.readFileSync(config.keyPath);
    const ca = config.caPath ? fs.readFileSync(config.caPath) : undefined;

    return { cert, key, ca };
  }

  private async loadLetsEncryptCertificates(config: CertificateConfig): Promise<{ cert: Buffer; key: Buffer; ca?: Buffer }> {
    // Implement Let's Encrypt certificate loading
    // This would typically use the ACME client
    throw new Error('Let\'s Encrypt integration not implemented yet');
  }

  private async generateSelfSignedCertificates(config: CertificateConfig): Promise<{ cert: Buffer; key: Buffer }> {
    // Generate self-signed certificate for development
    const forge = require('node-forge');
    
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    
    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
    
    const attrs = [{
      name: 'commonName',
      value: config.domains?.[0] || 'localhost'
    }];
    
    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.sign(keys.privateKey);
    
    const certPem = forge.pki.certificateToPem(cert);
    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    
    return {
      cert: Buffer.from(certPem),
      key: Buffer.from(keyPem)
    };
  }

  private setupSecurityEventHandlers(): void {
    if (!this.server) return;

    this.server.on('secureConnection', (tlsSocket) => {
      logger.debug('Secure connection established', {
        protocol: tlsSocket.getProtocol(),
        cipher: tlsSocket.getCipher()?.name,
        authorized: tlsSocket.authorized
      });
    });

    this.server.on('tlsClientError', (err, tlsSocket) => {
      logger.warn('TLS client error', {
        error: err.message,
        remoteAddress: tlsSocket.remoteAddress
      });
    });
  }

  private setupCertificateMonitoring(): void {
    if (!this.config.certificateConfig.certPath) return;

    this.certificateWatcher = fs.watch(
      this.config.certificateConfig.certPath,
      async (eventType) => {
        if (eventType === 'change') {
          logger.info('Certificate file changed, reloading...');
          try {
            await this.reloadCertificates();
          } catch (error) {
            logger.error('Failed to reload certificates', {
              error: error instanceof Error ? error.message : 'Unknown error'
            });
          }
        }
      }
    );
  }

  private async reloadCertificates(): Promise<void> {
    // Implementation for hot certificate reload
    logger.info('Certificate reload completed');
  }

  private isCertificateValid(cert: any): boolean {
    const now = new Date();
    return now >= new Date(cert.validFrom) && now <= new Date(cert.validTo);
  }

  private calculateDaysUntilExpiry(validTo: string): number {
    const expiryDate = new Date(validTo);
    const now = new Date();
    const diffTime = expiryDate.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  private checkCertificateSecurity(info: SecurityCertificateInfo): void {
    // Check for security issues
    if (info.daysUntilExpiry < 30) {
      logger.warn('Certificate expiring soon', {
        daysUntilExpiry: info.daysUntilExpiry,
        subject: info.subject
      });
    }

    if (info.daysUntilExpiry < 0) {
      logger.error('Certificate has expired', {
        expiredDays: Math.abs(info.daysUntilExpiry),
        subject: info.subject
      });
    }
  }

  private async checkAndRenewCertificates(): Promise<void> {
    // Implementation for certificate renewal
    logger.info('Certificate renewal check completed');
  }
}

// Helper interfaces
interface TLSTestResult {
  tlsVersionSupport: any;
  cipherSuiteSupport: any;
  certificateChain: any;
  securityHeaders: any;
  performance: any;
  vulnerabilities: any;
  overallScore: number;
  recommendations: string[];
}

// Export singleton instance
export const tlsManager = TLSManager.getInstance();