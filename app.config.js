module.exports = {
  expo: {
    name: 'Share-It',
    slug: 'RideApp',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/shareit-logo.png',
    scheme: 'shareit',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: 'Allow location access to show your position',
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#FFFFFF',
        foregroundImage: './assets/images/shareit-logo.png',
        backgroundImage: './assets/images/android-icon-background.png',
        monochromeImage: './assets/images/android-icon-monochrome.png',
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: 'com.mohan_chowdhary.RideApp',
      permissions: ['ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION'],
      versionCode: 2,
    },
    web: {
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission: 'Allow location access',
        },
      ],
      [
        'expo-splash-screen',
        {
          image: './assets/images/shareit-logo.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#ffffff',
        },
      ],
      'expo-web-browser',
      'expo-font',
      'expo-image',
    ],
    experiments: {
      typedRoutes: true,
      reactCompiler: true,
    },
    extra: {
      openRouteServiceApiKey: process.env.EXPO_PUBLIC_ORS_API_KEY || process.env.ORS_API_KEY || '',
      router: {},
      eas: {
        projectId: 'c011d683-3520-440d-be83-e13064807704',
      },
    },
  },
};
