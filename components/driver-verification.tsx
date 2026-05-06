import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { auth, db, storage } from '../lib/firebase';

type PickType = 'rc' | 'license';

// Helper: pick an image from gallery and return URI or null
export async function pickImageAsync() {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission required', 'Permission to access gallery is required to upload documents.');
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets?.[0]?.uri ?? null;
}

// Helper: upload an image URI to Firebase Storage and return download URL
export async function uploadImage(uri: string, storagePath: string) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.onload = () => resolve(request.response);
    request.onerror = () => reject(new Error('Could not read selected image. Please choose the image again.'));
    request.responseType = 'blob';
    request.open('GET', uri, true);
    request.send(null);
  });

  const ref = storageRef(storage, storagePath);
  try {
    const snapshot = await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
    return await getDownloadURL(snapshot.ref);
  } finally {
    (blob as Blob & { close?: () => void }).close?.();
  }
}

// Helper: save driver record to Firestore
export async function saveDriverRecord(payload: {
  name: string;
  phone: string;
  vehicleNumber: string;
  authUid?: string;
  vehicleType?: string;
  driverPhotoUrl?: string;
  activeDeviceId?: string;
  rcImageUrl: string;
  licenseImageUrl: string;
}) {
  const normalizedPhone = payload.phone.replace(/\D/g, '');
  if (!normalizedPhone) {
    throw new Error('Invalid phone number');
  }

  if (!payload.authUid) {
    throw new Error('Please login again before submitting driver documents.');
  }

  const docRef = doc(db, 'drivers', normalizedPhone);
  const existing = await getDoc(docRef);
  if (existing.exists()) {
    const existingData = existing.data();
    if (existingData?.isVerified) {
      const error = new Error('This number is already verified.');
      (error as Error & { code?: string }).code = 'driver-already-submitted';
      throw error;
    }
  }

  await setDoc(docRef, {
    name: payload.name,
    registeredName: payload.name,
    phone: normalizedPhone,
    registeredPhone: normalizedPhone,
    ...(payload.authUid ? { authUid: payload.authUid, activeAuthUid: payload.authUid } : {}),
    ...(payload.activeDeviceId ? { activeDeviceId: payload.activeDeviceId } : {}),
    vehicleNumber: payload.vehicleNumber,
    ...(payload.vehicleType ? { vehicleType: payload.vehicleType } : {}),
    ...(payload.driverPhotoUrl ? { driverPhotoUrl: payload.driverPhotoUrl } : {}),
    rcImageUrl: payload.rcImageUrl,
    licenseImageUrl: payload.licenseImageUrl,
    isVerified: false,
    verificationStatus: 'pending',
    subscriptionActive: false,
    submittedAt: serverTimestamp(),
    ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
  }, { merge: true });
  return docRef.id;
}

// Start listening to a driver document and call onVerified when isVerified becomes true
export function startDriverVerificationListener(driverId: string, onVerified: () => void) {
  const docRef = doc(db, 'drivers', driverId);
  return onSnapshot(docRef, (snapshot) => {
    const data = snapshot.data();
    if (data && data.isVerified) onVerified();
  });
}

