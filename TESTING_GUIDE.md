# RideApp Prototype Testing Guide

## Setup Complete ✅

Your app is now ready for prototype testing. All hardcoded credentials have been moved to environment variables in `.env.local`.

---

## Testing the Android APK

### Step 1: Wait for Build to Complete
- **Build ID**: `799bb827-9b94-43ff-867d-f86ba15c431f`
- **Check Status**: https://expo.dev/accounts/mohan_chowdhary/projects/RideApp/builds/799bb827-9b94-43ff-867d-f86ba15c431f
- **Estimated Wait**: ~40 minutes (free tier queue)

### Step 2: Download the APK
Once the build completes:
1. Visit the link above
2. Click "Download" to get the APK file
3. Save it to your computer

### Step 3: Install on Android Device or Emulator

**Option A: Android Emulator (Virtual)**
```bash
# First, ensure Android Emulator is running
# Then install the APK:
adb install path/to/downloaded.apk
```

**Option B: Physical Android Device**
```bash
# Connect device via USB and enable USB debugging
# Then install:
adb install path/to/downloaded.apk
```

### Step 4: Test Core Features
Once the app launches, verify:
- ✅ App opens without crashing
- ✅ Firebase authentication flow works
- ✅ OTP generation/encryption works (uses env-based SECRET_KEY)
- ✅ Location permissions are granted
- ✅ Maps display correctly
- ✅ Tab navigation works (Home, Explore, etc.)
- ✅ Chat features work (if implemented)
- ✅ Ride booking/management features work

---

## Testing iOS (Alternative Options)

### Option 1: On a Mac
```bash
npm run ios
# Builds and runs on iOS Simulator automatically
```

### Option 2: Build via EAS for iOS (No Mac Required)
```bash
eas build --platform ios --profile preview
# Creates an IPA for testing on physical iPhone
# Download and install via Xcode or TestFlight on iPhone
```

### Option 3: Build Both Platforms Together
```bash
eas build --platform all --profile preview
# Builds both Android APK and iOS IPA
```

---

## Environment Variables Reference

Your `.env.local` contains:
- `EXPO_PUBLIC_FIREBASE_API_KEY` - Firebase authentication key
- `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` - Firebase auth domain
- `EXPO_PUBLIC_FIREBASE_PROJECT_ID` - Firebase project ID
- `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` - Firebase storage
- `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` - Firebase messaging
- `EXPO_PUBLIC_FIREBASE_APP_ID` - Firebase app ID
- `EXPO_PUBLIC_OTP_SECRET_KEY` - OTP encryption secret (currently: `SHARE_IT_SECURE_2026`)

**Note**: `.env.local` is NOT committed to git (see `.gitignore`)

---

## Troubleshooting

### APK Install Fails
- Ensure ADB is installed: `adb version`
- Ensure device is connected: `adb devices`
- Clear cache: `adb shell pm clear com.rideapp.mobile`
- Reinstall: `adb uninstall com.rideapp.mobile` then `adb install app.apk`

### Firebase Connection Issues
- Verify `.env.local` has correct Firebase credentials
- Check Firebase Firestore rules allow read/write for your test user
- Ensure Firebase project is active and properly configured

### OTP Features Not Working
- Verify `EXPO_PUBLIC_OTP_SECRET_KEY` in `.env.local`
- Check that encryption/decryption functions receive the env-based key

### Location/Maps Not Working
- Grant location permissions when app prompts
- Ensure Android device or emulator has location enabled
- For emulator: Use location spoofing in emulator settings

---

## Next Steps After Testing

1. **Identify Issues**: Note any crashes, broken features, or bugs
2. **Fix & Rebuild**: Make code changes and rebuild via `eas build`
3. **Iterate**: Test again until satisfied
4. **Production Deployment** (when ready):
   - Update version in `app.json`
   - Build with production profile
   - Submit to app stores (if desired)

---

## Build Profiles Available

- **development**: For local testing (fastest)
- **preview**: For TestFlight/Google Play internal testing (current)
- **production**: For app store release (when ready)

---

**Questions?** Check [EAS Build Documentation](https://docs.expo.dev/build/introduction/) or your project's README.md
