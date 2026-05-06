import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, getReactNativePersistence, initializeAuth } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

export const firebaseConfig = {
  apiKey: 'AIzaSyDPcG1HOj5c4_HSgapAjzAu5tXPMHXekTg',
  authDomain: 'share-it-9a030.firebaseapp.com',
  projectId: 'share-it-9a030',
  storageBucket: 'share-it-9a030.firebasestorage.app',
  messagingSenderId: '100914160826',
  appId: '1:100914160826:web:e1ab817586378e67e9ce83',
  measurementId: 'G-6FFJRK004F',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createPersistentAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(app);
  }
}

export const auth = createPersistentAuth();
export const db = getFirestore(app);
export const storage = getStorage(app);
