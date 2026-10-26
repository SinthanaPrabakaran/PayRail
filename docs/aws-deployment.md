# PayRail Production Architecture & AWS ECS Fargate Deployment Guide

This document defines the production infrastructure topology, migration strategy, security guardrails, rollback procedures, and step-by-step deployment guide for **PayRail**.

---

## 1. Production Topology & Managed Infrastructure

While local staging utilizes Docker Compose (`docker-compose.prod.yml`), **production financial workloads must run on dedicated, highly available, managed cloud infrastructure** with strong isolation, encryption, and automated disaster recovery:

```
                      +-----------------------------------------+
                      |         Internet Clients                |
                      +-----------------------------------------+
                                           |  HTTPS (TLS 1.3)
                                           v
                      +-----------------------------------------+
                      |     AWS Application Load Balancer       |
                      |     (Health Checks: /health, /ready)    |
                      +-----------------------------------------+
                                           |
                               +-----------+-----------+
                               | Private Subnet (VPC)  |
                               v                       v
                      +-----------------+     +-----------------+
                      | ECS Fargate #1  |     | ECS Fargate #2  |
                      | (Non-root Node) |     | (Non-root Node) |
                      +-----------------+     +-----------------+
                               |                       |
               +---------------+-----------+-----------+---------------+
               |                           |                           |
               v                           v                           v
+-------------------------------+  +-------------------+  +-----------------------------+
|        MongoDB Atlas          |  |  AWS ElastiCache  |  |      Amazon MQ / CloudAMQP  |
|  (Multi-AZ 3-Node Replica Set)|  |  (Redis Cluster)  |  |     (RabbitMQ Quorum Cluster)
|  - SCRAM-SHA-256 Auth         |  |  - In-Transit TLS |  |  - TLS AMQPS                |
|  - TLS 1.3 Encrypted Wire     |  |  - Auth Token     |  |  - Persistent Disk Volumes  |
|  - Automated Point-in-Time    |  |  - Multi-AZ Auto- |  |  - Dead Letter Queue Alarms |
|    Snapshots (PITR)           |  |    Failover       |  |  - Consumer Prefetch Tuned  |
|  - AWS PrivateLink Peering    |  |  - VPC Isolation  |  |  - VPC Peering              |
+-------------------------------+  +-------------------+  +-----------------------------+
```

### Managed Services Matrix

| Component | Recommended Managed Service | Security & Production Requirements |
| :--- | :--- | :--- |
| **Compute** | **AWS ECS Fargate** | Multi-AZ tasks, read-only root filesystem where feasible, IAM execution roles, zero SSH access. |
| **Database** | **MongoDB Atlas (M10+)** | 3-node replica set (`rs0`), SCRAM-SHA-256 authentication, TLS 1.3, continuous backups (PITR), AWS PrivateLink. |
| **Cache & Limiter** | **AWS ElastiCache (Redis)** | Redis 7.2+, Multi-AZ with Auto-Failover, in-transit encryption (TLS), at-rest encryption, auth token. |
| **Message Broker** | **Amazon MQ (RabbitMQ)** | Multi-AZ active/standby or 3-node cluster, TLS AMQPS, quorum durable queues, cloudwatch disk alarms. |
| **Secrets Management** | **AWS Secrets Manager** | Encrypted using AWS KMS CMK, dynamic secret injection into ECS task definition environment. |
| **Monitoring** | **Amazon CloudWatch** | Centralized structured logs (`/ecs/payrail-api`), latency alarms (p95 > 250ms), HTTP 5xx error alarms, dead-letter queue metrics. |

---

## 2. Secrets & Environment Configuration

### Zero-Secret Guarantee
- **Never bake secrets into container images**: Docker image layers are auditable by anyone with pull access.
- PayRail enforces runtime validation through Zod in `src/config/env.ts`. Missing or invalid configuration halts startup immediately with a clear diagnostics message.

### Secrets Configuration via AWS Secrets Manager & Parameter Store
Map secrets in AWS Systems Manager (SSM) Parameter Store or AWS Secrets Manager and inject them directly into the ECS task definition:

```json
{
  "containerDefinitions": [
    {
      "name": "payrail-api",
      "image": "<AWS_ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/payrail-api:latest",
      "secrets": [
        { "name": "MONGODB_URI", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:payrail/prod/mongodb-uri" },
        { "name": "REDIS_PASSWORD", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:payrail/prod/redis-pass" },
        { "name": "RABBITMQ_URL", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:payrail/prod/rabbitmq-url" },
        { "name": "JWT_SECRET", "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:payrail/prod/jwt-secret" }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" },
        { "name": "LOG_LEVEL", "value": "info" },
        { "name": "REDIS_HOST", "value": "payrail-redis.internal.vpc" },
        { "name": "REDIS_PORT", "value": "6379" }
      ]
    }
  ]
}
```

---

## 3. Migration, Startup & Health Check Strategy

### Startup Sequence (`src/index.ts`)
1. **Zod Validation**: Validates all runtime environment variables on process entry.
2. **Backing Infrastructure Handshake (`database.initializeAll`)**:
   - MongoDB connection initiated with retry backoff.
   - Transaction verification probe executes a throwaway 2-phase ACID transaction to verify replica set health (`database.verifyMongoTransactions`).
   - Redis connection pool initializes and tests ping authentication.
   - RabbitMQ connection asserts durable exchanges and queues.
3. **HTTP Server Listen**: Only after backing dependencies verify readiness does the HTTP server bind to the port.

