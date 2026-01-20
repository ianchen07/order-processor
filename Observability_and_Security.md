# Observability & Security Plan

This document outlines the monitoring, logging, and key security considerations for the AWS-based order processing service (ALB + ECS Fargate + RDS + SQS).

---

## Observability

### Application Load Balancer (ALB)
- **Metrics (CloudWatch)**
  - Request count, latency, HTTP 4xx/5xx error rates
  - Target group healthy/unhealthy host count
- **Health checks**
  - `/health` endpoint used by target group
- **Logs**
  - ALB access logs (optional, to S3)

---

### ECS Fargate (Application)
- **Metrics (CloudWatch)**
  - CPU and memory utilization per service
  - Running vs desired task count
- **Logs**
  - Container stdout/stderr sent to CloudWatch Logs
- **Events**
  - ECS service events for deployment and task failures

---

### Amazon RDS (PostgreSQL)
- **Metrics (CloudWatch)**
  - CPU utilization, free storage, active connections
  - Read/write latency
- **Logs**
  - PostgreSQL error logs (exportable to CloudWatch Logs)

---

### Amazon SQS
- **Metrics (CloudWatch)**
  - Approximate number of messages visible
  - Age of oldest message
  - DLQ message count

---

## Security Considerations & Mitigations

### Network Security
- ECS tasks and RDS run in **private subnets**
- RDS is **not publicly accessible**
- Security groups enforce least-privilege traffic:
  - Internet → ALB only
  - ALB → ECS only
  - ECS → RDS only

---

### Identity & Access Management
- ECS task roles use **least-privilege IAM policies**
- Permissions limited to required SQS and Secrets Manager actions
- No long-lived credentials; CI/CD uses short-lived role assumption

---

### Secrets Management
- Database credentials stored in **AWS Secrets Manager**
- Secrets injected into ECS tasks at runtime
- No secrets stored in code or container images

---

### Data Protection
- Encryption at rest enabled by default (RDS, SQS, Logs)
- Encryption in transit used for database connections (TLS)

---

## Identified Risks & Gaps

- **No ECS auto scaling configured**
  - Service does not scale based on load or queue depth
- **Limited alerting**
  - Metrics collected but alarms not explicitly defined
- **Single-region deployment**
  - No disaster recovery or cross-region failover
- **Basic health checks**
  - Health endpoint checks liveness only, not dependency readiness
- **No blue-green deployment**
  - Deployments use rolling update strategy without blue-green deployment, increasing risk of service disruption during updates

---

## Summary

The current design applies standard AWS observability and security best practices suitable for a technical assessment. Remaining gaps (autoscaling, alerting, and resilience) are intentional simplifications and would be addressed before production deployment.
