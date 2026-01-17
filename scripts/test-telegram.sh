#!/bin/bash

# Test Telegram Notification
# Usage: ./test-telegram.sh [bot-token] [chat-id]
#
# If arguments not provided, will use environment variables:
# - TELEGRAM_BOT_TOKEN
# - TELEGRAM_CHAT_ID

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

BOT_TOKEN="${1:-$TELEGRAM_BOT_TOKEN}"
CHAT_ID="${2:-$TELEGRAM_CHAT_ID}"

if [ -z "$BOT_TOKEN" ]; then
    echo -e "${RED}Error: Telegram bot token not provided${NC}"
    echo ""
    echo "Usage: $0 <bot-token> <chat-id>"
    echo "Or set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables"
    echo ""
    echo "To get a bot token:"
    echo "1. Open Telegram and search for @BotFather"
    echo "2. Send /newbot and follow the instructions"
    echo "3. Copy the token provided"
    echo ""
    echo "To get your chat ID:"
    echo "1. Send a message to your new bot"
    echo "2. Visit: https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates"
    echo "3. Look for the 'chat': {'id': YOUR_CHAT_ID} in the response"
    exit 1
fi

if [ -z "$CHAT_ID" ]; then
    echo -e "${RED}Error: Telegram chat ID not provided${NC}"
    exit 1
fi

echo "Testing Telegram notification..."
echo "Bot Token: ${BOT_TOKEN:0:10}..."
echo "Chat ID: $CHAT_ID"
echo ""

# Send test message
RESPONSE=$(curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H "Content-Type: application/json" \
    -d "{
        \"chat_id\": \"$CHAT_ID\",
        \"text\": \"*Conductor Test Notification*\n\nThis is a test message from Conductor.\n\nTimestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)\",
        \"parse_mode\": \"Markdown\"
    }")

# Check response
if echo "$RESPONSE" | grep -q '"ok":true'; then
    echo -e "${GREEN}Success!${NC} Test notification sent to Telegram."
    echo ""
    echo "To configure Conductor with Telegram, add these to your .env file:"
    echo ""
    echo "TELEGRAM_BOT_TOKEN=$BOT_TOKEN"
    echo "TELEGRAM_CHAT_ID=$CHAT_ID"
else
    echo -e "${RED}Failed to send notification${NC}"
    echo "Response: $RESPONSE"
    exit 1
fi
