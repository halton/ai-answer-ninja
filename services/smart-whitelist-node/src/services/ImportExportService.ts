import { logger } from '@/utils/logger';
import { whitelistService } from './whitelist-service';
import { mlIntegrationService } from './MLIntegrationService';
import { riskEvaluationService } from './RiskEvaluationService';
import { config } from '@/config';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import * as csv from 'csv-parser';
import * as XLSX from 'xlsx';
import {
  SmartWhitelist,
  CreateWhitelistRequest,
  WhitelistType,
  WhitelistError,
  BatchOperationResult,
} from '@/types';

/**
 * Import/Export Service for Smart Whitelist
 * Handles bulk import/export operations with validation and error handling
 * Supports multiple formats: CSV, JSON, Excel, vCard
 */
export class ImportExportService {
  private readonly serviceVersion = '1.0.0';
  private readonly MAX_IMPORT_SIZE = 10000; // Max entries per import
  private readonly MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
  private readonly BATCH_SIZE = 100;
  private readonly SUPPORTED_FORMATS = ['csv', 'json', 'xlsx', 'vcf'];

  constructor() {
    this.initializeService();
  }

  /**
   * Import whitelist entries from file
   */
  async importWhitelist(
    userId: string,
    fileData: Buffer,
    format: ImportFormat,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    const start = Date.now();
    const importId = this.generateImportId();

    try {
      logger.info('Starting whitelist import', {
        importId,
        userId,
        format,
        fileSize: fileData.length,
        options,
      });

      // Validate file size
      if (fileData.length > this.MAX_FILE_SIZE) {
        throw new WhitelistError(
          `File size ${fileData.length} exceeds maximum ${this.MAX_FILE_SIZE}`,
          'FILE_TOO_LARGE'
        );
      }

      // Validate format
      if (!this.SUPPORTED_FORMATS.includes(format)) {
        throw new WhitelistError(
          `Unsupported format: ${format}`,
          'UNSUPPORTED_FORMAT'
        );
      }

      // Parse file data
      const rawEntries = await this.parseFileData(fileData, format);
      
      if (rawEntries.length === 0) {
        throw new WhitelistError('No valid entries found in file', 'NO_ENTRIES_FOUND');
      }

      if (rawEntries.length > this.MAX_IMPORT_SIZE) {
        throw new WhitelistError(
          `Import size ${rawEntries.length} exceeds maximum ${this.MAX_IMPORT_SIZE}`,
          'IMPORT_TOO_LARGE'
        );
      }

      // Validate and process entries
      const validationResult = await this.validateImportEntries(rawEntries, userId, options);
      
      // Import valid entries in batches
      const importResult = await this.processImportBatches(
        userId,
        validationResult.validEntries,
        options
      );

      // Generate import report
      const report = await this.generateImportReport(
        importId,
        validationResult,
        importResult,
        Date.now() - start
      );

      // Log completion
      logger.info('Whitelist import completed', {
        importId,
        userId,
        totalProcessed: rawEntries.length,
        successful: importResult.successful,
        failed: importResult.failed,
        duplicates: validationResult.duplicates.length,
        processingTime: Date.now() - start,
      });

      return {
        importId,
        userId,
        format,
        totalEntries: rawEntries.length,
        processed: importResult.successful + importResult.failed,
        successful: importResult.successful,
        failed: importResult.failed,
        duplicates: validationResult.duplicates.length,
        errors: [
          ...validationResult.errors,
          ...importResult.errors,
        ],
        report,
        processingTimeMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Whitelist import failed', {
        importId,
        userId,
        format,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        importId,
        userId,
        format,
        totalEntries: 0,
        processed: 0,
        successful: 0,
        failed: 0,
        duplicates: 0,
        errors: [{
          line: 0,
          field: 'general',
          message: error instanceof Error ? error.message : String(error),
          code: 'IMPORT_FAILED',
        }],
        report: null,
        processingTimeMs: Date.now() - start,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Export whitelist entries to file
   */
  async exportWhitelist(
    userId: string,
    format: ExportFormat,
    options: ExportOptions = {}
  ): Promise<ExportResult> {
    const start = Date.now();
    const exportId = this.generateExportId();

    try {
      logger.info('Starting whitelist export', {
        exportId,
        userId,
        format,
        options,
      });

      // Get whitelist entries
      const entries = await this.getWhitelistEntriesForExport(userId, options);
      
      if (entries.length === 0) {
        throw new WhitelistError('No entries found to export', 'NO_ENTRIES_TO_EXPORT');
      }

      // Apply filters if specified
      const filteredEntries = this.applyExportFilters(entries, options);

      // Transform entries for export
      const transformedEntries = await this.transformEntriesForExport(
        filteredEntries,
        format,
        options
      );

      // Generate export data
      const exportData = await this.generateExportData(transformedEntries, format, options);

      // Create export metadata
      const metadata = this.createExportMetadata(
        exportId,
        userId,
        format,
        filteredEntries.length,
        options
      );

      logger.info('Whitelist export completed', {
        exportId,
        userId,
        format,
        entriesExported: filteredEntries.length,
        dataSize: exportData.length,
        processingTime: Date.now() - start,
      });

      return {
        exportId,
        userId,
        format,
        entriesExported: filteredEntries.length,
        data: exportData,
        metadata,
        filename: this.generateExportFilename(userId, format, filteredEntries.length),
        mimeType: this.getExportMimeType(format),
        processingTimeMs: Date.now() - start,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Whitelist export failed', {
        exportId,
        userId,
        format,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new WhitelistError(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        'EXPORT_FAILED'
      );
    }
  }

  /**
   * Import from external contact sources
   */
  async importFromExternalSource(
    userId: string,
    source: ExternalSource,
    credentials: ExternalSourceCredentials,
    options: ImportOptions = {}
  ): Promise<ImportResult> {
    try {
      logger.info('Starting external source import', {
        userId,
        source: source.type,
        options,
      });

      // Connect to external source
      const connector = await this.createExternalSourceConnector(source, credentials);
      
      // Fetch contacts from external source
      const externalContacts = await connector.fetchContacts(options.filters);
      
      // Transform external contacts to whitelist format
      const whitelistEntries = await this.transformExternalContacts(
        externalContacts,
        userId,
        source
      );

      // Use regular import process
      const fakeFileData = Buffer.from(JSON.stringify(whitelistEntries));
      return await this.importWhitelist(userId, fakeFileData, 'json', {
        ...options,
        source: `external_${source.type}`,
      });
    } catch (error) {
      logger.error('External source import failed', {
        userId,
        source: source.type,
        error: error instanceof Error ? error.message : String(error),
      });

      throw new WhitelistError(
        `External import failed: ${error instanceof Error ? error.message : String(error)}`,
        'EXTERNAL_IMPORT_FAILED'
      );
    }
  }

  /**
   * Validate import file before processing
   */
  async validateImportFile(
    fileData: Buffer,
    format: ImportFormat
  ): Promise<ImportValidationResult> {
    try {
      // Parse file to get sample entries
      const entries = await this.parseFileData(fileData, format);
      
      // Validate format and structure
      const formatValidation = this.validateFileFormat(entries, format);
      
      // Check for common issues
      const issueAnalysis = this.analyzeImportIssues(entries);
      
      // Estimate import outcomes
      const estimation = this.estimateImportOutcome(entries, issueAnalysis);

      return {
        valid: formatValidation.valid,
        totalEntries: entries.length,
        sampleEntries: entries.slice(0, 5), // First 5 entries as sample
        formatValidation,
        issues: issueAnalysis,
        estimation,
        recommendations: this.generateImportRecommendations(formatValidation, issueAnalysis),
      };
    } catch (error) {
      return {
        valid: false,
        totalEntries: 0,
        sampleEntries: [],
        formatValidation: {
          valid: false,
          errors: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        },
        issues: {
          duplicates: 0,
          invalidPhones: 0,
          missingRequired: 0,
          formatErrors: 0,
        },
        estimation: {
          expectedSuccess: 0,
          expectedFailures: 0,
          expectedDuplicates: 0,
        },
        recommendations: ['Fix file format errors before importing'],
      };
    }
  }

  /**
   * Get import/export history for user
   */
  async getImportExportHistory(
    userId: string,
    type: 'import' | 'export' | 'both' = 'both',
    limit: number = 50
  ): Promise<ImportExportHistoryEntry[]> {
    try {
      // This would typically query a database
      // For now, return mock data
      return [];
    } catch (error) {
      logger.error('Failed to get import/export history', {
        userId,
        type,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  // Private implementation methods

  private async initializeService(): Promise<void> {
    logger.info('Import/Export service initialized', {
      version: this.serviceVersion,
      supportedFormats: this.SUPPORTED_FORMATS,
      maxFileSize: this.MAX_FILE_SIZE,
      maxImportSize: this.MAX_IMPORT_SIZE,
    });
  }

  private async parseFileData(fileData: Buffer, format: ImportFormat): Promise<RawImportEntry[]> {
    switch (format) {
      case 'csv':
        return this.parseCSV(fileData);
      case 'json':
        return this.parseJSON(fileData);
      case 'xlsx':
        return this.parseExcel(fileData);
      case 'vcf':
        return this.parseVCard(fileData);
      default:
        throw new WhitelistError(`Unsupported format: ${format}`, 'UNSUPPORTED_FORMAT');
    }
  }

  private async parseCSV(fileData: Buffer): Promise<RawImportEntry[]> {
    const entries: RawImportEntry[] = [];
    const csvData = fileData.toString('utf-8');
    
    return new Promise((resolve, reject) => {
      const stream = require('stream').Readable.from([csvData]);
      const results: any[] = [];
      
      stream
        .pipe(csv())
        .on('data', (data: any) => results.push(data))
        .on('end', () => {
          // Transform CSV data to our format
          const transformed = results.map((row, index) => ({
            lineNumber: index + 2, // +2 because of header and 0-based index
            contactPhone: this.normalizePhone(row.phone || row.contactPhone || row.number),
            contactName: row.name || row.contactName || row.displayName,
            whitelistType: this.normalizeWhitelistType(row.type || row.whitelistType),
            confidenceScore: this.parseFloat(row.confidence || row.confidenceScore) || 1.0,
            tags: this.parseTags(row.tags),
            notes: row.notes || row.description,
            rawData: row,
          }));
          
          resolve(transformed);
        })
        .on('error', reject);
    });
  }

  private async parseJSON(fileData: Buffer): Promise<RawImportEntry[]> {
    try {
      const jsonData = JSON.parse(fileData.toString('utf-8'));
      const entries = Array.isArray(jsonData) ? jsonData : [jsonData];
      
      return entries.map((entry, index) => ({
        lineNumber: index + 1,
        contactPhone: this.normalizePhone(entry.phone || entry.contactPhone),
        contactName: entry.name || entry.contactName,
        whitelistType: this.normalizeWhitelistType(entry.type || entry.whitelistType),
        confidenceScore: entry.confidence || entry.confidenceScore || 1.0,
        tags: this.parseTags(entry.tags),
        notes: entry.notes || entry.description,
        rawData: entry,
      }));
    } catch (error) {
      throw new WhitelistError('Invalid JSON format', 'INVALID_JSON');
    }
  }

  private async parseExcel(fileData: Buffer): Promise<RawImportEntry[]> {
    try {
      const workbook = XLSX.read(fileData, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      return jsonData.map((row: any, index) => ({
        lineNumber: index + 2, // +2 for header row
        contactPhone: this.normalizePhone(row.Phone || row.phone || row.Number),
        contactName: row.Name || row.name || row['Contact Name'],
        whitelistType: this.normalizeWhitelistType(row.Type || row.type),
        confidenceScore: this.parseFloat(row.Confidence || row.confidence) || 1.0,
        tags: this.parseTags(row.Tags || row.tags),
        notes: row.Notes || row.notes,
        rawData: row,
      }));
    } catch (error) {
      throw new WhitelistError('Invalid Excel format', 'INVALID_EXCEL');
    }
  }

  private async parseVCard(fileData: Buffer): Promise<RawImportEntry[]> {
    try {
      const vCardData = fileData.toString('utf-8');
      const vCards = this.splitVCards(vCardData);
      
      return vCards.map((vCard, index) => {
        const parsed = this.parseVCardEntry(vCard);
        return {
          lineNumber: index + 1,
          contactPhone: this.normalizePhone(parsed.phone),
          contactName: parsed.name,
          whitelistType: 'manual' as WhitelistType,
          confidenceScore: 1.0,
          tags: [],
          notes: parsed.notes,
          rawData: vCard,
        };
      });
    } catch (error) {
      throw new WhitelistError('Invalid vCard format', 'INVALID_VCARD');
    }
  }

  private async validateImportEntries(
    rawEntries: RawImportEntry[],
    userId: string,
    options: ImportOptions
  ): Promise<ImportValidationResult> {
    const validEntries: ValidatedImportEntry[] = [];
    const errors: ImportError[] = [];
    const duplicates: RawImportEntry[] = [];
    const existingPhones = new Set<string>();

    // Get existing whitelist to check for duplicates
    if (!options.allowDuplicates) {
      const existingWhitelist = await whitelistService.getUserWhitelist(userId, {
        page: 1,
        limit: 10000, // Get all entries
      });
      
      existingWhitelist.entries.forEach(entry => {
        existingPhones.add(entry.contactPhone);
      });
    }

    for (const rawEntry of rawEntries) {
      try {
        // Validate phone number
        if (!rawEntry.contactPhone || !this.isValidPhoneNumber(rawEntry.contactPhone)) {
          errors.push({
            line: rawEntry.lineNumber,
            field: 'contactPhone',
            message: 'Invalid or missing phone number',
            code: 'INVALID_PHONE',
          });
          continue;
        }

        // Check for duplicates
        if (!options.allowDuplicates && existingPhones.has(rawEntry.contactPhone)) {
          duplicates.push(rawEntry);
          continue;
        }

        // Validate confidence score
        if (rawEntry.confidenceScore < 0 || rawEntry.confidenceScore > 1) {
          rawEntry.confidenceScore = 1.0; // Default value
        }

        // Enhanced validation with ML risk assessment
        if (options.validateWithML) {
          const riskAssessment = await riskEvaluationService.evaluateRisk({
            phone: rawEntry.contactPhone,
            userId,
            context: { import: true, source: options.source },
          });

          if (riskAssessment.riskLevel === 'critical' && !options.allowHighRisk) {
            errors.push({
              line: rawEntry.lineNumber,
              field: 'riskAssessment',
              message: `High risk phone number (${riskAssessment.riskLevel})`,
              code: 'HIGH_RISK_PHONE',
            });
            continue;
          }
        }

        // Create validated entry
        const validatedEntry: ValidatedImportEntry = {
          ...rawEntry,
          userId,
          isValid: true,
          validationNotes: [],
        };

        validEntries.push(validatedEntry);
        existingPhones.add(rawEntry.contactPhone); // Track for internal duplicates

      } catch (error) {
        errors.push({
          line: rawEntry.lineNumber,
          field: 'general',
          message: error instanceof Error ? error.message : String(error),
          code: 'VALIDATION_ERROR',
        });
      }
    }

    return {
      validEntries,
      errors,
      duplicates,
    };
  }

  private async processImportBatches(
    userId: string,
    validEntries: ValidatedImportEntry[],
    options: ImportOptions
  ): Promise<BatchOperationResult> {
    let successful = 0;
    let failed = 0;
    const errors: Array<{ index: number; error: string }> = [];

    // Process in batches to avoid overwhelming the system
    for (let i = 0; i < validEntries.length; i += this.BATCH_SIZE) {
      const batch = validEntries.slice(i, i + this.BATCH_SIZE);
      
      for (let j = 0; j < batch.length; j++) {
        const entry = batch[j];
        try {
          const createRequest: CreateWhitelistRequest = {
            userId: entry.userId,
            contactPhone: entry.contactPhone,
            contactName: entry.contactName,
            whitelistType: entry.whitelistType,
            confidenceScore: entry.confidenceScore,
          };

          await whitelistService.createWhitelistEntry(createRequest);
          successful++;
        } catch (error) {
          failed++;
          errors.push({
            index: i + j,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Add small delay between batches to prevent overload
      if (i + this.BATCH_SIZE < validEntries.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { successful, failed, errors };
  }

  private async getWhitelistEntriesForExport(
    userId: string,
    options: ExportOptions
  ): Promise<SmartWhitelist[]> {
    return await whitelistService.getUserWhitelist(userId, {
      page: 1,
      limit: 50000, // Large limit to get all entries
      active: options.includeInactive ? undefined : true,
      type: options.whitelistType,
      search: options.search,
    }).then(result => result.entries);
  }

  private applyExportFilters(
    entries: SmartWhitelist[],
    options: ExportOptions
  ): SmartWhitelist[] {
    let filtered = entries;

    // Date range filter
    if (options.dateRange) {
      const { start, end } = options.dateRange;
      filtered = filtered.filter(entry => {
        const entryDate = entry.createdAt;
        return entryDate >= start && entryDate <= end;
      });
    }

    // Confidence score filter
    if (options.minConfidence !== undefined) {
      filtered = filtered.filter(entry => entry.confidenceScore >= options.minConfidence!);
    }

    // Hit count filter
    if (options.minHitCount !== undefined) {
      filtered = filtered.filter(entry => entry.hitCount >= options.minHitCount!);
    }

    return filtered;
  }

  private async transformEntriesForExport(
    entries: SmartWhitelist[],
    format: ExportFormat,
    options: ExportOptions
  ): Promise<ExportEntry[]> {
    return entries.map(entry => ({
      contactPhone: entry.contactPhone,
      contactName: entry.contactName || '',
      whitelistType: entry.whitelistType,
      confidenceScore: entry.confidenceScore,
      isActive: entry.isActive,
      hitCount: entry.hitCount,
      lastHitAt: entry.lastHitAt?.toISOString() || '',
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      // Include additional fields based on options
      ...(options.includeMetadata && {
        id: entry.id,
        userId: entry.userId,
        expiresAt: entry.expiresAt?.toISOString() || '',
      }),
    }));
  }

  private async generateExportData(
    entries: ExportEntry[],
    format: ExportFormat,
    options: ExportOptions
  ): Promise<Buffer> {
    switch (format) {
      case 'csv':
        return this.generateCSV(entries);
      case 'json':
        return this.generateJSON(entries, options);
      case 'xlsx':
        return this.generateExcel(entries);
      case 'vcf':
        return this.generateVCard(entries);
      default:
        throw new WhitelistError(`Unsupported export format: ${format}`, 'UNSUPPORTED_FORMAT');
    }
  }

  private generateCSV(entries: ExportEntry[]): Buffer {
    if (entries.length === 0) {
      return Buffer.from('');
    }

    const headers = Object.keys(entries[0]);
    const csvRows = [headers.join(',')];

    for (const entry of entries) {
      const row = headers.map(header => {
        const value = entry[header as keyof ExportEntry];
        const stringValue = value?.toString() || '';
        // Escape CSV special characters
        return stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')
          ? `"${stringValue.replace(/"/g, '""')}"`
          : stringValue;
      });
      csvRows.push(row.join(','));
    }

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }

  private generateJSON(entries: ExportEntry[], options: ExportOptions): Buffer {
    const exportData = {
      metadata: {
        exportDate: new Date().toISOString(),
        totalEntries: entries.length,
        format: 'json',
        version: this.serviceVersion,
      },
      entries,
    };

    return Buffer.from(JSON.stringify(exportData, null, options.prettyFormat ? 2 : 0), 'utf-8');
  }

  private generateExcel(entries: ExportEntry[]): Buffer {
    const worksheet = XLSX.utils.json_to_sheet(entries);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Whitelist');
    
    return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  }

  private generateVCard(entries: ExportEntry[]): Buffer {
    const vCards = entries.map(entry => {
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `FN:${entry.contactName || 'Unknown'}`,
        `TEL:${entry.contactPhone}`,
        `NOTE:Whitelist Type: ${entry.whitelistType}, Confidence: ${entry.confidenceScore}`,
        'END:VCARD',
      ].join('\r\n');
    });

    return Buffer.from(vCards.join('\r\n\r\n'), 'utf-8');
  }

  // Utility methods
  private generateImportId(): string {
    return `import_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private generateExportId(): string {
    return `export_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  private normalizePhone(phone: string | undefined): string {
    if (!phone) return '';
    // Remove non-numeric characters except + at the beginning
    return phone.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  }

  private normalizeWhitelistType(type: string | undefined): WhitelistType {
    if (!type) return 'manual';
    const lowerType = type.toLowerCase();
    const validTypes: WhitelistType[] = ['manual', 'auto', 'temporary', 'learned'];
    return validTypes.includes(lowerType as WhitelistType) ? lowerType as WhitelistType : 'manual';
  }

  private parseFloat(value: any): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = parseFloat(value);
      return isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  private parseTags(tags: any): string[] {
    if (Array.isArray(tags)) return tags.map(String);
    if (typeof tags === 'string') {
      return tags.split(',').map(tag => tag.trim()).filter(Boolean);
    }
    return [];
  }

  private isValidPhoneNumber(phone: string): boolean {
    // Basic phone number validation
    const phoneRegex = /^\+?[1-9]\d{1,14}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  }

  private splitVCards(vCardData: string): string[] {
    return vCardData.split(/BEGIN:VCARD/i)
      .slice(1) // Remove empty first element
      .map(vCard => 'BEGIN:VCARD' + vCard.trim())
      .filter(vCard => vCard.includes('END:VCARD'));
  }

  private parseVCardEntry(vCard: string): { name: string; phone: string; notes: string } {
    const lines = vCard.split(/\r?\n/);
    let name = '';
    let phone = '';
    let notes = '';

    for (const line of lines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;
      
      const field = line.substring(0, colonIndex).toUpperCase();
      const value = line.substring(colonIndex + 1);

      if (field.startsWith('FN')) {
        name = value;
      } else if (field.startsWith('TEL')) {
        phone = value;
      } else if (field.startsWith('NOTE')) {
        notes = value;
      }
    }

    return { name, phone, notes };
  }

  private generateExportFilename(
    userId: string,
    format: ExportFormat,
    entryCount: number
  ): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = this.getFileExtension(format);
    return `whitelist-${userId.substring(0, 8)}-${entryCount}entries-${timestamp}.${extension}`;
  }

  private getFileExtension(format: ExportFormat): string {
    const extensions = {
      csv: 'csv',
      json: 'json',
      xlsx: 'xlsx',
      vcf: 'vcf',
    };
    return extensions[format];
  }

  private getExportMimeType(format: ExportFormat): string {
    const mimeTypes = {
      csv: 'text/csv',
      json: 'application/json',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      vcf: 'text/vcard',
    };
    return mimeTypes[format];
  }

  private createExportMetadata(
    exportId: string,
    userId: string,
    format: ExportFormat,
    entryCount: number,
    options: ExportOptions
  ): ExportMetadata {
    return {
      exportId,
      userId,
      format,
      entryCount,
      options,
      exportDate: new Date(),
      version: this.serviceVersion,
    };
  }

  private validateFileFormat(entries: RawImportEntry[], format: ImportFormat): FormatValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (entries.length === 0) {
      errors.push('File contains no entries');
      return { valid: false, errors, warnings };
    }

    // Check required fields
    const requiredFields = ['contactPhone'];
    const firstEntry = entries[0];

    for (const field of requiredFields) {
      if (!firstEntry[field as keyof RawImportEntry]) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check for common issues
    let invalidPhones = 0;
    let missingNames = 0;

    for (const entry of entries.slice(0, 100)) { // Check first 100 entries
      if (!this.isValidPhoneNumber(entry.contactPhone)) {
        invalidPhones++;
      }
      if (!entry.contactName) {
        missingNames++;
      }
    }

    if (invalidPhones > 0) {
      warnings.push(`${invalidPhones} entries have invalid phone numbers`);
    }
    if (missingNames > entries.length * 0.5) {
      warnings.push('Many entries are missing contact names');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private analyzeImportIssues(entries: RawImportEntry[]): ImportIssueAnalysis {
    let duplicates = 0;
    let invalidPhones = 0;
    let missingRequired = 0;
    let formatErrors = 0;

    const seenPhones = new Set<string>();

    for (const entry of entries) {
      // Check for duplicates
      if (seenPhones.has(entry.contactPhone)) {
        duplicates++;
      } else {
        seenPhones.add(entry.contactPhone);
      }

      // Check for invalid phones
      if (!this.isValidPhoneNumber(entry.contactPhone)) {
        invalidPhones++;
      }

      // Check for missing required fields
      if (!entry.contactPhone) {
        missingRequired++;
      }

      // Check for format errors
      if (entry.confidenceScore < 0 || entry.confidenceScore > 1) {
        formatErrors++;
      }
    }

    return {
      duplicates,
      invalidPhones,
      missingRequired,
      formatErrors,
    };
  }

  private estimateImportOutcome(
    entries: RawImportEntry[],
    issues: ImportIssueAnalysis
  ): ImportEstimation {
    const total = entries.length;
    const expectedFailures = issues.invalidPhones + issues.missingRequired + issues.formatErrors;
    const expectedSuccess = total - expectedFailures;
    const expectedDuplicates = issues.duplicates;

    return {
      expectedSuccess: Math.max(0, expectedSuccess),
      expectedFailures,
      expectedDuplicates,
    };
  }

  private generateImportRecommendations(
    formatValidation: FormatValidation,
    issues: ImportIssueAnalysis
  ): string[] {
    const recommendations: string[] = [];

    if (!formatValidation.valid) {
      recommendations.push('Fix format errors before importing');
    }

    if (issues.invalidPhones > 0) {
      recommendations.push('Review and correct invalid phone numbers');
    }

    if (issues.duplicates > 0) {
      recommendations.push('Consider removing duplicate entries or enabling duplicate handling');
    }

    if (issues.missingRequired > 0) {
      recommendations.push('Add missing required fields');
    }

    if (recommendations.length === 0) {
      recommendations.push('File looks good for import');
    }

    return recommendations;
  }

  private async generateImportReport(
    importId: string,
    validation: ImportValidationResult,
    importResult: BatchOperationResult,
    processingTime: number
  ): Promise<ImportReport> {
    return {
      importId,
      summary: {
        totalProcessed: validation.validEntries.length,
        successful: importResult.successful,
        failed: importResult.failed,
        duplicatesSkipped: validation.duplicates.length,
        processingTimeMs: processingTime,
      },
      validation: {
        validEntries: validation.validEntries.length,
        errors: validation.errors.length,
        duplicates: validation.duplicates.length,
      },
      errors: validation.errors,
      generatedAt: new Date(),
    };
  }

  // Placeholder implementations for external source integration
  private async createExternalSourceConnector(
    source: ExternalSource,
    credentials: ExternalSourceCredentials
  ): Promise<ExternalSourceConnector> {
    // This would create appropriate connectors for different external sources
    throw new WhitelistError('External source connectors not implemented yet', 'NOT_IMPLEMENTED');
  }

  private async transformExternalContacts(
    contacts: any[],
    userId: string,
    source: ExternalSource
  ): Promise<RawImportEntry[]> {
    return contacts.map((contact, index) => ({
      lineNumber: index + 1,
      contactPhone: this.normalizePhone(contact.phone),
      contactName: contact.name,
      whitelistType: 'auto' as WhitelistType,
      confidenceScore: 0.8,
      tags: [`external_${source.type}`],
      notes: `Imported from ${source.type}`,
      rawData: contact,
    }));
  }

  // Service health check
  async getServiceHealth(): Promise<{
    healthy: boolean;
    supportedFormats: string[];
    maxFileSize: number;
    maxImportSize: number;
  }> {
    return {
      healthy: true,
      supportedFormats: this.SUPPORTED_FORMATS,
      maxFileSize: this.MAX_FILE_SIZE,
      maxImportSize: this.MAX_IMPORT_SIZE,
    };
  }
}

// Type definitions
type ImportFormat = 'csv' | 'json' | 'xlsx' | 'vcf';
type ExportFormat = 'csv' | 'json' | 'xlsx' | 'vcf';

interface ImportOptions {
  allowDuplicates?: boolean;
  allowHighRisk?: boolean;
  validateWithML?: boolean;
  source?: string;
  filters?: Record<string, any>;
}

interface ExportOptions {
  includeInactive?: boolean;
  includeMetadata?: boolean;
  whitelistType?: WhitelistType;
  search?: string;
  dateRange?: { start: Date; end: Date };
  minConfidence?: number;
  minHitCount?: number;
  prettyFormat?: boolean;
}

interface RawImportEntry {
  lineNumber: number;
  contactPhone: string;
  contactName?: string;
  whitelistType: WhitelistType;
  confidenceScore: number;
  tags?: string[];
  notes?: string;
  rawData: any;
}

interface ValidatedImportEntry extends RawImportEntry {
  userId: string;
  isValid: boolean;
  validationNotes: string[];
}

interface ImportError {
  line: number;
  field: string;
  message: string;
  code: string;
}

interface ImportValidationResult {
  validEntries: ValidatedImportEntry[];
  errors: ImportError[];
  duplicates: RawImportEntry[];
}

interface ImportResult {
  importId: string;
  userId: string;
  format: ImportFormat;
  totalEntries: number;
  processed: number;
  successful: number;
  failed: number;
  duplicates: number;
  errors: ImportError[];
  report: ImportReport | null;
  processingTimeMs: number;
  timestamp: Date;
}

interface ExportEntry {
  contactPhone: string;
  contactName: string;
  whitelistType: WhitelistType;
  confidenceScore: number;
  isActive: boolean;
  hitCount: number;
  lastHitAt: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: any; // For additional metadata fields
}

interface ExportResult {
  exportId: string;
  userId: string;
  format: ExportFormat;
  entriesExported: number;
  data: Buffer;
  metadata: ExportMetadata;
  filename: string;
  mimeType: string;
  processingTimeMs: number;
  timestamp: Date;
}

interface ExportMetadata {
  exportId: string;
  userId: string;
  format: ExportFormat;
  entryCount: number;
  options: ExportOptions;
  exportDate: Date;
  version: string;
}

interface ImportValidationResult {
  valid: boolean;
  totalEntries: number;
  sampleEntries: RawImportEntry[];
  formatValidation: FormatValidation;
  issues: ImportIssueAnalysis;
  estimation: ImportEstimation;
  recommendations: string[];
}

interface FormatValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface ImportIssueAnalysis {
  duplicates: number;
  invalidPhones: number;
  missingRequired: number;
  formatErrors: number;
}

interface ImportEstimation {
  expectedSuccess: number;
  expectedFailures: number;
  expectedDuplicates: number;
}

interface ImportReport {
  importId: string;
  summary: {
    totalProcessed: number;
    successful: number;
    failed: number;
    duplicatesSkipped: number;
    processingTimeMs: number;
  };
  validation: {
    validEntries: number;
    errors: number;
    duplicates: number;
  };
  errors: ImportError[];
  generatedAt: Date;
}

interface ExternalSource {
  type: 'google_contacts' | 'outlook' | 'apple_contacts' | 'csv_url';
  name: string;
  config: Record<string, any>;
}

interface ExternalSourceCredentials {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  username?: string;
  password?: string;
}

interface ExternalSourceConnector {
  fetchContacts(filters?: Record<string, any>): Promise<any[]>;
}

interface ImportExportHistoryEntry {
  id: string;
  userId: string;
  type: 'import' | 'export';
  format: string;
  entryCount: number;
  status: 'success' | 'partial' | 'failed';
  timestamp: Date;
  processingTimeMs: number;
}

export const importExportService = new ImportExportService();
export default importExportService;