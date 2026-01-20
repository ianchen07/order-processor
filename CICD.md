# CI/CD Strategy (GitHub Actions) — Flexischools Order Processing Demo

This document describes a pragmatic CI/CD approach for a repository that contains **both application code** (ECS Fargate worker) and **infrastructure code** (AWS CDK / CloudFormation). It is designed to be easy to explain in an interview and is aligned with best practices in small–mid teams.

---

## 1. Repository layout

```
repo/
  app/                 # Node.js worker + migrate entrypoint
  infra/               # AWS CDK (TypeScript) synthesizes CloudFormation stacks
  .github/workflows/   # GitHub Actions pipelines
  CICD.md              # this document
```

**Key principle:** keep infra and app in one repo for the demo, but ensure pipelines only run what’s relevant (path filters).

---

## 2. Environments model (accounts + naming)

**Environment separation is primarily done by AWS accounts**, not by hardcoding env names into the infra code.

- `dev`, `qa`, `staging`, `production` are represented as **separate AWS accounts**.
- Each environment deploy assumes a fixed, environment-specific IAM role:
  - `arn:aws:iam::<ACCOUNT_ID>:role/cicd-deploy-role`

**Stack naming**
- Stack name is environment-instance based, driven by CI context:
  - `order-processing-${ENV}`
- CDK entrypoint (`infra/bin/app.ts`) reads `-c env=${ENV}` to construct the correct stack name.

> In the demo we implement **dev** end-to-end and comment out the other environments. In real deployments, `dev/qa/staging` run in parallel; `production` is gated by manual approval.

---

## 3. Authentication & permissions (no long-lived keys)

Use **GitHub Actions OIDC** with `aws-actions/configure-aws-credentials@v4`.

- No static AWS access keys stored in GitHub.
- Short-lived credentials via role assumption.
- Least-privilege policies for CI roles:
  - CDK deploy permissions (CloudFormation + required services)
  - ECR push/pull
  - ECS update/run-task
  - Read CloudFormation outputs (DescribeStacks)

---

## 4. Secrets management

### 4.1 Where secrets live
- **Database password** is generated and stored in **AWS Secrets Manager** by CDK.
- Other API keys (third-party integrations, internal service tokens, observability ingest keys) should also be stored in **Secrets Manager**.
- ECS task definition injects secrets via `secrets:` (runtime injection), and the **task role** has `secretsmanager:GetSecretValue` only for the required secrets.

### 4.2 What is NOT stored in GitHub
- DB passwords
- API keys
- Any production credentials

GitHub repository secrets are only used for non-sensitive configuration if required (e.g., account IDs) and can often be replaced by org-level variables.

---

## 5. Image versioning & deployment model

### 5.1 Image tags
- Use the **short SHA** as the image tag for traceability:
  - `IMAGE_TAG=${GITHUB_SHA::7}`
- Optionally also push `latest` for developer convenience (not required).

### 5.2 Deployment mechanism (ECS service)
- Deploys are done by updating the ECS service to use a **new task definition revision** referencing the new image tag.
- This is performed by the CI workflow (not by Terraform/CDK changes) and matches common “app redeploy without infra change” practice.

---

## 6. Database migrations (safe, repeatable)

### 6.1 Requirement addressed
The test calls out “handle database migrations safely”. The chosen approach is:

> **Before deploying the new service version**, run migrations as a **one-off ECS task** using the **latest task definition revision**, overriding the container command to `npm run migrate`.

### 6.2 Why this approach
- Uses the **same image** and **same runtime configuration** (VPC, SGs, secrets) as the service.
- No need to run migration tooling from CI runners with network access to the DB.
- Migration can be audited and retried (idempotent migrations).

### 6.3 Mechanism
1. Register or select the newest task definition revision (the one referencing the new image tag).
2. Run one-off migration task:

```bash
aws ecs run-task   --cluster "$CLUSTER"   --launch-type FARGATE   --task-definition "$TASK_DEF"   --network-configuration "awsvpcConfiguration={subnets=$SUBNETS_JSON,securityGroups=[$SG],assignPublicIp=DISABLED}"   --overrides '{"containerOverrides":[{"name":"AppContainer","command":["npm","run","migrate"]}]}'   --count 1
```

3. Wait for the task to stop with exit code 0.
4. Update the ECS service to the new task definition revision.
5. Monitor health checks + logs.

