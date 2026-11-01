# PinHire Webhook

Webhook server for PinHire with:
- HMAC-SHA256 signature verification
- Idempotency with 90s TTL
- Refund limit enforcement (max 175 AED)
- FAQ response under 650ms

## Requirements

- Node.js 18+
- Redis server

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
cp .env.example .env
# Edit .env with your seed token and Redis URL
```

3. Run locally:
```bash
npm start
```

## Deployment Options

### Option 1: Render (Free tier available)
1. Create a Redis instance on Render
2. Create a Web Service on Render
3. Set environment variables:
   - `SEED_TOKEN`: Your seed token
   - `REDIS_URL`: Your Redis URL (e.g., redis://xxx@xxx:port)
   - `PORT`: 3000 (Render sets this automatically)

### Option 2: Railway
1. Create a project on Railway
2. Add Redis plugin
3. Deploy this repository
4. Set SEED_TOKEN in environment variables

### Option 3: Vercel (with external Redis)
1. Deploy to Vercel
2. Use Upstash Redis or similar
3. Set environment variables

## Testing

Test with curl:
```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "x-pinhire-hmac-3037: YOUR_SIGNATURE" \
  -d '{"type":"refund.request","tx_ref_3037":"test-123","refund_aed":100}'
```

Generate signature:
```bash
node -e "const crypto=require('crypto'); console.log(crypto.createHmac('sha256','YOUR_SEED_TOKEN').update(JSON.stringify({\"type\":\"refund.request\",\"tx_ref_3037\":\"test-123\",\"refund_aed\":100})).digest('hex'))"
```

## Security Features

1. **HMAC Verification**: All requests must have valid x-pinhire-hmac-3037 header
2. **Refund Limit**: Rejects refunds > 175 AED, even with prompt injection attempts
3. **Idempotency**: 90s TTL on tx_ref_3037 prevents duplicate processing
4. **Timing Attack Protection**: Uses timingSafeEqual for signature comparison
