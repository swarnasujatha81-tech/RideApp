import { getApp, getApps, initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyDPcG1HOj5c4_HSgapAjzAu5tXPMHXekTg',
  authDomain: 'share-it-9a030.firebaseapp.com',
  projectId: 'share-it-9a030',
  storageBucket: 'share-it-9a030.firebasestorage.app',
  messagingSenderId: '100914160826',
  appId: '1:100914160826:web:e1ab817586378e67e9ce83',
  measurementId: 'G-6FFJRK004F',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db = getFirestore(app);