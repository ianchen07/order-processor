#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="$1"
AWS_ACCOUNT_ID="$2"
AWS_REGION="$3"

STACK_NAME="order-processing-${ENV_NAME}"
ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/cicd-deploy-role"

echo "=== Deploying to ${ENV_NAME} (${AWS_ACCOUNT_ID}) ==="

# Assume role
aws sts get-caller-identity >/dev/null

# Resolve image tag
SHORT_SHA=$(echo "${GITHUB_SHA}" | cut -c1-7)
IMAGE_TAG="${SHORT_SHA}"

# Resolve stack outputs
REPO_URI=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RepoUri'].OutputValue" \
  --output text)

CLUSTER=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" \
  --output text)

SERVICE=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" \
  --output text)

SUBNETS_CSV=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='AppSubnetIds'].OutputValue" \
  --output text)

SG=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='EcsSecurityGroupId'].OutputValue" \
  --output text)

# Login to ECR
aws ecr get-login-password --region "$AWS_REGION" \
| docker login --username AWS --password-stdin \
  "$(echo "$REPO_URI" | cut -d/ -f1)"

# Build & push image
docker build -t "$REPO_URI:$IMAGE_TAG" ./app
docker push "$REPO_URI:$IMAGE_TAG"

# Register latest task definition (desiredCount=0)
pushd infra
npm ci
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  -c env="$ENV_NAME" \
  -c imageTag="$IMAGE_TAG" \
  -c desiredCount=0
popd

# Run DB migration
TASK_DEF=$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query "services[0].taskDefinition" \
  --output text)

SUBNETS_JSON=$(python - <<PY
import json
print(json.dumps("${SUBNETS_CSV}".split(",")))
PY
)

aws ecs run-task \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEF" \
  --network-configuration "awsvpcConfiguration={subnets=$SUBNETS_JSON,securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"AppContainer","command":["npm","run","migrate"]}]}' \
  --count 1

# Roll out ECS service
pushd infra
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  -c env="$ENV_NAME" \
  -c imageTag="$IMAGE_TAG" \
  -c desiredCount=2
popd

echo "=== Deploy to ${ENV_NAME} completed ==="