### Health Check Probes
- **Liveness (`GET /health`)**:
  - Lightweight process ping returning HTTP 200.
  - Used by Docker runtime container healthcheck (`node dist/healthcheck.js`) to restart frozen processes.
- **Deep Readiness (`GET /ready`)**:
  - Probes MongoDB connection, Redis ping, and RabbitMQ channel availability.
  - Returns HTTP 200 `{ status: "ready", dependencies: { mongodb: "connected", redis: "connected", rabbitmq: "connected" } }`.
  - Returns HTTP 503 if any critical backing service is unavailable.
  - Configured on AWS Application Load Balancer target group to remove unhealthy container instances from traffic routing during outages or cold boots.

---

## 4. Automated CI/CD Pipeline (GitHub Actions & OIDC)

PayRail utilizes GitHub Actions with **OpenID Connect (OIDC)** to securely assume an AWS IAM role without storing permanent, long-lived AWS access keys in GitHub Secrets.

### IAM Least-Privilege Trust Policy
Configure an IAM role (`PayRailGitHubDeployRole`) with the following trust policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/PayRail:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

### GitHub Secrets Required
- `AWS_ROLE_TO_ASSUME`: ARN of the IAM role configured above (e.g. `arn:aws:iam::123456789012:role/PayRailGitHubDeployRole`).

### GitHub Variables Required
- `AWS_REGION`: Target AWS region (e.g. `us-east-1`).
- `ECR_REPOSITORY`: Name of ECR repository (e.g. `payrail-api`).
- `ECS_CLUSTER_NAME`: Name of target ECS cluster.
- `ECS_SERVICE_NAME`: Name of target ECS service.
- `ECS_TASK_FAMILY`: Task definition family name.

---

## 5. Rollback Procedures & Failure Recovery

### Automatic Rollback on Failed Health Checks
1. AWS ECS Fargate utilizes **rolling deployments** with circuit breaker support:
   ```bash
   aws ecs update-service \
     --cluster payrail-cluster \
     --service payrail-api-service \
     --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true}"
   ```
2. If new container tasks fail their `/ready` health checks within the grace period (e.g. 60 seconds), the ECS deployment circuit breaker automatically aborts the rollout and rolls back traffic to the previous known stable task definition.

### Manual Emergency Rollback
To immediately roll back to the previous stable release:
```bash
# 1. Inspect recent task definition revisions
aws ecs list-task-definitions --family-prefix payrail-api --sort DESC

# 2. Update service to point to previous revision (e.g. revision 41)
aws ecs update-service \
  --cluster payrail-cluster \
  --service payrail-api-service \
  --task-definition payrail-api:41 \
  --force-new-deployment
```

---

## 6. Financial Cloud Cost & Resource Warnings

Running high-availability fintech infrastructure incurs steady-state cloud costs. Below is an estimated baseline budget:

| Service | Configuration | Estimated Monthly Cost |
| :--- | :--- | :--- |
| **AWS ECS Fargate** | 2 tasks (0.5 vCPU, 1 GB RAM each) 24/7 in 2 AZs | ~$35 / month |
| **AWS ALB** | 1 Application Load Balancer with TLS cert (ACM free) | ~$22 / month + LCU usage |
| **AWS ElastiCache** | `cache.t4g.micro` (Multi-AZ replication) | ~$26 / month |
| **MongoDB Atlas** | `M10` 3-node replica set with automated backups | ~$60 / month |
| **Amazon MQ (RabbitMQ)** | Single instance `mq.t3.micro` / Cluster | ~$25 - $75 / month |
| **AWS CloudWatch & ECR** | Log ingestion (14-day retention) + ECR storage | ~$5 / month |
| **Total Baseline** | **High-Availability Production Staging** | **~$173 – $223 / month** |

> [!TIP]
> **Cost Optimization**: For development or non-production demonstration, keep the entire stack on local Docker Compose (`docker-compose.prod.yml`) or utilize single-node dev instances with auto-stop schedules to incur $0 in external cloud bills.

---

## 7. Production Deployment Verification Checklist

Before opening PayRail API endpoints to real traffic, verify each checkpoint:

- [ ] **Infrastructure & Network**:
  - [ ] MongoDB replica set verified active with at least 3 nodes across 2+ availability zones.
  - [ ] VPC security groups restrict port 27017, 6379, and 5672 strictly to ECS task security group.
  - [ ] ALB SSL/TLS certificate configured with TLS 1.2 minimum (TLS 1.3 recommended).
- [ ] **Container & Process Security**:
  - [ ] Built image verified running as unprivileged `node` user (`id` != 0).
  - [ ] Zero `.env` files or secret tokens present in image filesystem layers (`.dockerignore` active).
  - [ ] Ephemeral containers handle `SIGTERM` gracefully, completing in-flight transactions within 10s.
- [ ] **Application & Data Correctness**:
  - [ ] `/health` returns 200 within 50ms.
  - [ ] `/ready` returns 200 with all dependencies verified (`mongodb`, `redis`, `rabbitmq`).
  - [ ] Transaction outbox publisher confirmed running and draining queued transfers.
  - [ ] Sliding-window rate limiter confirmed operating atomically in Redis.
- [ ] **Observability**:
  - [ ] CloudWatch alarm configured for HTTP 5xx rate > 1%.
  - [ ] CloudWatch alarm configured for ALB target response time p95 > 250ms.
  - [ ] RabbitMQ Dead Letter Queue (DLQ) depth alarm configured (> 0 messages).
