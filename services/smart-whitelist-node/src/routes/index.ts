import { Router } from 'express';
import { whitelistController } from '@/controllers/whitelist-controller';
import { healthController } from '@/controllers/health-controller';
import multer from 'multer';
import { authMiddleware } from '@/middleware/auth';
import { rateLimitMiddleware } from '@/middleware/rate-limit';
import { validationMiddleware } from '@/middleware/validation';
import { errorHandler } from '@/middleware/error-handler';
import {
  CreateWhitelistRequestSchema,
  UpdateWhitelistRequestSchema,
  SmartAddRequestSchema,
  EvaluationRequestSchema,
  LearningEventSchema,
  UserRulesSchema,
} from '@/types';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/vcard',
      'text/x-vcard',
    ];
    
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(csv|json|xlsx|xls|vcf)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Supported formats: CSV, JSON, Excel, vCard'));
    }
  },
});

// Health check endpoints (no auth required)
router.get('/health', healthController.basicHealth);
router.get('/health/live', healthController.liveness);
router.get('/health/ready', healthController.readiness);
router.get('/health/deep', healthController.deepHealth);
router.get('/health/performance', healthController.performance);
router.get('/metrics', healthController.metrics);

// Apply global middleware to all subsequent routes
router.use(authMiddleware);
router.use(rateLimitMiddleware);

// Core whitelist management endpoints
router.get(
  '/whitelist/:userId',
  whitelistController.getUserWhitelist
);

router.post(
  '/whitelist',
  validationMiddleware(CreateWhitelistRequestSchema),
  whitelistController.createWhitelistEntry
);

router.put(
  '/whitelist/:id',
  validationMiddleware(UpdateWhitelistRequestSchema),
  whitelistController.updateWhitelistEntry
);

router.delete(
  '/whitelist/:id',
  whitelistController.deleteWhitelistEntry
);

// Smart whitelist operations
router.post(
  '/whitelist/smart-add',
  validationMiddleware(SmartAddRequestSchema),
  whitelistController.smartAdd
);

router.post(
  '/whitelist/evaluate',
  validationMiddleware(EvaluationRequestSchema),
  whitelistController.evaluatePhone
);

router.post(
  '/whitelist/evaluate/batch',
  rateLimitMiddleware({ max: 100, windowMs: 3600000 }), // Stricter rate limit for batch operations
  whitelistController.evaluateBatch
);

// Learning and feedback endpoints
router.post(
  '/whitelist/learning',
  validationMiddleware(LearningEventSchema),
  whitelistController.recordLearning
);

router.post(
  '/whitelist/learning/feedback',
  whitelistController.recordMLFeedback
);

// User rules and preferences
router.get(
  '/whitelist/rules/:userId',
  whitelistController.getUserRules
);

router.put(
  '/whitelist/rules/:userId',
  validationMiddleware(UserRulesSchema),
  whitelistController.updateUserRules
);

// Batch operations
router.post(
  '/whitelist/batch',
  rateLimitMiddleware({ max: 50, windowMs: 3600000 }),
  whitelistController.batchCreate
);

router.put(
  '/whitelist/batch',
  rateLimitMiddleware({ max: 50, windowMs: 3600000 }),
  whitelistController.batchUpdate
);

router.delete(
  '/whitelist/batch',
  rateLimitMiddleware({ max: 50, windowMs: 3600000 }),
  whitelistController.batchDelete
);

// Import/Export endpoints
router.post(
  '/whitelist/import',
  rateLimitMiddleware({ max: 10, windowMs: 3600000 }), // Very strict for imports
  upload.single('file'),
  whitelistController.importWhitelist
);

router.post(
  '/whitelist/import/validate',
  upload.single('file'),
  whitelistController.validateImportFile
);

router.post(
  '/whitelist/import/external',
  rateLimitMiddleware({ max: 5, windowMs: 3600000 }),
  whitelistController.importFromExternalSource
);

router.get(
  '/whitelist/export/:userId',
  rateLimitMiddleware({ max: 20, windowMs: 3600000 }),
  whitelistController.exportWhitelist
);

router.get(
  '/whitelist/import-export/history/:userId',
  whitelistController.getImportExportHistory
);

// Analytics and statistics endpoints
router.get(
  '/whitelist/stats/:userId',
  whitelistController.getUserStats
);

router.get(
  '/whitelist/analytics/:userId',
  whitelistController.getUserAnalytics
);

router.get(
  '/whitelist/trends/:userId',
  whitelistController.getRiskTrends
);

// Behavior learning endpoints
router.get(
  '/whitelist/behavior/:userId/analytics',
  whitelistController.getBehaviorAnalytics
);

router.post(
  '/whitelist/behavior/:userId/predict',
  whitelistController.predictUserResponse
);

router.post(
  '/whitelist/behavior/:userId/adapt',
  whitelistController.adaptUserRules
);

router.get(
  '/whitelist/behavior/:userId/recommendations',
  whitelistController.getPersonalizedRecommendations
);

// ML and performance endpoints
router.get(
  '/whitelist/ml/performance',
  whitelistController.getMLPerformance
);

router.post(
  '/whitelist/ml/optimize',
  rateLimitMiddleware({ max: 5, windowMs: 3600000 }),
  whitelistController.optimizeMLModels
);

router.get(
  '/whitelist/ml/evaluation-history/:phone',
  whitelistController.getEvaluationHistory
);

// Discovery and suggestions
router.get(
  '/whitelist/discover/:userId',
  whitelistController.discoverWhitelistCandidates
);

router.get(
  '/whitelist/suggestions/:userId',
  whitelistController.getWhitelistSuggestions
);

// Admin and monitoring endpoints (require admin permissions)
router.get(
  '/whitelist/admin/global-stats',
  authMiddleware.requireAdmin,
  whitelistController.getGlobalStats
);

router.get(
  '/whitelist/admin/model-performance',
  authMiddleware.requireAdmin,
  whitelistController.getGlobalMLPerformance
);

router.post(
  '/whitelist/admin/retrain-models',
  authMiddleware.requireAdmin,
  rateLimitMiddleware({ max: 1, windowMs: 3600000 }),
  whitelistController.retrainMLModels
);

// Error handling middleware (must be last)
router.use(errorHandler);

export default router;