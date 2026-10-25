# PayRail Asynchronous Message & Dead-Letter Queue (DLQ) Operational Guide 📬☠️

This guide outlines the enterprise asynchronous messaging architecture implemented in **Phase 7** using RabbitMQ, MongoDB Transactional Outbox, Publisher Confirmations, and Dead-Letter Exchanges (DLX).

---

## 1. Architecture Overview

### Topology Diagram
```
[ Producer / HTTP API ]
       │
       ▼ (Atomic Transaction Session)
[ MongoDB Collections + Outbox Collection ]
       │
       ▼ (Post-Commit / Background Processor)
[ ConfirmChannel (Publisher Confirms + Persistent Delivery) ]
       │
       ▼
[ Direct Exchange: payrail.direct ]
  ├── RoutingKey: notification.dispatch ──> [ Queue: payrail.notifications ] (prefetch: 5)
  │                                                  │
  │                                                  ▼ (Failure after maxRetries / Poison)
  │                                            [ DLX: payrail.dlx ]
  │                                                  │
  │                                                  ▼ RoutingKey: dead_letter
  │                                            [ Queue: payrail.dead_letter ]
  │
  └── RoutingKey: statement.generate   ──> [ Queue: payrail.statements ] (prefetch: 2)
                                                     │
                                                     ▼ (Failure after maxRetries / Poison)
                                               [ DLX: payrail.dlx ]
                                                     │
                                                     ▼
                                               [ Queue: payrail.dead_letter ]
```

---

## 2. Key Reliability Guarantees

1. **Transactional Outbox (`src/modules/outbox/outbox.service.ts`)**:
   - Financial mutations (e.g. transfers) and notification messages persist in MongoDB inside the **same atomic session transaction**.
   - If the RabbitMQ broker is unreachable during transfer execution, the transfer commits safely and the notification message remains in MongoDB Outbox (`status: 'PENDING'`).
   - The outbox processor uses exponential backoff (`2^retryCount` seconds) and publisher confirmations to deliver messages when the broker recovers.

2. **Publisher Confirmations (`ConfirmChannel`)**:
   - Uses `ConfirmChannel.publish` which resolves only after the RabbitMQ broker safely writes messages to disk (`persistent: true`).

3. **Manual Acknowledgement & Consumer Prefetch**:
   - Consumers use `noAck: false`. Messages are acknowledged (`channel.ack(msg)`) **strictly after** the worker successfully executes business logic and updates `ProcessedJobModel`.
   - `prefetch: 5` (notifications) and `prefetch: 2` (statements) prevent consumer resource starvation and buffer bloat.

4. **Idempotent Consumers**:
   - Every message contains a unique `eventId` or `jobId`.
   - Before executing side-effects, workers check `ProcessedJobModel.findOne({ jobId })`. Repeated deliveries are safely acknowledged without duplicate email/SMS dispatch or repeated statement creation.

5. **Poison Messages & Bounded Retries**:
   - Deserialization failures (non-JSON) or Zod schema validation errors are classified as **poison messages** and rejected immediately (`channel.nack(msg, false, false)`), routing directly to `payrail.dead_letter`.
   - Transient failures retry up to `maxRetries` (default: 3) with exponential backoff before dead-lettering.

---

## 3. Dead-Letter Inspection & Management

### Inspect Dead-Letter Queue via CLI
To check message count and read dead-lettered messages using RabbitMQ container tools:

```powershell
# 1. Check queue message counts
docker exec payrail-rabbitmq rabbitmqctl list_queues name messages messages_ready messages_unacknowledged

# 2. Inspect up to 5 dead-lettered messages without acknowledging (peeking)
docker exec payrail-rabbitmq rabbitmqadmin get queue=payrail.dead_letter count=5 requeue=true
```

### Inspect Dead-Lettered Jobs in MongoDB
Query the `processedjobs` collection for audit records with status `DEAD_LETTERED`:

```javascript
// Connect via mongosh
use payrail;

// Find all dead-lettered jobs
db.processedjobs.find({ status: "DEAD_LETTERED" }).pretty();

// Output contains:
// - jobId
// - jobType ('NOTIFICATION' | 'STATEMENT')
// - attempts
// - outputSummary with last error message
// - processedAt timestamp
```

---

## 4. Replay Dead-Lettered Messages

When the underlying bug, external dependency, or network partition is resolved, replay messages from `payrail.dead_letter` back to their primary queues:

### Using RabbitMQ Shovel Plugin (Recommended for Production)
```bash
# Enable shovel plugin if not already enabled
docker exec payrail-rabbitmq rabbitmq-plugins enable rabbitmq_shovel rabbitmq_shovel_management

# Create dynamic shovel to move messages from DLQ to notifications queue
docker exec payrail-rabbitmq rabbitmqctl set_parameter shovel replay-dlq \
  '{"src-uri": "amqp://", "src-queue": "payrail.dead_letter", "dest-uri": "amqp://", "dest-queue": "payrail.notifications", "delete-after": "queue-length"}'
```

### Manual Replay Script
You can also inspect and re-publish dead-lettered messages using PayRail's `QueueManager.publishWithConfirm`:
```typescript
import { QueueManager, EXCHANGES, ROUTING_KEYS } from './src/queues/queue.manager.js';

// Re-publish with attempt count reset
await QueueManager.publishWithConfirm(
  EXCHANGES.PAYRAIL_DIRECT,
  ROUTING_KEYS.NOTIFICATION,
  originalMessagePayload,
  { 'x-attempt-count': 1 }
);
```

---

## 5. Graceful Worker Shutdown
All workers implement `stop()`:
- Cancels the active consumer tag (`channel.cancel(consumerTag)`), stopping new message ingestion.
- Completes in-flight job processing.
- Cleanly closes AMQP channel and connection during application termination (`SIGINT` / `SIGTERM`).
