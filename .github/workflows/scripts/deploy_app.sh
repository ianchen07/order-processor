#!/usr/bin/env bash
set -euo pipefail
set -x

ENV_NAME="$1"
AWS_ACCOUNT_ID="$2"
AWS_REGION="$3"

STACK_NAME="order-processing-${ENV_NAME}"
ROLE_ARN="arn:aws:iam::${AWS_ACCOUNT_ID}:role/cicd-deploy-role"

echo "=== Deploying to ${ENV_NAME} (${AWS_ACCOUNT_ID}) ==="

aws sts get-caller-identity

SHORT_SHA="$(echo "${GITHUB_SHA}" | cut -c1-7)"
IMAGE_TAG="${SHORT_SHA}"

echo "Image tag: ${IMAGE_TAG}"

describe_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text
}

REPO_URI="$(describe_output RepoUri)"
CLUSTER="$(describe_output ClusterName)"
SERVICE="$(describe_output ServiceName)"
SUBNETS_CSV="$(describe_output AppSubnetIds)"
SG="$(describe_output EcsSecurityGroupId)"

echo "RepoUri: $REPO_URI"
echo "Cluster: $CLUSTER"
echo "Service: $SERVICE"
echo "Subnets: $SUBNETS_CSV"
echo "SecurityGroup: $SG"

aws ecr get-login-password --region "$AWS_REGION" \
| docker login --username AWS --password-stdin \
  "$(echo "$REPO_URI" | cut -d/ -f1)"

docker build -t "$REPO_URI:$IMAGE_TAG" ./app
docker push "$REPO_URI:$IMAGE_TAG"

pushd infra
npm ci
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  -c env="$ENV_NAME" \
  -c imageTag="$IMAGE_TAG" \
  -c desiredCount=0
popd

TASK_DEF="$(aws ecs describe-services \
  --cluster "$CLUSTER" \
  --services "$SERVICE" \
  --query "services[0].taskDefinition" \
  --output text)"

SUBNETS_JSON="$(python - <<PY
import json
print(json.dumps("${SUBNETS_CSV}".split(",")))
PY
)"

echo "Running DB migration using task definition: $TASK_DEF"

RUN_TASK_OUTPUT="$(aws ecs run-task \
  --cluster "$CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$TASK_DEF" \
  --network-configuration "awsvpcConfiguration={subnets=$SUBNETS_JSON,securityGroups=[$SG],assignPublicIp=DISABLED}" \
  --overrides '{"containerOverrides":[{"name":"AppContainer","command":["npm","run","migrate"]}]}' \
  --count 1)"

TASK_ARN="$(echo "$RUN_TASK_OUTPUT" | jq -r '.tasks[0].taskArn')"

echo "Migration task ARN: $TASK_ARN"

aws ecs wait tasks-stopped \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN"

EXIT_CODE="$(aws ecs describe-tasks \
  --cluster "$CLUSTER" \
  --tasks "$TASK_ARN" \
  --query "tasks[0].containers[0].exitCode" \
  --output text)"

echo "Migration exit code: $EXIT_CODE"

if [ "$EXIT_CODE" != "0" ]; then
  echo "Migration failed, fetching logs..."

  LOG_GROUP="/ecs/order-processing"
  LOG_STREAM="$(aws ecs describe-tasks \
    --cluster "$CLUSTER" \
    --tasks "$TASK_ARN" \
    --query "tasks[0].containers[0].logStreamName" \
    --output text)"

  aws logs get-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name "$LOG_STREAM" \
    --limit 50

  exit 1
fi

echo "Migration succeeded"

pushd infra
npx cdk deploy "$STACK_NAME" \
  --require-approval never \
  -c env="$ENV_NAME" \
  -c imageTag="$IMAGE_TAG" \
  -c desiredCount=2
popd

echo "=== Deploy to ${ENV_NAME} completed ==="
