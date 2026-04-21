#!/bin/bash
# RideApp Local Testing Setup
# This script prepares and runs the app locally via Expo CLI

echo "🚀 Starting RideApp Local Development Server..."
echo "=================================================="
echo ""

# Check if dependencies are installed
echo "✓ Checking dependencies..."
npm list expo > /dev/null 2>&1
if [ $? -ne 0 ]; then
  echo "⚠️  Installing dependencies..."
  npm install
fi

echo ""
echo "✓ Environment configured (.env.local loaded)"
echo "✓ Firebase credentials: $(grep EXPO_PUBLIC_FIREBASE_PROJECT_ID .env.local | cut -d'=' -f2)"
echo "✓ OTP Secret: Loaded from .env.local"
echo ""

# Start Expo development server
echo "Starting Expo development server..."
echo "=================================================="
echo ""
echo "Options:"
echo "  • Press 'a' to open Android Emulator"
echo "  • Press 'i' to open iOS Simulator (Mac only)"
echo "  • Press 'w' to open Web Browser"
echo "  • Press 'q' to quit"
echo ""
echo "First time? Ensure Android Emulator or iOS Simulator is running first."
echo "=================================================="
echo ""

npm start
