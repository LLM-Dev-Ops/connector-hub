# LLM-Connector-Hub Agents - Usage Examples

## Table of Contents
1. [ERP Surface Agent](#1-erp-surface-agent)
2. [Webhook Ingest Agent](#2-webhook-ingest-agent)
3. [Auth Identity Verification Agent](#3-auth-identity-verification-agent)
4. [Data Normalizer Agent](#4-data-normalizer-agent)

---

## 1. ERP Surface Agent

### SAP Purchase Order Event

```typescript
import { createERPSurfaceAgent } from '@llm-dev-ops/connector-hub-agents';

const agent = createERPSurfaceAgent({
  connector_scope: 'sap-production',
  allowed_erp_systems: ['sap'],
  required_fields: ['event_type', 'event_timestamp', 'payload'],
  field_mappings: {
    sap: {
      'BUKRS': 'company_code',
      'WERKS': 'plant',
      'BELNR': 'document_number',
      'EBELN': 'po_number',
      'LIFNR': 'vendor_code'
    }
  },
  timeout_ms: 30000,
  debug: false
});

await agent.initialize();

const response = await agent.process({
  erp_system: 'sap',
  event_type: 'purchase_order_created',
  event_timestamp: '2024-01-21T10:30:00Z',
  payload: {
    BUKRS: '1000',
    WERKS: '1001',
    EBELN: '4500012345',
    BELNR: 'PO-2024-001',
    LIFNR: 'V123456',
    NETWR: '50000.00',
    WAERS: 'USD'
  },
  identifiers: {
    company_code: '1000',
    plant: '1001',
    document_number: 'PO-2024-001'
  }
});

if (response.status === 'success') {
  console.log('ERP Event Ingested:', response.decision_event?.outputs);
  console.log('Confidence Score:', response.decision_event?.confidence.score);
}
```

### Oracle EBS Invoice Event

```typescript
const oracleAgent = createERPSurfaceAgent({
  connector_scope: 'oracle-ebs-production',
  allowed_erp_systems: ['oracle_ebs'],
  field_mappings: {
    oracle_ebs: {
      'ORG_ID': 'organization_id',
      'INVOICE_NUM': 'document_number',
      'VENDOR_ID': 'vendor_code'
    }
  },
  timeout_ms: 30000
});

await oracleAgent.initialize();

const invoiceResponse = await oracleAgent.process({
  erp_system: 'oracle_ebs',
  event_type: 'invoice_approved',
  event_timestamp: '2024-01-21T11:00:00Z',
  payload: {
    ORG_ID: '204',
    INVOICE_NUM: 'INV-2024-001234',
    VENDOR_ID: '12345',
    INVOICE_AMOUNT: 75000.00,
    INVOICE_CURRENCY: 'USD',
    GL_DATE: '2024-01-21'
  },
  system_version: '12.2.10'
});
```

---

## 2. Webhook Ingest Agent

### Stripe Payment Webhook

```typescript
import { createWebhookIngestAgent } from '@llm-dev-ops/connector-hub-agents';

const stripeAgent = createWebhookIngestAgent({
  connector_id: 'stripe-payment-webhook',
  connector_scope: 'payment-webhooks',
  signature: {
    method: 'hmac_sha256',
    header_name: 'stripe-signature',
    secret_key: process.env.STRIPE_WEBHOOK_SECRET!,
    timestamp_tolerance_seconds: 300,
    timestamp_header: 'stripe-timestamp'
  },
  allowed_content_types: ['application/json'],
  replay_protection: true,
  rate_limit_enabled: true,
  rate_limit_rpm: 1000,
  timeout_ms: 10000
});

await stripeAgent.initialize();

const webhookPayload = {
  method: 'POST' as const,
  path: '/webhooks/stripe/payment',
  headers: {
    'content-type': 'application/json',
    'stripe-signature': 't=1642768800,v1=abc123...',
    'stripe-timestamp': '1642768800'
  },
  body: JSON.stringify({
    id: 'evt_1234567890',
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: 'pi_1234567890',
        amount: 5000,
        currency: 'usd',
        status: 'succeeded'
      }
    }
  }),
  received_at: new Date().toISOString(),
  content_type: 'application/json',
  source_ip: '192.168.1.100'
};

const response = await stripeAgent.process(webhookPayload);

if (response.status === 'success') {
  console.log('Webhook Validated:', response.decision_event?.outputs);
  console.log('Auth Assurance:', response.decision_event?.confidence.auth_assurance);
}
```

### GitHub Webhook with HMAC Verification

```typescript
const githubAgent = createWebhookIngestAgent({
  connector_id: 'github-repo-webhook',
  connector_scope: 'github-webhooks',
  signature: {
    method: 'hmac_sha256',
    header_name: 'x-hub-signature-256',
    secret_key: process.env.GITHUB_WEBHOOK_SECRET!,
    timestamp_tolerance_seconds: 300
  },
  allowed_content_types: ['application/json'],
  replay_protection: true,
  timeout_ms: 5000
});

await githubAgent.initialize();

const githubPayload = {
  method: 'POST' as const,
  path: '/webhooks/github/push',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature-256': 'sha256=abc123...',
    'x-github-delivery': 'uuid-123',
    'x-github-event': 'push'
  },
  body: JSON.stringify({
    ref: 'refs/heads/main',
    repository: {
      name: 'my-repo',
      full_name: 'org/my-repo'
    },
    commits: [
      {
        id: 'abc123',
        message: 'Fix bug',
        author: { name: 'John Doe' }
      }
    ]
  }),
  received_at: new Date().toISOString(),
  content_type: 'application/json'
};

const githubResponse = await githubAgent.process(githubPayload);
```

---

## 3. Auth Identity Verification Agent

### JWT Token Verification

```typescript
import { createAuthIdentityAgent } from '@llm-dev-ops/connector-hub-agents';

const jwtAgent = createAuthIdentityAgent({
  connector_scope: 'api-authentication',
  allowed_auth_methods: ['jwt', 'oauth2'],
  require_mfa_for_high_assurance: true,
  jwt_settings: {
    algorithms: ['RS256', 'ES256'],
    allowed_issuers: ['https://auth.example.com', 'https://login.example.com'],
    required_audience: 'api.example.com',
    clock_tolerance: 60
  },
  min_trust_score: 0.7,
  timeout_ms: 5000
});

await jwtAgent.initialize();

const jwtPayload = {
  auth_method: 'jwt' as const,
  credentials: {
    token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzEyMzQ1IiwibmFtZSI6IkpvaG4gRG9lIiwiaXNzIjoiaHR0cHM6Ly9hdXRoLmV4YW1wbGUuY29tIiwiYXVkIjoiYXBpLmV4YW1wbGUuY29tIiwiZXhwIjoxNzA2NzY4NDAwLCJpYXQiOjE3MDY3NjQ4MDAsInNjb3BlIjoicmVhZDp1c2VycyB3cml0ZTpvcmRlcnMiLCJhbXIiOlsicHdkIiwibWZhIl19.signature...'
  },
  required_scopes: ['read:users', 'write:orders'],
  context: {
    ip_address: '192.168.1.100',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    device_id: 'device-123',
    session_id: 'session-456'
  }
};

const response = await jwtAgent.process(jwtPayload);

if (response.status === 'success') {
  console.log('Identity Verified:', response.decision_event?.outputs.verified);
  console.log('Subject ID:', response.decision_event?.outputs.subject_id);
  console.log('AAL Level:', response.decision_event?.outputs.aal_level);
  console.log('MFA Used:', response.decision_event?.outputs.mfa_used);
  console.log('Trust Score:', response.decision_event?.outputs.trust_score);
}
```

### API Key Authentication

```typescript
const apiKeyAgent = createAuthIdentityAgent({
  connector_scope: 'api-key-auth',
  allowed_auth_methods: ['api_key'],
  require_mfa_for_high_assurance: false,
  min_trust_score: 0.5,
  timeout_ms: 3000
});

await apiKeyAgent.initialize();

const apiKeyPayload = {
  auth_method: 'api_key' as const,
  credentials: {
    api_key: 'ak_live_1234567890abcdefghijklmnopqrstuvwxyz'
  },
  context: {
    ip_address: '10.0.1.50',
    user_agent: 'API-Client/1.0'
  }
};

const apiKeyResponse = await apiKeyAgent.process(apiKeyPayload);
```

---

## 4. Data Normalizer Agent

### User Profile Normalization

```typescript
import { createDataNormalizerAgent } from '@llm-dev-ops/connector-hub-agents';

const userNormalizer = createDataNormalizerAgent({
  connector_scope: 'user-data-normalization',
  allowed_source_formats: ['json'],
  default_validation_mode: 'strict',
  enable_quality_scoring: true,
  timeout_ms: 15000
});

await userNormalizer.initialize();

const userPayload = {
  source_format: 'json' as const,
  source_data: {
    first_name: 'John',
    last_name: 'Doe',
    email_address: 'JOHN.DOE@EXAMPLE.COM',
    phone: '555-123-4567',
    date_of_birth: '1990-05-15',
    address: {
      street: '123 Main St',
      city: 'New York',
      state: 'NY',
      zip: '10001'
    }
  },
  schema_mapping: {
    mapping_id: 'external-user-to-canonical',
    source_schema: 'external-user-v1',
    target_schema: 'canonical-user-v2',
    version: '1.0.0',
    field_mappings: [
      {
        source_path: 'first_name',
        target_path: 'user.name.first',
        transformation: 'direct_map',
        required: true
      },
      {
        source_path: 'last_name',
        target_path: 'user.name.last',
        transformation: 'direct_map',
        required: true
      },
      {
        source_path: 'email_address',
        target_path: 'user.contact.email',
        transformation: 'lowercase',
        required: true
      },
      {
        source_path: 'phone',
        target_path: 'user.contact.phone',
        transformation: 'direct_map',
        required: false
      },
      {
        source_path: 'date_of_birth',
        target_path: 'user.profile.birthDate',
        transformation: 'format_date',
        required: false
      },
      {
        source_path: 'address.street',
        target_path: 'user.address.street',
        transformation: 'direct_map',
        required: false
      },
      {
        source_path: 'address.city',
        target_path: 'user.address.city',
        transformation: 'direct_map',
        required: false
      }
    ]
  },
  validation_mode: 'strict',
  include_source: false
};

const response = await userNormalizer.process(userPayload);

if (response.status === 'success') {
  console.log('Normalized Data:', response.decision_event?.outputs.normalized_data);
  console.log('Quality Score:', response.decision_event?.outputs.quality_score);
  console.log('Mapping Stats:', response.decision_event?.outputs.mapping_stats);
}

/*
Expected Output:
{
  user: {
    name: {
      first: 'John',
      last: 'Doe'
    },
    contact: {
      email: 'john.doe@example.com',  // Lowercased
      phone: '555-123-4567'
    },
    profile: {
      birthDate: '1990-05-15T00:00:00.000Z'  // ISO formatted
    },
    address: {
      street: '123 Main St',
      city: 'New York'
    }
  }
}
*/
```

### CSV to JSON Normalization with Transformations

```typescript
const csvNormalizer = createDataNormalizerAgent({
  connector_scope: 'csv-normalization',
  allowed_source_formats: ['csv', 'json'],
  default_validation_mode: 'lenient',
  enable_quality_scoring: true,
  timeout_ms: 20000
});

await csvNormalizer.initialize();

const csvPayload = {
  source_format: 'json' as const,  // CSV already parsed to JSON
  source_data: {
    'Product Name': 'Widget Pro',
    'SKU': 'WID-001',
    'Price (USD)': '49.99',
    'In Stock': 'yes',
    'Category': 'electronics',
    'Tags': 'gadget,tech,popular'
  },
  schema_mapping: {
    mapping_id: 'product-csv-to-canonical',
    source_schema: 'product-csv-v1',
    target_schema: 'canonical-product-v1',
    version: '2.0.0',
    field_mappings: [
      {
        source_path: 'Product Name',
        target_path: 'product.name',
        transformation: 'trim',
        required: true
      },
      {
        source_path: 'SKU',
        target_path: 'product.sku',
        transformation: 'uppercase',
        required: true
      },
      {
        source_path: 'Price (USD)',
        target_path: 'product.price.amount',
        transformation: 'format_number',
        required: true
      },
      {
        source_path: 'Category',
        target_path: 'product.category',
        transformation: 'lowercase',
        required: true
      },
      {
        source_path: 'Tags',
        target_path: 'product.tags',
        transformation: 'split',
        params: { separator: ',' },
        required: false
      }
    ]
  },
  validation_mode: 'lenient'
};

const csvResponse = await csvNormalizer.process(csvPayload);

/*
Expected Output:
{
  product: {
    name: 'Widget Pro',
    sku: 'WID-001',
    price: {
      amount: 49.99
    },
    category: 'electronics',
    tags: ['gadget', 'tech', 'popular']
  }
}
*/
```

---

## Error Handling Examples

### Handling Validation Errors

```typescript
const response = await agent.process(invalidInput);

if (response.status === 'validation_failed') {
  console.error('Validation Failed:', response.error?.message);
  console.error('Error Code:', response.error?.code);

  if (response.error?.retryable) {
    // Retry with corrected input
  } else {
    // Log permanent failure
  }
}
```

### Handling Authentication Errors

```typescript
const authResponse = await webhookAgent.process(webhookRequest);

if (authResponse.status === 'auth_failed') {
  console.error('Authentication Failed:', authResponse.error?.message);
  // Log security event, possibly block IP
}
```

### Handling Timeout Errors

```typescript
const response = await agent.process(largePayload);

if (response.status === 'timeout') {
  console.error('Processing Timeout:', response.error?.message);
  // Consider increasing timeout or splitting payload
}
```

---

## Best Practices

1. **Always Initialize**: Call `await agent.initialize()` before processing
2. **Error Handling**: Check `response.status` before accessing `decision_event`
3. **Logging**: Use structured logging with agent telemetry data
4. **Security**: Never log credentials or sensitive data
5. **Monitoring**: Track confidence scores for quality assessment
6. **Idempotency**: Use `inputs_hash` for deduplication
7. **Cleanup**: Call `await agent.shutdown()` on application shutdown

---

## Complete Example: Multi-Agent Pipeline

```typescript
import {
  createWebhookIngestAgent,
  createAuthIdentityAgent,
  createDataNormalizerAgent,
  createERPSurfaceAgent
} from '@llm-dev-ops/connector-hub-agents';

// Initialize all agents
const webhookAgent = createWebhookIngestAgent({ /* config */ });
const authAgent = createAuthIdentityAgent({ /* config */ });
const normalizerAgent = createDataNormalizerAgent({ /* config */ });
const erpAgent = createERPSurfaceAgent({ /* config */ });

await Promise.all([
  webhookAgent.initialize(),
  authAgent.initialize(),
  normalizerAgent.initialize(),
  erpAgent.initialize()
]);

// Process incoming webhook
const webhookResponse = await webhookAgent.process(incomingWebhook);

if (webhookResponse.status === 'success') {
  // Verify identity
  const authResponse = await authAgent.process({
    auth_method: 'jwt',
    credentials: { token: extractToken(incomingWebhook) }
  });

  if (authResponse.status === 'success' && authResponse.decision_event?.outputs.verified) {
    // Normalize data
    const normalizedResponse = await normalizerAgent.process({
      source_format: 'json',
      source_data: webhookResponse.decision_event.outputs.payload,
      schema_mapping: /* ... */
    });

    if (normalizedResponse.status === 'success') {
      // Send to ERP if needed
      const erpResponse = await erpAgent.process({
        erp_system: 'sap',
        event_type: 'purchase_order_created',
        payload: normalizedResponse.decision_event?.outputs.normalized_data
      });

      console.log('Pipeline Complete:', erpResponse.decision_event?.execution_ref);
    }
  }
}

// Cleanup on shutdown
process.on('SIGTERM', async () => {
  await Promise.all([
    webhookAgent.shutdown(),
    authAgent.shutdown(),
    normalizerAgent.shutdown(),
    erpAgent.shutdown()
  ]);
});
```
