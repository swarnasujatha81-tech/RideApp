# RideApp Deployment & Testing Guide

## ✅ Setup Complete
Your app is configured and ready for prototype testing with all credentials secured in environment variables.

---

## 🚀 Option 1: Test Immediately (Local Development)

### Quick Start
1. **Windows Users**: Double-click `START_LOCAL_DEV.bat`
2. **Mac/Linux Users**: Run `npm start` from terminal

This starts the Expo development server with your `.env.local` configuration loaded.

### First-Time Setup Requirements
Before running locally, you need one of these:

#### Option A: Android Emulator (Recommended for Windows)
1. Install Android Studio: https://developer.android.com/studio
2. Create a virtual device (Android 13+)
3. Start the emulator
4. Run `npm start`, then press `a`

#### Option B: Physical Android Device
1. Enable USB debugging on your phone
2. Connect via USB to your computer
3. Verify connection: `adb devices`
4. Run `npm start`, then press `a`

#### Option C: iOS Simulator (Mac only)
1. Install Xcode: ~15GB download
2. Run `npm start`, then press `i`

#### Option D: Web Browser (No device needed!)
1. Run `npm start`, then press `w`
2. Browser opens at `localhost:19006`

### What to Test Locally
- ✅ App launches without crashing
- ✅ Firebase authentication works
- ✅ OTP generation/encryption works
- ✅ Tab navigation functions
- ✅ Map displays (if testing on actual device)
- ⚠️ Location features may be limited in emulator/web

---

## ⏳ Option 2: Wait for EAS APK Build

Your build is queued on Expo's servers:
- **Build ID**: `799bb827-9b94-43ff-867d-f86ba15c431f`
- **Status**: In queue (free tier ~40-60 minutes)
- **Check Progress**: https://expo.dev/accounts/mohan_chowdhary/projects/RideApp/builds/799bb827-9b94-43ff-867d-f86ba15c431f

### When Build Completes
1. Download the APK from the link above
2. Install on Android device/emulator:
   ```bash
   adb install downloaded-app.apk
   ```
3. Or if using physical device with USB enabled:
   ```bash
   adb install -r downloaded-app.apk
   ```

---

## 🔄 Making Changes & Rebuilding

### Local Testing Flow
1. Edit code (e.g., `app/(tabs)/index.tsx`)
2. Save file
3. Expo hot-reloads automatically (your app updates in seconds)
4. Test changes immediately

### Building for Distribution
```bash
# Android APK
eas build --platform android --profile preview

# iOS
eas build --platform ios --profile preview

# Both platforms
eas build --platform all --profile preview
```

---

## 🔐 Environment Variables Reference

Your `.env.local` contains:
- Firebase API key, auth domain, project ID, storage, messaging
- OTP encryption secret key

**Important**: `.env.local` is in `.gitignore` and never committed to git.

If you need to add more secrets:
1. Edit `.env.local`
2. Use as `process.env.YOUR_VARIABLE_NAME` in code
3. Prefix with `EXPO_PUBLIC_` for Expo to expose them

---

## ❓ Troubleshooting

### Local Dev: "Cannot find module"
```bash
npm install
npm start
```

### Android Emulator: "No emulator running"
- Open Android Studio → Virtual Device Manager → Run an emulator

### ADB not found
```bash
# Windows: Add to PATH or use full path
C:\Android\Sdk\platform-tools\adb devices

# Or restart Android Studio to auto-add to PATH
```

### Firebase connection fails
- Check `.env.local` has correct Firebase credentials
- Verify Firebase Firestore rules allow read/write
- Ensure Firebase project is active

### Hot reload not working
- Click terminal → press `r` to reload
- Or shake device (real phone) to open menu

### Port 19006 already in use
```bash
npm start -- --port 19007
```

---

## 📋 Testing Checklist

**Before sharing with users:**
- [ ] App launches without crashes
- [ ] Authentication flow works (sign up/login)
- [ ] OTP generation and verification works
- [ ] Ride booking features functional
- [ ] Maps/location display correctly
- [ ] Chat/messaging works (if implemented)
- [ ] Navigation between tabs smooth
- [ ] No console errors in Expo CLI

---

## 📦 Build & Distribution

**For prototype testing** (what you're doing now):
- Use local dev (`npm start`) for quick iteration
- Use `eas build --profile preview` for testing on real devices
- No app store submission needed yet

**For production release** (future):
- Update `version` in `app.json`
- Build with `eas build --profile production`
- Submit to App Store & Play Store
- See `TESTING_GUIDE.md` for full details

---

## 🎯 Next Steps

1. **Now**: Choose Option 1 or 2 above to start testing
2. **During testing**: Note any crashes or broken features
3. **Fix issues**: Edit code → `npm start` hot-reloads changes
4. **Iterate**: Test → fix → test until satisfied
5. **Production**: When ready, move to production build profiles

---

**Questions?** Check [Expo Documentation](https://docs.expo.dev) or [Firebase Documentation](https://firebase.google.com/docs)
