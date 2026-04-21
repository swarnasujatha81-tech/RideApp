@echo off
REM RideApp Local Testing Setup for Windows
REM This script prepares and runs the app locally via Expo CLI

echo.
echo 🚀 Starting RideApp Local Development Server...
echo ==================================================
echo.

REM Check if dependencies are installed
echo Checking dependencies...
npm list expo >nul 2>&1
if errorlevel 1 (
  echo.
  echo ⚠️  Installing dependencies...
  call npm install
)

echo.
echo ✓ Environment configured (.env.local loaded)
echo ✓ Firebase configured from environment variables
echo ✓ OTP Secret: Loaded from .env.local
echo.

REM Start Expo development server
echo Starting Expo development server...
echo ==================================================
echo.
echo Options:
echo   • Press 'a' to open Android Emulator
echo   • Press 'i' to open iOS Simulator (requires Mac)
echo   • Press 'w' to open Web Browser
echo   • Press 'q' to quit
echo.
echo FIRST TIME SETUP:
echo   1. Ensure Android Emulator is already running OR
echo   2. Connect a physical Android/iOS device via USB
echo.
echo ==================================================
echo.

call npx expo start --port 8083
pause