// Example UI component with minimal footprint. Do NOT change your main layout—import and place where needed.
export default function DriverVerificationButtons({
  name,
  phone,
  vehicleNumber,
  authUid,
  vehicleType,
  driverPhotoUrl,
  activeDeviceId,
  onSubmitted,
  onBack,
}: {
  name: string;
  phone: string;
  vehicleNumber: string;
  authUid?: string;
  vehicleType?: string;
  driverPhotoUrl?: string;
  activeDeviceId?: string;
  onSubmitted?: (driverId: string) => void;
  onBack?: () => void;
}) {
  const [rcUri, setRcUri] = useState<string | null>(null);
  const [licenseUri, setLicenseUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [showBack, setShowBack] = useState(true);
  useEffect(() => {
    // Request permission at mount so pick functions work smoothly
    (async () => {
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    })();
  }, []);

  async function pick(type: PickType) {
    const uri = await pickImageAsync();
    if (!uri) return;
    if (type === 'rc') setRcUri(uri);
    else setLicenseUri(uri);
  }

  async function handleUploadAndSave() {
    if (uploading) return;
    if (!rcUri || !licenseUri) {
      Alert.alert('Missing documents', 'Please pick both RC and Driving License images before uploading.');
      return;
    }

    // Use provided driver details
    const exampleName = name;
    const examplePhone = phone.replace(/\D/g, '');
    const exampleVehicleNumber = vehicleNumber;

    try {
      setUploading(true);
      const timestamp = Date.now();
      const ownerUid = authUid || auth.currentUser?.uid;
      if (!ownerUid) {
        throw new Error('Please login again before submitting driver documents.');
      }

      const rcPath = `drivers/${examplePhone}/${ownerUid}/rc_${timestamp}.jpg`;
      const licensePath = `drivers/${examplePhone}/${ownerUid}/license_${timestamp}.jpg`;

      const [rcUrl, licenseUrl] = await Promise.all([
        uploadImage(rcUri, rcPath),
        uploadImage(licenseUri, licensePath),
      ]);

      const driverId = await saveDriverRecord({
        name: exampleName,
        phone: examplePhone,
        vehicleNumber: exampleVehicleNumber,
        authUid: ownerUid,
        vehicleType,
        driverPhotoUrl,
        activeDeviceId,
        rcImageUrl: rcUrl,
        licenseImageUrl: licenseUrl,
      });

      // Persist driver document id so app can listen for verification status
      try {
        await AsyncStorage.setItem('driver_doc_id', driverId);
      } catch (e) {
        console.warn('Failed to persist driver_doc_id', e);
      }

      if (onSubmitted) onSubmitted(driverId);
    } catch (err) {
      console.error(err);
      const message = err instanceof Error && err.message
        ? err.message
        : 'There was a problem uploading documents.';
      Alert.alert('Upload blocked', message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.hero}>
      <View style={styles.heroHeader}>
        {showBack ? (
          <Pressable style={styles.backButton} onPress={() => {
            if (onBack) onBack();
            else setShowBack(false);
          }}>
            <Text style={styles.backButtonText}>← Back</Text>
          </Pressable>
        ) : null}
      </View>
        <Text style={styles.kicker}>Driver verification</Text>
        <Text style={styles.heading}>Upload your documents to go live</Text>
        <Text style={styles.subheading}>
          Submit your RC and driving licence once. We verify your request manually before driver access is enabled.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.summaryCard}>
          <Text style={styles.cardLabel}>Name</Text>
          <Text style={styles.cardValue}>{name}</Text>
          <Text style={[styles.cardLabel, { marginTop: 12 }]}>Phone</Text>
          <Text style={styles.cardValue}>{phone}</Text>
          <Text style={[styles.cardLabel, { marginTop: 12 }]}>Vehicle number</Text>
          <Text style={styles.cardValue}>{vehicleNumber}</Text>
        </View>

        <View style={styles.uploadCard}>
          <Text style={styles.sectionTitle}>Upload documents</Text>

          <Pressable style={styles.documentButton} onPress={() => pick('rc')}>
            <View style={styles.documentButtonTextWrap}>
              <Text style={styles.documentButtonTitle}>{rcUri ? 'RC selected' : 'Choose RC from gallery'}</Text>
              <Text style={styles.documentButtonSubtitle}>Vehicle registration certificate</Text>
            </View>
            <Text style={styles.documentAction}>{rcUri ? 'Replace' : 'Select'}</Text>
          </Pressable>
          {rcUri ? <Image source={{ uri: rcUri }} style={styles.preview} /> : null}

          <Pressable style={[styles.documentButton, { marginTop: 14 }]} onPress={() => pick('license')}>
            <View style={styles.documentButtonTextWrap}>
              <Text style={styles.documentButtonTitle}>{licenseUri ? 'Licence selected' : 'Choose driving licence from gallery'}</Text>
              <Text style={styles.documentButtonSubtitle}>Front side or clearly readable photo</Text>
            </View>
            <Text style={styles.documentAction}>{licenseUri ? 'Replace' : 'Select'}</Text>
          </Pressable>
          {licenseUri ? <Image source={{ uri: licenseUri }} style={styles.preview} /> : null}

          <View style={styles.noticeBox}>
            <Text style={styles.noticeTitle}>Important</Text>
            <Text style={styles.noticeText}>Your OTP verified mobile number and name are saved with these files. Next time, the same number can restore driver access on another mobile.</Text>
          </View>

          <Pressable style={styles.submitButton} onPress={handleUploadAndSave} disabled={uploading}>
            <Text style={styles.submitButtonText}>{uploading ? 'Submitting...' : 'Submit documents'}</Text>
          </Pressable>

          {uploading ? <ActivityIndicator style={styles.indicator} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0B1020' },
  hero: { paddingTop: 56, paddingHorizontal: 24, paddingBottom: 18 },
  heroHeader: { paddingTop: 16, paddingHorizontal: 24, paddingBottom: 10 },
  backButton: { padding: 8, alignSelf: 'flex-start' },
  backButtonText: { color: '#FFFFFF', fontWeight: '700' },
  kicker: { color: '#8BA4FF', fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 },
  heading: { color: '#FFFFFF', fontSize: 30, fontWeight: '800', lineHeight: 36, marginBottom: 10 },
  subheading: { color: '#D4DAF0', fontSize: 14, lineHeight: 20 },
  content: { paddingHorizontal: 24, paddingBottom: 32 },
  summaryCard: { backgroundColor: '#121A33', borderRadius: 24, padding: 18, marginBottom: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  cardLabel: { color: '#8FA0CF', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  cardValue: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', marginTop: 4 },
  uploadCard: { backgroundColor: '#F7F8FC', borderRadius: 24, padding: 18 },
  sectionTitle: { color: '#0B1020', fontSize: 18, fontWeight: '800', marginBottom: 14 },
  documentButton: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#E5E8F2' },
  documentButtonTextWrap: { flex: 1, paddingRight: 12 },
  documentButtonTitle: { color: '#111827', fontSize: 15, fontWeight: '700' },
  documentButtonSubtitle: { color: '#6B7280', fontSize: 12, marginTop: 4 },
  documentAction: { color: '#355CFF', fontSize: 14, fontWeight: '800' },
  preview: { width: '100%', height: 180, borderRadius: 18, marginTop: 10, resizeMode: 'cover', backgroundColor: '#E9EDF7' },
  noticeBox: { marginTop: 16, backgroundColor: '#EEF3FF', borderRadius: 18, padding: 14 },
  noticeTitle: { color: '#1831A9', fontWeight: '800', fontSize: 13, marginBottom: 4 },
  noticeText: { color: '#35478A', fontSize: 13, lineHeight: 18 },
  submitButton: { marginTop: 18, backgroundColor: '#111827', borderRadius: 18, paddingVertical: 16, alignItems: 'center' },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  indicator: { marginTop: 12 },
});
