# Order Processing Service (Demo)

This repository contains a **demo order‑processing system** built as part of a technical assessment.  
The focus is on **AWS infrastructure design using CDK**, clean separation of concerns, and a realistic
deployment model for containerised workloads.

---

## Application Overview

The application is a **simple background worker** running on **ECS Fargate**.

### What the app does
- Polls messages from **Amazon SQS**
- Processes each message and persists data to **PostgreSQL (Amazon RDS)**
- Exposes a lightweight **`/health` HTTP endpoint** for load balancer health checks

### Design principles
- **Stateless worker**: no local state, safe to scale horizontally
- **Decoupled ingestion**: SQS buffers load and isolates the worker from traffic spikes
- **Fail‑safe startup**: health endpoint is independent from database or queue readiness
- **Migration-friendly**: database migrations are executed via one‑off ECS tasks using the same image

> For bootstrapping and infrastructure stability, the worker can temporarily run in a “dummy” mode
> (health endpoint only) during initial stack creation.

---

## Infrastructure Overview (AWS CDK)

Infrastructure is defined using **AWS CDK v2 (TypeScript)** and synthesised into CloudFormation.

### High-level architecture
- **VPC (Multi‑AZ)**
  - Public subnets: Application Load Balancer
  - Private subnets: ECS Fargate tasks
  - Isolated subnets: RDS PostgreSQL
- **ECS Fargate**
  - Runs the worker service
  - Integrated with ALB for health checks
- **RDS PostgreSQL**
  - Private, non‑publicly accessible
  - Credentials managed via Secrets Manager
- **SQS**
  - Main queue + Dead Letter Queue (DLQ)

---

## Infrastructure Modularisation

The CDK codebase is intentionally **module‑oriented**, using custom constructs to encapsulate concerns.

```
infra/lib/
├── constructs/
│   ├── network.ts     # VPC, subnets, NAT gateways
│   ├── messaging.ts   # SQS queue + DLQ
│   ├── database.ts    # RDS instance, DB security group, secrets
│   └── compute.ts     # ECS cluster, service, task definition, ALB
├── stack.ts           # Composes all constructs
└── bin/app.ts         # Entry point, environment selection
```

### Key CDK best practices applied

- **Single responsibility constructs**
  - Each construct manages one logical layer (network, compute, database, messaging)
- **Explicit dependency wiring**
  - Constructs communicate via typed inputs (e.g. VPC, Security Groups, Secrets)
- **No hardcoded environment names**
  - Environment selection via CDK context (`-c env=dev`)
- **Least privilege IAM**
  - ECS task role granted only required permissions (SQS consume, Secrets read)
- **Security by default**
  - Private subnets for workloads
  - Security groups scoped to exact traffic paths
- **Minimal outputs**
  - Only operationally required values (e.g. cluster name, service name) are exported

---

## CI/CD Model (Summary)

- **Infrastructure**
  - Deployed via CDK (`cdk synth` on PR, `cdk deploy` on main)
- **Application**
  - Docker image built and pushed to ECR
  - ECS service updated via new task definition revisions
  - Database migrations executed as one‑off ECS tasks before rollout

See **`CICD.md`** for details.

---

## Notes

- This is a **demo / assessment implementation**
- Autoscaling, alarms, and cross‑region DR are intentionally simplified
- The design prioritises clarity, safety, and explainability over feature completeness

---

## Requirements

- Node.js 18+
- AWS CDK v2
- Docker (with buildx)
- AWS credentials with appropriate permissions

---

## Quick Start (Dev)

```bash
cd infra
npm install
npx cdk deploy -c env=dev
```

Application builds and deployments are handled via GitHub Actions.

---

## License

Internal demo only.
