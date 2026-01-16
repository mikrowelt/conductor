#!/bin/bash

# Conductor Setup Script
# This script helps set up a local development environment

set -e

echo "🎼 Conductor Setup"
echo "=================="

# Check prerequisites
check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "❌ $1 is not installed. Please install it first."
        exit 1
    fi
    echo "✅ $1 found"
}

echo ""
echo "Checking prerequisites..."
check_command node
check_command pnpm
check_command docker
check_command docker-compose

# Check Node version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "❌ Node.js 20+ is required. Current version: $(node -v)"
    exit 1
fi
echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo ""
echo "Installing dependencies..."
pnpm install

# Create secrets directory
echo ""
echo "Creating secrets directory..."
mkdir -p secrets

# Check for environment file
if [ ! -f .env ]; then
    echo ""
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "⚠️  Please edit .env with your credentials"
fi

# Check for GitHub App private key
if [ ! -f secrets/github-app.pem ]; then
    echo ""
    echo "⚠️  GitHub App private key not found at secrets/github-app.pem"
    echo "   Please download it from your GitHub App settings"
fi

# Start Docker services
echo ""
echo "Starting Docker services (PostgreSQL and Redis)..."
pnpm docker:dev

# Wait for services to be ready
echo ""
echo "Waiting for services to be ready..."
sleep 5

# Run database migrations
echo ""
echo "Running database migrations..."
pnpm db:migrate || echo "⚠️  Migration failed - database may already be set up"

# Build packages
echo ""
echo "Building packages..."
pnpm build

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env with your GitHub App and Anthropic credentials"
echo "2. Add your GitHub App private key to secrets/github-app.pem"
echo "3. Run 'pnpm --filter @conductor/webhook-server dev' to start the webhook server"
echo "4. Run 'pnpm --filter @conductor/worker dev' to start the worker"
echo ""
echo "For local development, set up a Smee.io channel:"
echo "1. Go to https://smee.io/new"
echo "2. Copy the URL to WEBHOOK_PROXY_URL in .env"
echo "3. Set the same URL as your GitHub App webhook URL"