### 6.4 Safety notes
- `migrate.js` is idempotent (e.g., `CREATE TABLE IF NOT EXISTS`).
- For more complex schemas, introduce a migration framework (Prisma/Knex/Flyway) and keep the same one-off task pattern.
- In production, enforce **one migration at a time** (single run-task with locking if needed).

---

## 7. Pipelines overview (GitHub Actions)

We use four workflows in a mono-repo:
1. `app-pr.yml` — validate app changes on PR
2. `app-deploy.yml` — deploy app on merge to `main`
3. `infra-pr.yml` — validate CDK + show diff on PR
4. `infra-deploy.yml` — deploy CDK stack on merge to `main` (with prod approval gate)

Each workflow uses **path filters** so app/infra changes only run the relevant pipelines.

---

## 8. app-pr.yml (Pull Request checks)

**Trigger:** PR opened/updated, paths under `app/**`

**Stages**
- Install dependencies with `npm ci`
- Unit tests (Jest) if present
- Optional integration tests (stubbed/illustrative for demo)
- Build Docker image locally
- Security scan:
  - `trivy image` (or Trivy filesystem scan)
- Do **not** deploy on PR.

---

## 9. app-deploy.yml (Merge to main → deploy dev)

**Trigger:** push to `main`, paths under `app/**`

**High-level steps**
1. **Assume dev deploy role via OIDC**
2. **Resolve infra outputs** from CloudFormation stack (dev):
   - `RepoUri`
   - `ClusterName`
   - `ServiceName`
   - `AppSubnetIds`
   - `EcsSecurityGroupId`
3. Build image and push to ECR with tag `${GITHUB_SHA::7}`
4. Register/update ECS task definition to new image tag (new revision)
5. Run **one-off migration task** with override command `npm run migrate`
6. Update ECS service to the new revision
7. Verify:
   - ALB target group healthy (health checks)
   - ECS service stable
   - CloudWatch logs show expected behavior

**Multi-environment (commented in demo)**
- `qa` and `staging` jobs run in parallel after dev.
- `production` uses GitHub Environment approvals (manual gate).

---

## 10. infra-pr.yml (Pull Request checks for CDK)

**Trigger:** PR, paths under `infra/**`

**Stages**
- `npm ci` in `infra/`
- `npx cdk synth`
- `npx cdk diff -c env=dev` (shows intended changes)

**Note**
- CDK diff does not strictly require contacting AWS; it compares against the last deployed template/synth output.
- An optional enhancement is to create CloudFormation Change Sets for a richer review (requires AWS auth).

---

## 11. infra-deploy.yml (Merge to main → deploy stacks)

**Trigger:** push to `main`, paths under `infra/**`

**Stages (dev)**
1. Assume dev role via OIDC
2. `npm ci` and deploy:
   ```bash
   npx cdk deploy "order-processing-${ENV}" -c env="${ENV}" --require-approval never
   ```

**Production gatekeeper**
- GitHub Environments configured with required reviewers for `production`.
- Only after approval, the prod deploy job assumes the prod role and runs `cdk deploy`.

**Parallelism**
- `dev`, `qa`, `staging` can run in parallel (matrix strategy).
- `production` runs after staging passes and approval is granted.

---

## 12. Rollback strategy

### App rollback
- Revert ECS service to a previous task definition revision:
  - `aws ecs update-service --task-definition <previous-td>`
- Because images are immutable SHA tags, rollback is deterministic.

### Infra rollback
- CloudFormation rolls back failed updates automatically.
- For high-risk changes, prefer change sets and staged rollouts.

---

## 13. Observability hooks in CI/CD

CI/CD should link to or validate:
- ALB target group health (healthy targets after deploy)
- ECS service events (deployment status)
- CloudWatch Logs group for the service
- RDS metrics/alarms (CPU, storage, connections)

For the demo:
- Container logs go to CloudWatch Logs (awslogs driver)
- ALB health check uses `/health`

---

## 14. Summary

This CI/CD design:
- Uses **OIDC** (no long-lived keys)
- Keeps **secrets in Secrets Manager**
- Builds and deploys immutable **ECR images**
- Runs DB migrations safely using a **one-off ECS task** with command overrides
- Separates app deploy and infra deploy workflows with path-based triggers
- Supports multi-environment rollout with parallel non-prod and gated prod

