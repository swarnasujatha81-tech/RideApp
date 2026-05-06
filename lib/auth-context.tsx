import { PhoneAuthProvider, User, onAuthStateChanged, signInWithCredential } from 'firebase/auth';
import { Timestamp, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { auth, db } from './firebase';

export type AppUser = {
  uid: string;
  phone: string;
  name: string;
  earnWallet: number;
  supportedRideTypes: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
};

type AuthContextValue = {
  user: User | null;
  appUser: AppUser | null;
  initializing: boolean;
  refreshUserData: () => Promise<AppUser | null>;
  completePhoneSignIn: (params: {
    verificationId: string;
    otp: string;
    phone: string;
    name?: string;
  }) => Promise<User>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const normalizePhone = (value?: string | null) => {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
};

async function upsertUserRecord(user: User, phoneOverride?: string, name?: string): Promise<AppUser> {
  const phone = normalizePhone(phoneOverride || user.phoneNumber);
  const userRef = doc(db, 'users', user.uid);
  const existing = await getDoc(userRef);
  const existingData = existing.exists() ? existing.data() : {};
  const resolvedName = name || existingData?.name || '';

  const appUser: AppUser = {
    uid: user.uid,
    phone,
    name: resolvedName,
    earnWallet: Number(existingData?.earnWallet || 0),
    supportedRideTypes: ['Bike', 'Auto', 'Cab', 'ShareAuto', 'Parcel'],
    createdAt: existingData?.createdAt || Timestamp.now(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(userRef, {
    ...appUser,
    phoneNumber: phone ? `+91${phone}` : user.phoneNumber || '',
    authProvider: 'phone',
    lastLoginAt: serverTimestamp(),
  }, { merge: true });

  if (phone) {
    await setDoc(doc(db, 'usersByPhone', phone), {
      uid: user.uid,
      phone,
      phoneNumber: `+91${phone}`,
      name: resolvedName,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  return appUser;
}

async function tryUpsertUserRecord(user: User, phoneOverride?: string, name?: string) {
  try {
    return await upsertUserRecord(user, phoneOverride, name);
  } catch (error) {
    console.error('[auth] signed in, but profile sync failed', error);
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [initializing, setInitializing] = useState(true);

  const refreshUserData = useCallback(async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setAppUser(null);
      return null;
    }

    const nextUser = await upsertUserRecord(currentUser);
    setAppUser(nextUser);
    return nextUser;
  }, []);

  const completePhoneSignIn = useCallback(async ({
    verificationId,
    otp,
    phone,
    name,
  }: {
    verificationId: string;
    otp: string;
    phone: string;
    name?: string;
  }) => {
    const credential = PhoneAuthProvider.credential(verificationId, otp);
    const result = await signInWithCredential(auth, credential);
    const nextUser = await tryUpsertUserRecord(result.user, phone, name);
    setUser(result.user);
    if (nextUser) setAppUser(nextUser);
    return result.user;
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (!active) return;
      setUser(nextUser);

      if (!nextUser) {
        setAppUser(null);
        setInitializing(false);
        return;
      }

      try {
        const nextAppUser = await tryUpsertUserRecord(nextUser);
        if (active && nextAppUser) setAppUser(nextAppUser);
      } catch (error) {
        console.error('[auth] failed to load user profile', error);
        if (active) setAppUser(null);
      } finally {
        if (active) setInitializing(false);
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    appUser,
    initializing,
    refreshUserData,
    completePhoneSignIn,
  }), [appUser, completePhoneSignIn, initializing, refreshUserData, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return context;
}
