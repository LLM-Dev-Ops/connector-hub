#!/bin/bash
# LLM-Connector-Hub Deployment Script
#
# Usage:
#   ./deploy.sh dev      # Deploy to dev environment
#   ./deploy.sh staging  # Deploy to staging environment
#   ./deploy.sh prod     # Deploy to production environment
#
# Prerequisites:
#   - gcloud CLI authenticated
#   - Project set: gcloud config set project agentics-dev
#   - Required APIs enabled
#   - Secrets configured in Secret Manager

set -e

# Configuration
PROJECT_ID="${GOOGLE_CLOUD_PROJECT:-agentics-dev}"
REGION="${GOOGLE_CLOUD_REGION:-us-central1}"
SERVICE_NAME="llm-connector-hub"
ENV="${1:-dev}"

# Validate environment
if [[ ! "$ENV" =~ ^(dev|staging|prod)$ ]]; then
    echo "Error: Invalid environment. Use: dev, staging, or prod"
    exit 1
fi

echo "=============================================="
echo "LLM-Connector-Hub Deployment"
echo "=============================================="
echo "Project:     $PROJECT_ID"
echo "Region:      $REGION"
echo "Service:     $SERVICE_NAME"
echo "Environment: $ENV"
echo "=============================================="

# Step 1: Ensure required APIs are enabled
echo "[1/6] Enabling required APIs..."
gcloud services enable \
    cloudbuild.googleapis.com \
    run.googleapis.com \
    secretmanager.googleapis.com \
    containerregistry.googleapis.com \
    --project="$PROJECT_ID" \
    --quiet

# Step 2: Create service account if not exists
SA_NAME="${SERVICE_NAME}-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

echo "[2/6] Setting up service account..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" &>/dev/null; then
    gcloud iam service-accounts create "$SA_NAME" \
        --display-name="LLM Connector Hub Service Account" \
        --project="$PROJECT_ID"

    # Grant minimal required permissions
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="roles/secretmanager.secretAccessor" \
        --quiet

    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA_EMAIL" \
        --role="roles/run.invoker" \
        --quiet

    echo "Service account created: $SA_EMAIL"
else
    echo "Service account exists: $SA_EMAIL"
fi

# Step 3: Build container image
IMAGE_TAG="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${ENV}-$(date +%Y%m%d%H%M%S)"
IMAGE_LATEST="gcr.io/${PROJECT_ID}/${SERVICE_NAME}:${ENV}-latest"

echo "[3/6] Building container image..."
cd "$(dirname "$0")/../../../"  # Go to repo root
docker build \
    -t "$IMAGE_TAG" \
    -t "$IMAGE_LATEST" \
    -f packages/agents/Dockerfile \
    .

# Step 4: Push to Container Registry
echo "[4/6] Pushing to Container Registry..."
docker push "$IMAGE_TAG"
docker push "$IMAGE_LATEST"

# Step 5: Deploy to Cloud Run
echo "[5/6] Deploying to Cloud Run..."

# Get secrets URLs (create if not exist)
ensure_secret() {
    local secret_name=$1
    local default_value=$2

    if ! gcloud secrets describe "$secret_name" --project="$PROJECT_ID" &>/dev/null; then
        echo "Creating secret: $secret_name"
        echo -n "$default_value" | gcloud secrets create "$secret_name" \
            --data-file=- \
            --project="$PROJECT_ID" \
            --replication-policy="automatic"
    fi
}

ensure_secret "ruvector-service-url" "https://ruvector-service-placeholder.run.app"
ensure_secret "ruvector-api-key" "placeholder-key"
ensure_secret "telemetry-endpoint" "https://llm-observatory-placeholder.run.app"

gcloud run deploy "$SERVICE_NAME" \
    --image="$IMAGE_TAG" \
    --region="$REGION" \
    --platform=managed \
    --allow-unauthenticated \
    --memory=512Mi \
    --cpu=1 \
    --min-instances=0 \
    --max-instances=10 \
    --timeout=60s \
    --concurrency=80 \
    --service-account="$SA_EMAIL" \
    --set-env-vars="SERVICE_NAME=$SERVICE_NAME,SERVICE_VERSION=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown'),PLATFORM_ENV=$ENV,TELEMETRY_ENABLED=true,DEBUG=false" \
    --set-secrets="RUVECTOR_SERVICE_URL=ruvector-service-url:latest,RUVECTOR_API_KEY=ruvector-api-key:latest,TELEMETRY_ENDPOINT=telemetry-endpoint:latest" \
    --project="$PROJECT_ID" \
    --quiet

# Step 6: Verify deployment
echo "[6/6] Verifying deployment..."
SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
    --region="$REGION" \
    --project="$PROJECT_ID" \
    --format='value(status.url)')

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo "Service URL: $SERVICE_URL"
echo ""

# Health check
echo "Running health check..."
HEALTH_RESPONSE=$(curl -s "$SERVICE_URL/health")
echo "Health: $HEALTH_RESPONSE"

echo ""
echo "Available Endpoints:"
echo "  POST $SERVICE_URL/erp-surface"
echo "  POST $SERVICE_URL/database-query"
echo "  POST $SERVICE_URL/webhook-ingest"
echo "  POST $SERVICE_URL/event-normalize"
echo "  POST $SERVICE_URL/auth-identity"
echo "  GET  $SERVICE_URL/health"
echo "  GET  $SERVICE_URL/ready"
echo ""
echo "CLI Commands:"
echo "  connector-hub-agent ingest -c config.json < payload.json"
echo "  connector-hub-agent connect --endpoint $SERVICE_URL"
echo "  connector-hub-agent normalize < payload.json"
echo "  erp-surface ingest --erp-system sap --event-type purchase_order_created --payload '{}' --tenant-id tenant-123"
echo ""
