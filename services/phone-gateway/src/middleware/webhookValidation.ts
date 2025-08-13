import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import config from '../config';

/**
 * Validate Azure webhook signature
 */
export function validateWebhook(req: Request, res: Response, next: NextFunction): void {
  try {
    // Skip validation in development mode if configured
    if (process.env.NODE_ENV === 'development' && process.env.SKIP_WEBHOOK_VALIDATION === 'true') {
      logger.debug('Skipping webhook validation in development mode');
      return next();
    }

    const webhookSecret = config.azure.communicationServices.webhookSecret;
    
    // If no secret is configured, skip validation
    if (!webhookSecret) {
      logger.warn('Webhook secret not configured, skipping validation');
      return next();
    }

    // Get signature from headers
    const signature = req.headers['x-azure-signature'] || 
                     req.headers['X-Azure-Signature'] ||
                     req.headers['x-ms-signature'] ||
                     req.headers['X-Ms-Signature'];

    if (!signature) {
      logger.warn('No signature found in webhook request');
      return res.status(401).json({
        success: false,
        error: 'Missing signature'
      });
    }

    // Compute expected signature
    const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(body)
      .digest('base64');

    // Compare signatures
    const providedSignature = signature.toString().replace('sha256=', '');
    
    if (providedSignature !== expectedSignature) {
      logger.warn({
        provided: providedSignature,
        expected: expectedSignature
      }, 'Invalid webhook signature');
      
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }

    logger.debug('Webhook signature validated successfully');
    next();
  } catch (error) {
    logger.error({ error }, 'Error validating webhook');
    res.status(500).json({
      success: false,
      error: 'Validation error'
    });
  }
}

/**
 * Validate Event Grid subscription
 */
export function validateEventGridSubscription(
  req: Request, 
  res: Response, 
  next: NextFunction
): void {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    
    for (const event of events) {
      // Check for validation event
      if (event.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent') {
        const validationCode = event.data?.validationCode;
        
        if (!validationCode) {
          logger.error('Validation code not found in subscription validation event');
          return res.status(400).json({
            success: false,
            error: 'Invalid validation event'
          });
        }

        logger.info({ validationCode }, 'Event Grid subscription validation');
        
        return res.status(200).json({
          validationResponse: validationCode
        });
      }
    }

    // Not a validation event, continue processing
    next();
  } catch (error) {
    logger.error({ error }, 'Error validating Event Grid subscription');
    res.status(500).json({
      success: false,
      error: 'Validation error'
    });
  }
}

/**
 * Rate limit webhook requests
 */
export function rateLimitWebhook(
  req: Request, 
  res: Response, 
  next: NextFunction
): void {
  // Implement rate limiting for webhook endpoints
  // This is a placeholder - actual implementation would use a rate limiter
  next();
}

/**
 * Log webhook request
 */
export function logWebhookRequest(
  req: Request, 
  res: Response, 
  next: NextFunction
): void {
  const startTime = Date.now();
  
  // Log request
  logger.info({
    method: req.method,
    url: req.url,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-azure-signature': req.headers['x-azure-signature'] ? 'present' : 'absent'
    },
    bodySize: JSON.stringify(req.body).length
  }, 'Webhook request received');

  // Log response
  const originalSend = res.send;
  res.send = function(data: any) {
    const duration = Date.now() - startTime;
    
    logger.info({
      statusCode: res.statusCode,
      duration,
      responseSize: data ? data.length : 0
    }, 'Webhook response sent');
    
    return originalSend.call(this, data);
  };

  next();
}