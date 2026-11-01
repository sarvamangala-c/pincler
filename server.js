require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const { createClient } = require('redis');

const app = express();
const PORT = process.env.PORT || 3000;

// Seed token - should be set via environment variable in production
const SEED_TOKEN = process.env.SEED_TOKEN || 'your-seed-token-here';
const REFUND_LIMIT = 175; // AED
const IDEMPOTENCY_TTL = 90; // seconds

// Redis client for idempotency
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

// Connect to Redis
redisClient.connect().catch(console.error);

app.use(express.raw({ type: 'application/json' }));

// Middleware to measure response time for FAQ
const faqResponseTime = (req, res, next) => {
  if (req.body?.type === 'faq.query') {
    req.startTime = Date.now();
  }
  next();
};

app.use(faqResponseTime);

// Main webhook endpoint
app.post('/webhook', async (req, res) => {
  try {
    const rawBody = req.body;
    const body = JSON.parse(rawBody.toString());
    const signature = req.headers['x-pinhire-hmac-3037'];

    // 1. Verify HMAC signature
    if (!signature) {
      console.error('Missing signature header');
      return res.status(401).json({ error: 'Missing signature' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', SEED_TOKEN)
      .update(rawBody)
      .digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      console.error('Invalid signature');
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // 2. Check idempotency
    const txRef = body.tx_ref_3037;
    if (!txRef) {
      return res.status(400).json({ error: 'Missing tx_ref_3037' });
    }

    const idempotencyKey = `webhook:${txRef}`;
    const existing = await redisClient.get(idempotencyKey);

    if (existing) {
      console.log(`Duplicate request: ${txRef}`);
      return res.status(409).json({ status: 'duplicate' });
    }

    // Set idempotency lock with TTL
    await redisClient.setEx(idempotencyKey, IDEMPOTENCY_TTL, 'processed');

    // 3. Handle refund with limit check
    if (body.type === 'refund.request') {
      const refundAmount = body.refund_aed;

      // Validate refund amount exists and is a number
      if (typeof refundAmount !== 'number' || refundAmount < 0) {
        return res.status(400).json({ error: 'Invalid refund amount' });
      }

      // Check against refund limit
      if (refundAmount > REFUND_LIMIT) {
        console.log(`Refund rejected: ${refundAmount} AED exceeds limit of ${REFUND_LIMIT} AED`);
        return res.status(403).json({
          error: 'Refund amount exceeds limit',
          max_refund: REFUND_LIMIT,
          requested: refundAmount
        });
      }

      // Process refund
      return res.json({
        status: 'processed',
        refund_aed: refundAmount,
        tx_ref: txRef
      });
    }

    // 4. Handle FAQ queries with <650ms response time
    if (body.type === 'faq.query') {
      const responseTime = Date.now() - req.startTime;
      console.log(`FAQ response time: ${responseTime}ms`);

      if (responseTime >= 650) {
        console.warn(`FAQ response too slow: ${responseTime}ms`);
      }

      // Simple FAQ responses - cached for speed
      const faqAnswers = {
        'refund_policy': 'Refunds are processed within 3-5 business days for eligible transactions.',
        'payment_methods': 'We accept credit cards, debit cards, and bank transfers.',
        'contact': 'Contact support at support@pinhire.com or call +971-4-123-4567.',
        'default': 'Thank you for your inquiry. Our team will respond shortly.'
      };

      const answer = faqAnswers[body.question] || faqAnswers['default'];

      return res.json({
        status: 'processed',
        answer: answer,
        response_time_ms: responseTime
      });
    }

    // Default response for other message types
    return res.json({
      status: 'processed',
      tx_ref: txRef,
      message_type: body.type
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Webhook server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  await redisClient.quit();
  process.exit(0);
});
