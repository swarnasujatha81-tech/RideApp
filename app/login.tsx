import { PhoneAuthProvider } from 'firebase/auth';
import React, { useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';

import FirebaseRecaptchaVerifier from '@/components/firebase-recaptcha-verifier';
import { useAuth } from '@/lib/auth-context';
import { auth, firebaseConfig } from '@/lib/firebase';
import { styles } from './(tabs)/ride-home/styles';

export default function LoginScreen() {
  const { completePhoneSignIn } = useAuth();
  const recaptchaVerifier = useRef<any | null>(null);
  const [mobileNumber, setMobileNumber] = useState('');
  const [name, setName] = useState('');
  const [otp, setOtp] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSendOtp = async () => {
    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      Alert.alert('Invalid mobile', 'Enter a valid 10-digit mobile number starting with 6,7,8 or 9.');
      return;
    }

    try {
      setSubmitting(true);
      if (!recaptchaVerifier.current) {
        throw new Error('reCAPTCHA verifier is not ready.');
      }

      const provider = new PhoneAuthProvider(auth);
      const id = await provider.verifyPhoneNumber(`+91${mobileNumber}`, recaptchaVerifier.current);
      setVerificationId(id);
      setVerificationSent(true);
      Alert.alert('OTP sent', 'Please check your SMS for the OTP.');
    } catch (error: any) {
      Alert.alert('OTP failed', error?.message || 'Could not send OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (!verificationId) {
      Alert.alert('No OTP requested', 'Please request an OTP first.');
      return;
    }

    if (!/^\d{6}$/.test(otp)) {
      Alert.alert('Invalid OTP', 'Enter the 6-digit OTP from SMS.');
      return;
    }

    try {
      setSubmitting(true);
      await completePhoneSignIn({
        verificationId,
        otp,
        phone: mobileNumber,
        name: name.trim(),
      });
    } catch (error: any) {
      Alert.alert('Verification failed', error?.message || 'OTP verification failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.loginScreen}>
      <View style={styles.loginHero}>
        <Text style={styles.loginBrandName}>share-it</Text>
        <Text style={styles.loginBrandTagline}>Bike, Auto and Cab rides</Text>
      </View>

      <View style={styles.loginForm}>
        <Text style={styles.loginFormTitle}>Welcome back</Text>
        <Text style={styles.loginFormSubtitle}>Verify your mobile number once to continue booking rides.</Text>

        <View style={styles.loginInputWrap}>
          <Text style={styles.loginLabel}>Mobile number</Text>
          <TextInput
            style={styles.loginInput}
            placeholder="Enter 10-digit number"
            value={mobileNumber}
            onChangeText={(value) => setMobileNumber(value.replace(/\D/g, '').slice(0, 10))}
            editable={!verificationSent && !submitting}
            keyboardType="phone-pad"
            maxLength={10}
            placeholderTextColor="#9CA3AF"
          />
        </View>

        {verificationSent ? (
          <>
            <View style={styles.loginInputWrap}>
              <Text style={styles.loginLabel}>Your name</Text>
              <TextInput
                style={styles.loginInput}
                placeholder="Enter your full name"
                value={name}
                onChangeText={setName}
                editable={!submitting}
                placeholderTextColor="#9CA3AF"
              />
            </View>

            <View style={styles.loginInputWrap}>
              <Text style={styles.loginLabel}>Enter OTP</Text>
              <TextInput
                style={styles.loginInput}
                placeholder="6-digit code from SMS"
                value={otp}
                onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
                editable={!submitting}
                keyboardType="number-pad"
                placeholderTextColor="#9CA3AF"
                maxLength={6}
              />
            </View>

            <Pressable style={styles.loginPrimaryButton} onPress={handleVerifyOtp} disabled={submitting}>
              <Text style={styles.loginPrimaryButtonText}>{submitting ? 'Verifying...' : 'Verify & Continue'}</Text>
            </Pressable>

            <Pressable
              style={styles.loginSecondaryButton}
              disabled={submitting}
              onPress={() => {
                setVerificationSent(false);
                setVerificationId(null);
                setOtp('');
              }}
            >
              <Text style={styles.loginSecondaryButtonText}>Change number</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.loginHintText}>We will send a 6-digit code to verify your number.</Text>
            <Pressable style={styles.loginPrimaryButton} onPress={handleSendOtp} disabled={submitting}>
              <Text style={styles.loginPrimaryButtonText}>{submitting ? 'Sending...' : 'Send OTP'}</Text>
            </Pressable>
          </>
        )}
      </View>

      <Text style={styles.loginFooter}>Your Firebase session stays active until you log out.</Text>
      <View nativeID="recaptcha-container" style={{ width: 0, height: 0 }} />
      <FirebaseRecaptchaVerifier ref={recaptchaVerifier} firebaseConfig={firebaseConfig} />
    </View>
  );
}
