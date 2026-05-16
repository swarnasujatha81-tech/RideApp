import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { onAuthStateChanged, PhoneAuthProvider, signInWithCredential, signOut } from 'firebase/auth';
import { addDoc, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, increment, onSnapshot, query, setDoc, Timestamp, updateDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import debounce from 'lodash.debounce';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, Share, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import BlockedAccount from '../../components/blocked-account';
import DriverVerificationButtons from '../../components/driver-verification';
import FirebaseRecaptchaVerifier from '../../components/firebase-recaptcha-verifier';
import OSMMapView, { OSMMapViewRef } from '../../components/osm-map-view';
import { useAuth } from '../../lib/auth-context';
import { SHARE_AUTO_FARE_SETTINGS } from '../../lib/fare-settings';
import { NotificationService } from '../../lib/notification-service';
import { searchHyderabadLocationsDetailed, type LocationSuggestion } from '../../services/locationSearch';
import { getRouteDistance } from '../../services/routingService';
import { AppErrorBoundary } from './ride-home/AppErrorBoundary';
import { ACTIVE_RIDE_BUTTON_HEIGHT, ACTIVE_RIDE_BUTTON_WIDTH, CHAT_SOUND_URL, CURRENT_LOC_FAB_RISE, DEFAULT_MAP_REGION, DRIVER_ALERT_SOUND_URL, DRIVER_DESTINATION_MARKER_RADIUS_KM, DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT, DRIVER_SUBSCRIPTION_AMOUNT, DRIVER_SUBSCRIPTION_DAYS, EARN_REWARD_AMOUNT, FIVE_MIN_MS, GAME_BIRD_HIT_SOUND_URL, GAME_UNLOCK_SOUND_URL, GAME_ZOMBIE_HIT_SOUND_URL, HYDERABAD_SERVICE_RADIUS_KM, icons, MARKER_PLACE_SOUND_URL, PRIMARY_ACTION_SOUND_URL, RAZORPAY_KEY_ID, SCREEN_HEIGHT, SCREEN_WIDTH, VEHICLE_SELECT_SOUND_URL } from './ride-home/constants';
import { auth, db, firebaseConfig, storage } from './ride-home/firebase-core';
import { calcDist, getAreaLabelFromCoord, getMandalName, getNearestPopularArea, getPrimaryAreaName, getRideCreatedAtMs, isFreshWaitingRide, isValidEmail, isValidMobileFn, isValidVehiclePlate, isWithinHyderabadService } from './ride-home/geo';
import { decryptOTP, encryptOTP, generateOTP } from './ride-home/otp';
import { calculateRideFare, getPricingDemandLevel, type DemandLevel } from './ride-home/pricing';
import { calcSegmentEtaMinutes, findShareAutoMatch, toPoolPassenger } from './ride-home/shareAutoMatching';
import { styles } from './ride-home/styles';
import type { ChatMessage, Coord, Driver, DriverVehicleType, HelpQuestion, PoolPassenger, Ride, RideHistory, RideType, ShareAutoPool } from './ride-home/types';
import { isActiveRideStatus } from './ride-home/types';

const PASSENGER_QUOTE_DEMAND_LEVEL: DemandLevel = 'low';
const RECENT_SEARCHES_KEY = '@rideapp:recent_location_searches_v2';
const RECENT_SEARCH_SUGGESTION_TYPE = 'recent_search';
const BLOCKED_DRIVER_EMAIL = 's123shareit@gmail.com';
const BLOCKED_DRIVER_PHONE = '63002 68015';
const BLOCKED_DRIVER_MESSAGE = 'Your account was blocked by admin due to some reasons. Please contact admin via s123shareit@gmail.com or 63002 68015 to activate.';

type RideBillRecord = RideHistory & {
  distance?: number;
  pickupTimeMs?: number;
  dropTimeMs?: number;
  totalTimeMinutes?: number;
  billGeneratedAtMs?: number;
};

type StoredLocationSuggestion = LocationSuggestion & {
  usedCount?: number;
  lastUsedAt?: number;
};

const formatBillTime = (value?: number) => (value ? new Date(value).toLocaleString() : 'N/A');

const buildRideBillShareMessage = (bill: RideBillRecord) => [
  'RideApp Trip Bill',
  `Fare: ₹${bill.fare}`,
  `Pickup: ${bill.pickupAddr || 'Pickup'}`,
  `Drop: ${bill.dropAddr || 'Drop'}`,
  `Distance: ${typeof bill.distance === 'number' ? `${bill.distance.toFixed(1)} km` : 'N/A'}`,
  `Total time: ${typeof bill.totalTimeMinutes === 'number' ? `${bill.totalTimeMinutes} min` : 'N/A'}`,
  `Pickup time: ${formatBillTime(bill.pickupTimeMs)}`,
  `Drop time: ${formatBillTime(bill.dropTimeMs)}`,
  `Driver: ${bill.driverName || 'Driver'}`,
  `Passenger: ${bill.passengerName || 'Passenger'}`,
].join('\n');

const buildRideBillShareUrl = (bill: RideBillRecord) => `whatsapp://send?text=${encodeURIComponent(buildRideBillShareMessage(bill))}`;

function RideAppScreen() {
  const { initializing: authInitializing } = useAuth();
  const insets = useSafeAreaInsets();
  const bottomSafeSpacing = Math.max(16, insets.bottom);
  const [loggedIn, setLoggedIn] = useState(() => !!auth.currentUser);
  const mapRef = useRef<OSMMapViewRef | null>(null);
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [nameForSignup, setNameForSignup] = useState('');
  const [mode, setMode] = useState<'USER' | 'DRIVER'>('USER');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [isIdentitySet, setIsIdentitySet] = useState(false);
  const [driverDocId, setDriverDocId] = useState<string | null>(null);
  const [driverVerified, setDriverVerified] = useState(false);
  const [driverSubscriptionActive, setDriverSubscriptionActive] = useState(false);
  const [driverSubscriptionExpiresAt, setDriverSubscriptionExpiresAt] = useState<Timestamp | null>(null);
  const [driverBanned, setDriverBanned] = useState(false);
  const [bannedMessage, setBannedMessage] = useState('');
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const [showDriverVerification, setShowDriverVerification] = useState(false);
  const [waitingForVerification, setWaitingForVerification] = useState(false);
  const [showDriverPaymentModal, setShowDriverPaymentModal] = useState(false);
  const [driverPaymentProcessing, setDriverPaymentProcessing] = useState(false);
  const [driverPaymentError, setDriverPaymentError] = useState('');
  const [driverCheckoutHtml, setDriverCheckoutHtml] = useState('');
  const [showDriverCheckout, setShowDriverCheckout] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profileEarnWallet, setProfileEarnWallet] = useState(0);
  const [farePenalty, setFarePenalty] = useState(0);
  const [driverPhotoUrl, setDriverPhotoUrl] = useState('');
  const [driverPhotoUri, setDriverPhotoUri] = useState('');
  const [showRideBillModal, setShowRideBillModal] = useState(false);
  const [activeRideBill, setActiveRideBill] = useState<RideBillRecord | null>(null);

  // INDIVIDUAL DRIVER STATS [cite: 165]
  const [driverStats, setDriverStats] = useState({ 
    completed: 0, 
    earnings: 0, 
    cancelled: 0, 
    rating: 0,
    totalRatings: 0,
    cancelHistory: [] as number[], 
    reportHistory: [] as number[], 
    isPermanentlySuspended: false,
    dailyEarnings: {} as Record<string, number>,
    badReportExplanation: ''
  });

  const [crewUnlockCode, setCrewUnlockCode] = useState('');
  const [location, setLocation] = useState<Coord | null>(null);
  const [isFetchingCurrentLocation, setIsFetchingCurrentLocation] = useState(true);
  const [pickupInput, setPickupInput] = useState('Current Location');
  const [pickupCoords, setPickupCoords] = useState<Coord | null>(null);
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState<Coord | null>(null);
  const [activeSearchField, setActiveSearchField] = useState<'pickup' | 'drop' | null>(null);
  const [searchSuggestions, setSearchSuggestions] = useState<LocationSuggestion[]>([]);
  const [recentSearchSuggestions, setRecentSearchSuggestions] = useState<StoredLocationSuggestion[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [searchSuggestionState, setSearchSuggestionState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle');
  const [searchSuggestionMessage, setSearchSuggestionMessage] = useState('');
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeDurationSeconds, setRouteDurationSeconds] = useState<number | null>(null);
  const [routeDistanceError, setRouteDistanceError] = useState('');
  const [selectedRide, setSelectedRide] = useState<RideType | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [allDrivers, setAllDrivers] = useState<Driver[]>([]);
  const [ignoredRides, setIgnoredRides] = useState<string[]>([]);
  const [userBookedRide, setUserBookedRide] = useState<Ride | null>(null);
  const [currentRide, setCurrentRide] = useState<Ride | null>(null);
  const [driverVehicle, setDriverVehicle] = useState<DriverVehicleType | null>(null);
  const [fares, setFares] = useState({ Bike: 0, Auto: 0, Cab: 0, ShareAuto: 0, Parcel: 0 });
  const [isCalculatingFares, setIsCalculatingFares] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [verificationSent, setVerificationSent] = useState(false);
  const [bookingValidation, setBookingValidation] = useState<{ visible: boolean; title?: string; message?: string }>({ visible: false });
  const recaptchaVerifier = useRef<any | null>(null);
  const driverSubscriptionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceInstallIdRef = useRef('');
  const otpClaimPhoneRef = useRef('');
  const driverSessionMovedRef = useRef(false);
  const driverRideBillSeenRef = useRef('');
  const passengerRideBillSeenRef = useRef('');
  const driverRideBillPrimedRef = useRef(false);
  const passengerRideBillPrimedRef = useRef(false);
  const suggestionRequestIdRef = useRef(0);
  const routeRequestIdRef = useRef(0);

  const openRideBill = useCallback((bill: RideBillRecord) => {
    if (!bill.id) return;
    setActiveRideBill(bill);
    setShowRideBillModal(true);
  }, []);

  const maybeOpenRideBillFromHistory = useCallback((history: RideHistory[], role: 'DRIVER' | 'PASSENGER') => {
    const latestCompleted = history.find((entry) => entry.status === 'completed' && !!entry.id);
    const seenRef = role === 'DRIVER' ? driverRideBillSeenRef : passengerRideBillSeenRef;
    const primedRef = role === 'DRIVER' ? driverRideBillPrimedRef : passengerRideBillPrimedRef;

    if (!primedRef.current) {
      primedRef.current = true;
      seenRef.current = latestCompleted?.id || '';
      return;
    }

    if (latestCompleted?.id && latestCompleted.id !== seenRef.current) {
      seenRef.current = latestCompleted.id;
      openRideBill(latestCompleted as RideBillRecord);
    }
  }, [openRideBill]);

  const postDriverCheckoutMessage = (message: string) => {
    (window as any).ReactNativeWebView?.postMessage(message);
  };

  const buildDriverCheckoutHtml = useCallback((amountInRupees: number) => {
    const options = {
      key: RAZORPAY_KEY_ID,
      amount: amountInRupees * 100,
      currency: 'INR',
      name: 'RideApp Driver Pass',
      description: '28-day driver subscription',
      prefill: {
        name: driverName || profileName || 'Driver',
        contact: driverPhone || profilePhone || '',
      },
      theme: { color: '#0B1020' },
    };

    return `
      <!doctype html>
      <html>
        <head>
          <meta name="viewport" content="width=device-width,initial-scale=1" />
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial; background: #08111F; color: #E6EEF8; margin: 0; padding: 24px; }
            .card { background: linear-gradient(180deg,#0B1220 0%, #08111F 100%); border-radius: 16px; padding: 24px; max-width: 540px; margin: 32px auto; box-shadow: 0 12px 30px rgba(0,0,0,0.6); }
            .eyebrow { color: #9FB3D6; font-weight: 700; margin-bottom: 8px; }
            h1 { margin: 0 0 8px 0; font-size: 22px; color: #FFF; }
            .price { font-weight: 800; font-size: 28px; margin-top: 8px; color: #fff; }
            .meta { color: #B8C6E6; font-size: 13px; margin-bottom: 18px; }
            .button { background: #FFFFFF; color: #08111F; border-radius: 16px; padding: 14px 18px; text-align: center; font-weight: 800; }
          </style>
          <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
        </head>
        <body>
          <div class="card">
            <div class="eyebrow">Driver access approved</div>
            <h1>Pay to unlock driver features</h1>
            <p>Your documents are verified. Complete this one-time payment to activate ride notifications and driver tools for ${DRIVER_SUBSCRIPTION_DAYS} days.</p>
            <div class="price">₹${amountInRupees}</div>
            <div class="meta">Single payment • ${DRIVER_SUBSCRIPTION_DAYS} days access</div>
            <div class="button">Opening secure checkout...</div>
          </div>
          <script>
            (function() {
              var options = ${JSON.stringify(options)};
              options.handler = function(response) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'success', payload: response }));
              };
              options.modal = {
                ondismiss: function () {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'dismiss' }));
                }
              };
              var rzp = new Razorpay(options);
              setTimeout(function() {
                try {
                  rzp.open();
                } catch (error) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'error', message: error && error.message ? error.message : 'Unable to open payment checkout.' }));
                }
              }, 600);
            })();
          </script>
        </body>
      </html>
    `;
  }, [driverName, driverPhone, profileName, profilePhone]);

  const normalizePhoneDigits = useCallback((value?: string | null) => {
    const digits = (value || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }, []);

  const ensureDeviceInstallId = useCallback(async () => {
    if (deviceInstallIdRef.current) return deviceInstallIdRef.current;
    let savedId = await AsyncStorage.getItem('shareit_device_install_id');
    if (!savedId) {
      savedId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      await AsyncStorage.setItem('shareit_device_install_id', savedId);
    }
    deviceInstallIdRef.current = savedId;
    return savedId;
  }, []);

  const isDriverVehicleTypeValue = useCallback((value: unknown): value is DriverVehicleType => (
    value === 'Bike' || value === 'Cycle' || value === 'Auto' || value === 'Cab'
  ), []);

  const applyDriverRecordToState = useCallback(async (driverId: string, data: any) => {
    const registeredPhone = normalizePhoneDigits(data?.phone || data?.registeredPhone || driverId);
    setDriverDocId(driverId);
    setDriverName(data?.name || data?.registeredName || profileName || '');
    setDriverPhone(registeredPhone);
    setVehiclePlate(data?.vehicleNumber || data?.vehiclePlate || '');
    setDriverPhotoUrl(data?.driverPhotoUrl || '');
    await AsyncStorage.setItem('driver_doc_id', driverId);

    if (isDriverVehicleTypeValue(data?.vehicleType)) {
      setDriverVehicle(data.vehicleType);
      await AsyncStorage.setItem('driver_vehicle', data.vehicleType);
    }
  }, [isDriverVehicleTypeValue, normalizePhoneDigits, profileName]);

  const clearDriverIdentityOnThisDevice = useCallback(async () => {
    await AsyncStorage.removeItem('driver_doc_id');
    await AsyncStorage.removeItem('driver_vehicle');
    setDriverDocId(null);
    setDriverVehicle(null);
    setDriverName('');
    setDriverPhone('');
    setVehiclePlate('');
    setDriverPhotoUrl('');
    setDriverPhotoUri('');
    setDriverVerified(false);
    setDriverSubscriptionActive(false);
    setDriverSubscriptionExpiresAt(null);
    setWaitingForVerification(false);
    setShowDriverVerification(false);
    setShowDriverPaymentModal(false);
    setDriverPaymentError('');
    setIsIdentitySet(false);
    setCurrentRide(null);
  }, []);

  const handleDriverSessionMoved = useCallback(async () => {
    if (driverSessionMovedRef.current) return;
    driverSessionMovedRef.current = true;
    await clearDriverIdentityOnThisDevice();
    Alert.alert('Driver account moved', 'This driver account was opened on another mobile with OTP. Please verify OTP again here if you want to use this phone.');
    driverSessionMovedRef.current = false;
  }, [clearDriverIdentityOnThisDevice]);

  const syncDriverRecordForPhone = useCallback(async (
    phone: string,
    options?: { claimDevice?: boolean; userId?: string; nameFallback?: string }
  ) => {
    const normalizedPhone = normalizePhoneDigits(phone);
    if (!isValidMobileFn(normalizedPhone)) return false;

    try {
      const localDeviceId = await ensureDeviceInstallId();
      const driverRef = doc(db, 'drivers', normalizedPhone);
      const driverSnap = await getDoc(driverRef);
      if (!driverSnap.exists()) return false;

      const data = driverSnap.data();
      const activeDeviceId = data?.activeDeviceId || '';
      const canUseOnThisDevice = !activeDeviceId || activeDeviceId === localDeviceId || options?.claimDevice;

      if (!canUseOnThisDevice) {
        await handleDriverSessionMoved();
        return true;
      }

      if (!activeDeviceId || activeDeviceId !== localDeviceId || options?.claimDevice) {
        await setDoc(driverRef, {
          activeDeviceId: localDeviceId,
          activeAuthUid: options?.userId || auth.currentUser?.uid || '',
          lastDriverOtpLoginAt: Timestamp.now(),
          phone: normalizedPhone,
          ...(options?.nameFallback && !data?.name ? { name: options.nameFallback } : {}),
        }, { merge: true });
      }

      await applyDriverRecordToState(normalizedPhone, {
        ...data,
        activeDeviceId: localDeviceId,
        ...(options?.nameFallback && !data?.name ? { name: options.nameFallback } : {}),
      });
      return true;
    } catch {
      return false;
    }
  }, [applyDriverRecordToState, ensureDeviceInstallId, handleDriverSessionMoved, normalizePhoneDigits]);

  useEffect(() => {
    void ensureDeviceInstallId();
  }, [ensureDeviceInstallId]);

  useEffect(() => {
    (async () => {
      try {
        await ensureDeviceInstallId();
        const id = await AsyncStorage.getItem('driver_doc_id');
        if (id) {
          setDriverDocId(id);
          setWaitingForVerification(true);
        }
      } catch (e) {
        console.warn('driver_doc_id load failed', e);
      }
    })();
  }, [ensureDeviceInstallId]);

  useEffect(() => {
    if (!driverDocId) return;
    const docRef = doc(db, 'drivers', driverDocId);
    const unsub = onSnapshot(docRef, async (snapshot) => {
      if (!snapshot.exists()) {
        await clearDriverIdentityOnThisDevice();
        return;
      }

      const data = snapshot.data();
      const localDeviceId = await ensureDeviceInstallId();
      const activeDeviceId = data?.activeDeviceId || '';
      if (activeDeviceId && activeDeviceId !== localDeviceId) {
        await handleDriverSessionMoved();
        return;
      }
      if (!activeDeviceId && localDeviceId) {
        setDoc(docRef, {
          activeDeviceId: localDeviceId,
          activeAuthUid: auth.currentUser?.uid || '',
          lastDriverSessionSeenAt: Timestamp.now(),
        }, { merge: true }).catch(() => {});
      }

      await applyDriverRecordToState(driverDocId, data);
      const isBanned = data?.banned === true || data?.isBlocked === true || data?.status === 'blocked';
      if (isBanned) {
        setDriverBanned(true);
        setBannedMessage(data?.bannedMessage || data?.blockReason || BLOCKED_DRIVER_MESSAGE);
        setShowBlockedModal(true);
        setIsIdentitySet(false);
        setDriverSubscriptionActive(false);
        try {
          await NotificationService.clearAllNotifications();
        } catch (e) {
          // ignore
        }
        return;
      } else if (driverBanned) {
        setDriverBanned(false);
        setBannedMessage('');
        setShowBlockedModal(false);
      }
      const isVerified = !!data?.isVerified;
      const subscriptionExpiresAt = data?.subscriptionExpiresAt ?? null;
      const subscriptionExpiresAtMs = subscriptionExpiresAt?.toMillis?.() ?? 0;
      const isSubscriptionActive = isVerified && data?.subscriptionActive === true && subscriptionExpiresAtMs > Date.now();

      setDriverVerified(isVerified);
      setDriverSubscriptionExpiresAt(subscriptionExpiresAt);
      setDriverSubscriptionActive(isSubscriptionActive);

      if (driverSubscriptionTimerRef.current) {
        clearTimeout(driverSubscriptionTimerRef.current);
        driverSubscriptionTimerRef.current = null;
      }

      if (!isVerified) {
        setWaitingForVerification(!!data?.rcImageUrl || data?.verificationStatus === 'pending');
        setShowDriverVerification(false);
        setShowDriverPaymentModal(false);
        setDriverPaymentError('');
        setIsIdentitySet(false);
        return;
      }

      setWaitingForVerification(false);
      setShowDriverVerification(false);

      if (!isSubscriptionActive) {
        setIsIdentitySet(false);
        setShowDriverPaymentModal(true);
        setDriverPaymentError('');

        if (subscriptionExpiresAtMs > 0 && subscriptionExpiresAtMs <= Date.now() && data?.subscriptionActive === true) {
          updateDoc(docRef, {
            subscriptionActive: false,
            subscriptionStatus: 'expired',
          }).catch(() => {});
        }
        return;
      }

      setShowDriverPaymentModal(false);
      setDriverPaymentError('');
      setIsIdentitySet(true);

      const remainingMs = subscriptionExpiresAtMs - Date.now();
      if (remainingMs > 0) {
        driverSubscriptionTimerRef.current = setTimeout(() => {
          setDriverSubscriptionActive(false);
          setIsIdentitySet(false);
          setShowDriverPaymentModal(true);
        }, remainingMs);
      }
    }, () => {
      // Ignore permission/network stream errors here; UI state is handled by existing auth/session flows.
    });
    return () => {
      unsub();
      if (driverSubscriptionTimerRef.current) {
        clearTimeout(driverSubscriptionTimerRef.current);
        driverSubscriptionTimerRef.current = null;
      }
    };
  }, [applyDriverRecordToState, clearDriverIdentityOnThisDevice, driverDocId, ensureDeviceInstallId, handleDriverSessionMoved]);

  const handleDriverSubscriptionPayment = async () => {
    if (!driverDocId) {
      Alert.alert('Verification required', 'Please submit and approve your driver documents first.');
      return;
    }

    if (driverPaymentProcessing) return;

    try {
      setDriverPaymentProcessing(true);
      setDriverPaymentError('');
      setDriverCheckoutHtml(buildDriverCheckoutHtml(DRIVER_SUBSCRIPTION_AMOUNT));
      setShowDriverCheckout(true);
    } catch (err: any) {
      const message = err?.description || err?.message || 'Payment could not be completed. Please try again.';
      setDriverPaymentError(message);
      Alert.alert('Payment failed', message);
      setDriverPaymentProcessing(false);
    } finally {
    }
  };

  const handleDriverCheckoutMessage = useCallback(async (event: any) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);

      if (payload?.type === 'success') {
        const expiresAt = Timestamp.fromDate(new Date(Date.now() + DRIVER_SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000));

        if (driverDocId) {
          await updateDoc(doc(db, 'drivers', driverDocId), {
            subscriptionActive: true,
            subscriptionStatus: 'active',
            subscriptionAmount: DRIVER_SUBSCRIPTION_AMOUNT,
            subscriptionDays: DRIVER_SUBSCRIPTION_DAYS,
            subscriptionPaidAt: Timestamp.now(),
            subscriptionExpiresAt: expiresAt,
            subscriptionPaymentId: payload?.payload?.razorpay_payment_id ?? '',
            subscriptionOrderId: payload?.payload?.razorpay_order_id ?? '',
            subscriptionSignature: payload?.payload?.razorpay_signature ?? '',
          });
        }

        setDriverSubscriptionActive(true);
        setDriverSubscriptionExpiresAt(expiresAt);
        setShowDriverCheckout(false);
        setShowDriverPaymentModal(false);
        setIsIdentitySet(true);
        setDriverPaymentProcessing(false);
        Alert.alert('Subscription active', 'Your driver access is unlocked for 28 days.');
        return;
      }

      if (payload?.type === 'dismiss') {
        setShowDriverCheckout(false);
        setDriverPaymentProcessing(false);
        return;
      }

      if (payload?.type === 'error') {
        setShowDriverCheckout(false);
        setDriverPaymentProcessing(false);
        setDriverPaymentError(payload?.message || 'Unable to open payment checkout.');
        Alert.alert('Payment failed', payload?.message || 'Unable to open payment checkout.');
      }
    } catch {
      setShowDriverCheckout(false);
      setDriverPaymentProcessing(false);
      setDriverPaymentError('Payment checkout returned an invalid response.');
    }
  }, [driverDocId]);

  const handleSendOtp = async () => {
    console.log('[auth] send otp requested');
    if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
      Alert.alert('Invalid mobile', 'Enter a valid 10-digit mobile number starting with 6,7,8 or 9.');
      return;
    }
    try {
      if (!recaptchaVerifier.current) {
        throw new Error('reCAPTCHA verifier is not ready.');
      }
      const phoneProvider = new PhoneAuthProvider(auth);
      console.log('[auth] verifying phone number');
      const id = await phoneProvider.verifyPhoneNumber('+91' + mobileNumber, recaptchaVerifier.current);
      console.log('[auth] phone verification id received');
      setVerificationId(id);
      setVerificationSent(true);
      Alert.alert('OTP sent', 'Please check your SMS for the OTP.');
    } catch (err: any) {
      console.error('[auth] send otp failed', err);
      const msg = err?.message || 'Could not send OTP. Please try again.';
      Alert.alert('OTP failed', msg);
    }
  };

  const handleVerifyOtp = async () => {
    console.log('[auth] verify otp requested');
    try {
      if (!verificationId) {
        Alert.alert('No OTP requested', 'Please request an OTP first.');
        return;
      }
      const requestedPhone = normalizePhoneDigits(mobileNumber);
      otpClaimPhoneRef.current = requestedPhone;
      const cred = PhoneAuthProvider.credential(verificationId, otpInput);
      console.log('[auth] signing in with phone credential');
      const userCred = await signInWithCredential(auth, cred);
      console.log('[auth] sign in completed', { uid: userCred.user?.uid || null });
      const { user } = userCred;
      if (user) {
        const verifiedPhone = normalizePhoneDigits(requestedPhone || user.phoneNumber);
        try {
          const userRef = doc(db, 'users', user.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              phone: verifiedPhone,
              name: nameForSignup,
              createdAt: Timestamp.now()
            });
          } else if (nameForSignup && !userSnap.data()?.name) {
            await updateDoc(userRef, { name: nameForSignup, phone: verifiedPhone });
          } else if (verifiedPhone && userSnap.data()?.phone !== verifiedPhone) {
            await updateDoc(userRef, { phone: verifiedPhone });
          }
        } catch {
          // ignore Firestore write failures here
        }
        await syncDriverRecordForPhone(verifiedPhone, {
          claimDevice: true,
          userId: user.uid,
          nameFallback: nameForSignup,
        });
        otpClaimPhoneRef.current = '';
        console.log('[auth] post-login profile sync completed');
      }
    } catch (err: any) {
      otpClaimPhoneRef.current = '';
      console.error('[auth] verify otp failed', err);
      const msg = err?.message || 'OTP verification failed. Please try again.';
      Alert.alert('Verification failed', msg);
    }
  };
  const lastFareRebalancePromptRef = useRef<number | null>(null);
  const lastDriverFareRebalancePromptRef = useRef<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);

  const [, setSearchTimer] = useState(0);
  const [searchRadius, setSearchRadius] = useState(1.0);
  const searchAnim = useRef(new Animated.Value(1)).current;

  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [driverHistory, setDriverHistory] = useState<RideHistory[]>([]);
  const [driverPayableToApp, setDriverPayableToApp] = useState(0);
  const [driverAvgPickupMinutes, setDriverAvgPickupMinutes] = useState(0);
  const [driverOnline, setDriverOnline] = useState(true);
  const [driverDestinationFilterEnabled, setDriverDestinationFilterEnabled] = useState(false);
  const [driverDestinationMarker, setDriverDestinationMarker] = useState<Coord | null>(null);
  const [showDriverDestinationMap, setShowDriverDestinationMap] = useState(false);
  const [pendingDriverDestinationMarker, setPendingDriverDestinationMarker] = useState<Coord | null>(null);
  const [driverDestinationToggleUsageCount, setDriverDestinationToggleUsageCount] = useState(0);
  const [driverDestinationToggleUsageDate, setDriverDestinationToggleUsageDate] = useState('');
  const alertPlayingRef = useRef(false);
  const alertedRideIdsRef = useRef<Set<string>>(new Set());
  const chatLastMessageAtRef = useRef(0);
  const chatListenerHydratedRef = useRef(false);
  const [shareAutoSearchActive, setShareAutoSearchActive] = useState(false);
  const [, setShareAutoSearchStartedAt] = useState(0);
  const [shareAutoPoolId, setShareAutoPoolId] = useState('');
  const [showShareAutoFallback, setShowShareAutoFallback] = useState(false);
  const [shareAutoFallbackReason, setShareAutoFallbackReason] = useState('');
  const shareAutoTimersRef = useRef<{ search?: ReturnType<typeof setTimeout>; fallback?: ReturnType<typeof setTimeout> }>({});
  const shareAutoMatchInFlightRef = useRef(false);
  const shareAutoPulse = useRef(new Animated.Value(0)).current;
  const [shareAutoElapsed, setShareAutoElapsed] = useState(0);
  const [showShareAutoTerms, setShowShareAutoTerms] = useState(false);
  const [showShareAutoIntro, setShowShareAutoIntro] = useState(false);
  const [showParcelTerms, setShowParcelTerms] = useState(false);
  const [showEarnPage, setShowEarnPage] = useState(false);
  const [earnPassengerName, setEarnPassengerName] = useState('');
  const [earnPassengerPhone, setEarnPassengerPhone] = useState('');
  const [earnPassengerEmail, setEarnPassengerEmail] = useState('');
  const [earnRideType, setEarnRideType] = useState<'Bike' | 'Auto' | 'Cab'>('Bike');
  const [earnWithdrawMobile, setEarnWithdrawMobile] = useState('');
  const [earnWithdrawSaving, setEarnWithdrawSaving] = useState(false);
  const [earnEmergencySaving, setEarnEmergencySaving] = useState(false);
  const [chatTargetPassengerId, setChatTargetPassengerId] = useState<string>('ALL');
  const arrivalAutoPulse = useRef(new Animated.Value(0)).current;
  const driverPromoPulse = useRef(new Animated.Value(0)).current;
  const [shareAutoFoundMembers, setShareAutoFoundMembers] = useState(0);
  const waitingCancelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waitingCancelRideIdRef = useRef<string | null>(null);
  const userBookedRideRef = useRef<Ride | null>(null);
  const cancelRideRef = useRef<((id: string, isDriver: boolean, reason?: string) => Promise<void>) | null>(null);
  const lastUserRideStateRef = useRef<{ id: string; status: Ride['status'] } | null>(null);
  const [showShareAutoGame, setShowShareAutoGame] = useState(false);
  const [shareAutoGamePausedByRide, setShareAutoGamePausedByRide] = useState(false);
  const [gameMode, setGameMode] = useState<'bird' | 'zombie'>('bird');
  const [showLogoutMenu, setShowLogoutMenu] = useState(false);
  // Close logout menu when clicking outside
  useEffect(() => {
    if (showLogoutMenu) {
      const timer = setTimeout(() => setShowLogoutMenu(false), 3000); // Auto close after 3 seconds
      return () => clearTimeout(timer);
    }
  }, [showLogoutMenu]);
  const [gameTimeLeft, setGameTimeLeft] = useState(45);
  const [birdHits, setBirdHits] = useState(0);
  const [zombieHits, setZombieHits] = useState(0);
  const [zombieUnlocked, setZombieUnlocked] = useState(false);
  const [birdTarget, setBirdTarget] = useState({ x: 48, y: 48 });
  const [zombieTarget, setZombieTarget] = useState({ x: 30, y: 40 });
  const [selectedSharePassengerId, setSelectedSharePassengerId] = useState('');

  // NEW PASSENGER STATES
  const [passengerHistory, setPassengerHistory] = useState<RideHistory[]>([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showPassengerHistoryModal, setShowPassengerHistoryModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [helpQuestionText, setHelpQuestionText] = useState('');
  const [helpQuestions, setHelpQuestions] = useState<HelpQuestion[]>([]);
  const [helpAnswerDrafts, setHelpAnswerDrafts] = useState<Record<string, string>>({});
  const [homeLocation, setHomeLocation] = useState<Coord | null>(null);
  const [homeLocationLabel, setHomeLocationLabel] = useState('');
  const [showHomeLocationMapModal, setShowHomeLocationMapModal] = useState(false);
  const [showGoHomeVehicleModal, setShowGoHomeVehicleModal] = useState(false);
  const [pendingHomeLocation, setPendingHomeLocation] = useState<Coord | null>(null);
  const [isPassengerCardExpanded, setIsPassengerCardExpanded] = useState(false);
  const [passengerCardCollapsedHeight, setPassengerCardCollapsedHeight] = useState(320);
  const passengerCardTranslateY = useRef(new Animated.Value(0)).current;
  const passengerCardDragStartRef = useRef(0);
  const passengerCardPullUpMax = Math.max(0, SCREEN_HEIGHT - passengerCardCollapsedHeight + 52);
  const [profileNameEdit, setProfileNameEdit] = useState('');
  const [isSavingProfileName, setIsSavingProfileName] = useState(false);
  const [showRideStartedGameModal, setShowRideStartedGameModal] = useState(false);
  const [showRideHomeButton, setShowRideHomeButton] = useState(false);
  const activeRideButtonPos = useRef(new Animated.ValueXY({ x: SCREEN_WIDTH - ACTIVE_RIDE_BUTTON_WIDTH - 18, y: SCREEN_HEIGHT - 220 })).current;
  const activeRideButtonScale = useRef(new Animated.Value(1)).current;
  const activeRideButtonLastPos = useRef({ x: SCREEN_WIDTH - ACTIVE_RIDE_BUTTON_WIDTH - 18, y: SCREEN_HEIGHT - 220 });
  const [rideGameProgress, setRideGameProgress] = useState(0);
  const [rideGameSpeed, setRideGameSpeed] = useState(0);
  const [rideGameSteer, setRideGameSteer] = useState(0);
  const [rideGameSparkle, setRideGameSparkle] = useState(0);
  const [rideGameLives, setRideGameLives] = useState(3);
  const [rideGameStatus, setRideGameStatus] = useState<'running' | 'crashed' | 'finished' | 'gameover'>('running');
  const [rideGameObstacles, setRideGameObstacles] = useState<{ id: string; x: number; y: number }[]>([]);
  const rideGameObstacleTimerRef = useRef(0);
  const startedRideShownRef = useRef('');
  
  // NEW STATES FOR RATINGS, EARNINGS & BEHAVIOR REPORTING
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [pendingRideForRating, setPendingRideForRating] = useState<Ride | null>(null);
  const [selectedRating, setSelectedRating] = useState(0);
  const [showEarningsPage, setShowEarningsPage] = useState(false);
  const [driverEarningsLast28Days, setDriverEarningsLast28Days] = useState<Record<string, number>>({});
  const rideNotificationDelayRef = useRef<Record<string, number>>({});
  
  const journeyQuotes = [
    'Share the ride, share the joy! 🌟',
    'Together we go farther, cheaper! 👥',
    'Smart rides for smart travelers 🚀',
    'ShareIt: Making every trip awesome!',
    'Ride together, save together! 💰',
    'Hyderabad\'s smartest auto share 🛺',
    'Group rides = Happy wallets! 😊'
  ];
  const passengerNotifications = useMemo(() => [
    { id: '1', title: 'Ride update', message: 'Your driver is on the way and will reach shortly.' },
    { id: '2', title: 'Journey tip', message: 'Enjoy your trip with Share-It quotes while the ride is on.' },
  ], []);
  const passengerHistoryLast28Days = useMemo(() => {
    const cutoffMs = Date.now() - (28 * 24 * 60 * 60 * 1000);
    return passengerHistory.filter((item) => (item.createdAt?.toMillis?.() || 0) >= cutoffMs);
  }, [passengerHistory]);
  const passengerFeatureItems = useMemo(() => ([
    { icon: '💸', title: 'Smart Savings', text: 'Everyday rides with low, transparent pricing.' },
    { icon: '🛺', title: 'ShareAuto Magic', text: 'Split the route, spend less, and ride together.' },
    { icon: '🏠', title: 'Go Home in 2 Taps', text: 'Set home once, then book your ride instantly.' },
    { icon: '❤️', title: 'Loved for Simplicity', text: 'Clean flow, fewer steps, and stress-free booking.' },
  ]), []);
  const [currentQuoteIndex, setCurrentQuoteIndex] = useState(0);
  const journeyAnim = useRef(new Animated.Value(0)).current;
  const passengerFeatureRevealAnim = useRef(new Animated.Value(0)).current;
  const passengerFeaturePulseAnim = useRef(new Animated.Value(0)).current;

  const currentUserId = auth.currentUser?.uid || '';
  const activeRide = mode === 'USER' ? userBookedRide : currentRide;

  useEffect(() => {
    const verifiedPhone = normalizePhoneDigits(profilePhone || mobileNumber);
    if (verifiedPhone) setDriverPhone(verifiedPhone);
    if (profileName && !driverName) setDriverName(profileName);
  }, [driverName, mobileNumber, normalizePhoneDigits, profileName, profilePhone]);

  const updateRideSafely = async (
    rideId: string | undefined,
    payload: Record<string, unknown>,
    onMissing?: () => void
  ) => {
    if (!rideId) return false;
    try {
      await updateDoc(doc(db, 'rides', rideId), payload as any);
      return true;
    } catch (error: any) {
      const code = error?.code;
      const message = String(error?.message || '');
      if (code === 'not-found' || message.includes('No document to update')) {
        onMissing?.();
        return false;
      }
      throw error;
    }
  };

  const animatePassengerCard = useCallback((expand: boolean) => {
    setIsPassengerCardExpanded(expand);
    Animated.spring(passengerCardTranslateY, {
      toValue: expand ? -passengerCardPullUpMax : 0,
      useNativeDriver: true,
      bounciness: 6,
      speed: 10,
    }).start();
  }, [passengerCardPullUpMax, passengerCardTranslateY]);

  const passengerCardPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => isPassengerCardExpanded,
    onStartShouldSetPanResponderCapture: () => isPassengerCardExpanded,
    onMoveShouldSetPanResponder: (_, gestureState) => isPassengerCardExpanded ? Math.abs(gestureState.dy) > 1 : Math.abs(gestureState.dy) > 2,
    onPanResponderGrant: () => {
      passengerCardTranslateY.stopAnimation((val) => {
        passengerCardDragStartRef.current = val;
      });
    },
    onPanResponderMove: (_, gestureState) => {
      const nextVal = Math.max(-passengerCardPullUpMax, Math.min(0, passengerCardDragStartRef.current + gestureState.dy));
      passengerCardTranslateY.setValue(nextVal);
    },
    onPanResponderRelease: (_, gestureState) => {
      const endVal = Math.max(-passengerCardPullUpMax, Math.min(0, passengerCardDragStartRef.current + gestureState.dy));
      const shouldCollapse = endVal > -(passengerCardPullUpMax * 0.62) || gestureState.vy > 0.25;
      const shouldExpand = isPassengerCardExpanded
        ? !shouldCollapse
        : endVal < -(passengerCardPullUpMax * 0.42) || gestureState.vy < -0.25;
      animatePassengerCard(shouldExpand);
    },
    onPanResponderTerminate: () => {
      animatePassengerCard(isPassengerCardExpanded);
    },
  }), [animatePassengerCard, isPassengerCardExpanded, passengerCardPullUpMax, passengerCardTranslateY]);

  const savePassengerHomeLocation = useCallback(async (coord: Coord) => {
    const label = await getAreaLabelFromCoord(coord, 'Home');
    setHomeLocation(coord);
    setHomeLocationLabel(label);
    if (currentUserId) {
      await setDoc(doc(db, 'users', currentUserId), {
        homeLocation: coord,
        homeLocationLabel: label,
        homeLocationUpdatedAt: Timestamp.now(),
      }, { merge: true });
    }
    return label;
  }, [currentUserId]);

  const handleGoHomePress = useCallback(async () => {
    if (!location) {
      Alert.alert('Location needed', 'Please wait for your current location to load.');
      return;
    }

    if (!homeLocation) {
      setPendingHomeLocation(location);
      setShowHomeLocationMapModal(true);
      return;
    }

    setPickupCoords(location);
    const pickupLabel = await getAreaLabelFromCoord(location, getNearestPopularArea(location));
    setPickupInput(pickupLabel);
    setDestCoords(homeLocation);
    setDestination(homeLocationLabel || 'Home');
    setShowGoHomeVehicleModal(true);
    animatePassengerCard(true);
  }, [animatePassengerCard, homeLocation, homeLocationLabel, location]);

  const saveProfileName = useCallback(async () => {
    const nextName = profileNameEdit.trim();
    if (!nextName) {
      Alert.alert('Required', 'Name cannot be empty.');
      return;
    }
    if (nextName === profileName.trim()) {
      Alert.alert('No changes', 'Your name is already up to date.');
      return;
    }

    try {
      setIsSavingProfileName(true);
      if (currentUserId) {
        await setDoc(doc(db, 'users', currentUserId), { name: nextName }, { merge: true });
      }
      setProfileName(nextName);
      setProfileNameEdit(nextName);
      Alert.alert('Saved', 'Your profile name was updated.');
    } finally {
      setIsSavingProfileName(false);
    }
  }, [currentUserId, profileName, profileNameEdit]);

  const openComplaintEmail = useCallback(async () => {
    const supportEmail = 's123shareit@gmail.com';
    const userEmail = (auth.currentUser?.email || email || '').trim() || 'N/A';
    const userPhone = profilePhone || 'N/A';
    const subject = encodeURIComponent(`ShareIt Complaint - ${profileName || 'Passenger'}`);
    const body = encodeURIComponent(
      `Passenger Name: ${profileName || 'N/A'}\nPassenger Mobile: ${userPhone}\nPassenger Email: ${userEmail}\n\nComplaint details:\n`
    );
    const gmailUrl = `googlegmail://co?to=${encodeURIComponent(supportEmail)}&subject=${subject}&body=${body}`;
    const mailToUrl = `mailto:${supportEmail}?subject=${subject}&body=${body}`;

    try {
      const canOpenGmail = await Linking.canOpenURL(gmailUrl);
      if (canOpenGmail) {
        await Linking.openURL(gmailUrl);
        return;
      }
      await Linking.openURL(mailToUrl);
    } catch {
      Alert.alert('Unable to open email', 'Please send complaint manually to s123shareit@gmail.com');
    }
  }, [email, profileName, profilePhone]);

  const logoutFromProfile = useCallback(() => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            setShowProfileModal(false);
            await signOut(auth);
          }
        }
      ]
    );
  }, []);

  const deletePassengerHistoryEntry = useCallback(async (entryId: string) => {
    try {
      await deleteDoc(doc(db, 'rideHistory', entryId));
    } catch {
      Alert.alert('Delete failed', 'Could not delete this ride history entry.');
    }
  }, []);

  const clearAllPassengerHistory = useCallback(async () => {
    if (!currentUserId) return;
    Alert.alert('Delete all history', 'This will permanently delete your ride history. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete All',
        style: 'destructive',
        onPress: async () => {
          try {
            const historyQuery = query(collection(db, 'rideHistory'), where('passengerId', '==', currentUserId));
            const snap = await getDocs(historyQuery);
            await Promise.all(snap.docs.map((d) => deleteDoc(doc(db, 'rideHistory', d.id))));
          } catch {
            Alert.alert('Delete failed', 'Could not clear ride history right now.');
          }
        }
      }
    ]);
  }, [currentUserId]);

  const postHelpQuestion = useCallback(async () => {
    const question = helpQuestionText.trim();
    if (!question) {
      Alert.alert('Required', 'Type your question first.');
      return;
    }
    if (!currentUserId) {
      Alert.alert('Sign in required', 'Please sign in again and try posting your question.');
      return;
    }
    try {
      await addDoc(collection(db, 'helpForum'), {
        question,
        askedByUid: currentUserId,
        askedByName: profileName || 'Passenger',
        askedByPhone: profilePhone || '',
        askedByEmail: auth.currentUser?.email ?? null,
        createdAtMs: Date.now(),
        answers: [],
      });
      setHelpQuestionText('');
    } catch (error: any) {
      const message = String(error?.message || 'Could not submit question. Please try again.');
      Alert.alert('Send failed', message);
    }
  }, [currentUserId, email, helpQuestionText, profileName, profilePhone]);

  const postHelpAnswer = useCallback(async (questionId: string) => {
    const answer = (helpAnswerDrafts[questionId] || '').trim();
    if (!answer) return;

    try {
      await updateDoc(doc(db, 'helpForum', questionId), {
        answers: arrayUnion({
          text: answer,
          byUid: currentUserId,
          byName: profileName || 'Passenger',
          byPhone: profilePhone || '',
          byEmail: auth.currentUser?.email ?? null,
          createdAtMs: Date.now(),
        }),
      });
      setHelpAnswerDrafts((prev) => ({ ...prev, [questionId]: '' }));
    } catch {
      Alert.alert('Answer failed', 'Could not post answer right now.');
    }
  }, [email, helpAnswerDrafts, profileName, profilePhone]);

  useEffect(() => {
    if (!currentUserId) {
      setHelpQuestions([]);
      return;
    }

    return onSnapshot(collection(db, 'helpForum'), (snapshot) => {
      setHelpQuestions(
        snapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as HelpQuestion))
          .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      );
    }, () => {
      setHelpQuestions([]);
    });
  }, [currentUserId]);

  useEffect(() => {
    if (mode !== 'USER') return;
    if (userBookedRide?.status === 'started' && userBookedRide.id && startedRideShownRef.current !== userBookedRide.id) {
      startedRideShownRef.current = userBookedRide.id;
      setRideGameProgress(0);
      setRideGameSpeed(0);
      setRideGameSteer(0);
      setRideGameSparkle(0);
      setRideGameLives(3);
      setRideGameStatus('running');
      setRideGameObstacles([]);
      rideGameObstacleTimerRef.current = 0;
      setShowRideStartedGameModal(true);
      setShowRideHomeButton(false);
      return;
    }

    if (!userBookedRide?.id) {
      startedRideShownRef.current = '';
      setShowRideStartedGameModal(false);
      setShowRideHomeButton(false);
      setRideGameProgress(0);
      setRideGameSpeed(0);
      setRideGameSteer(0);
      setRideGameSparkle(0);
      setRideGameLives(3);
      setRideGameStatus('running');
      setRideGameObstacles([]);
      rideGameObstacleTimerRef.current = 0;
    }
  }, [mode, userBookedRide?.id, userBookedRide?.status]);

  useEffect(() => {
    if (
      mode !== 'USER' ||
      !userBookedRide ||
      userBookedRide.status !== 'started' ||
      userBookedRide.passengerId !== currentUserId
    ) {
      setShowRideHomeButton(false);
    }
  }, [mode, userBookedRide?.id, userBookedRide?.status, userBookedRide?.passengerId, currentUserId]);

  const activeRideButtonPanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gestureState) => Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
    onPanResponderGrant: () => {
      activeRideButtonPos.stopAnimation((val) => {
        activeRideButtonLastPos.current = { x: val.x, y: val.y };
      });
    },
    onPanResponderMove: (_, gestureState) => {
      activeRideButtonPos.setValue({
        x: activeRideButtonLastPos.current.x + gestureState.dx,
        y: activeRideButtonLastPos.current.y + gestureState.dy,
      });
    },
    onPanResponderRelease: (_, gestureState) => {
      const nextX = Math.min(Math.max(activeRideButtonLastPos.current.x + gestureState.dx, 12), SCREEN_WIDTH - ACTIVE_RIDE_BUTTON_WIDTH - 12);
      const nextY = Math.min(Math.max(activeRideButtonLastPos.current.y + gestureState.dy, 80), SCREEN_HEIGHT - ACTIVE_RIDE_BUTTON_HEIGHT - bottomSafeSpacing - 16);
      activeRideButtonLastPos.current = { x: nextX, y: nextY };
      Animated.spring(activeRideButtonPos, {
        toValue: { x: nextX, y: nextY },
        useNativeDriver: false,
        friction: 8,
      }).start();
    },
  }), [activeRideButtonPos, bottomSafeSpacing]);

  useEffect(() => {
    if (userBookedRide?.status === 'started') {
      activeRideButtonScale.setValue(1);
      const pulseLoop = Animated.loop(
        Animated.sequence([
          Animated.timing(activeRideButtonScale, {
            toValue: 1.08,
            duration: 550,
            easing: undefined,
            useNativeDriver: false,
          }),
          Animated.timing(activeRideButtonScale, {
            toValue: 1,
            duration: 550,
            easing: undefined,
            useNativeDriver: false,
          }),
        ]),
      );
      pulseLoop.start();
      return () => pulseLoop.stop();
    }
    activeRideButtonScale.setValue(1);
    return undefined;
  }, [userBookedRide?.status, activeRideButtonScale]);

  useEffect(() => {
    if (!showRideStartedGameModal || rideGameStatus !== 'running') return;

    const lanes = [12, 30, 48, 66, 84];
    const tick = setInterval(() => {
      setRideGameSpeed((prev) => Math.max(0, prev - 0.22));
      setRideGameProgress((prev) => Math.min(100, prev + Math.max(0.2, rideGameSpeed * 0.22 + 0.1)));
      setRideGameSparkle((prev) => (prev + 1) % 4);
      setRideGameObstacles((prev) => {
        const obstacleSpeed = 3 + rideGameSpeed * 1.2 + rideGameProgress * 0.05;
        const next = prev
          .map((obs) => ({ ...obs, y: obs.y + obstacleSpeed }))
          .filter((obs) => obs.y <= 118);

        rideGameObstacleTimerRef.current += 120;
        const spawnInterval = 820 - Math.min(400, rideGameProgress * 2.5);
        if (rideGameObstacleTimerRef.current >= spawnInterval) {
          rideGameObstacleTimerRef.current = 0;
          next.push({
            id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
            x: lanes[Math.floor(Math.random() * lanes.length)],
            y: -20,
          });
        }

        return next;
      });
    }, 120);

    return () => clearInterval(tick);
  }, [showRideStartedGameModal, rideGameSpeed, rideGameStatus, rideGameProgress]);

  useEffect(() => {
    if (!showRideStartedGameModal || rideGameStatus !== 'running') return;
    const currentX = Math.min(82, Math.max(8, 50 + rideGameSteer));
    const obstacleHalfWidth = 10;
    const autoHalfWidth = 11;
    const crash = rideGameObstacles.some((obs) => {
      const verticalHit = obs.y >= 90 && obs.y <= 112;
      const horizontalHit = Math.abs(obs.x - currentX) <= obstacleHalfWidth + autoHalfWidth;
      return verticalHit && horizontalHit;
    });

    if (crash) {
      setRideGameLives((prev) => {
        const next = Math.max(0, prev - 1);
        setRideGameStatus(next <= 0 ? 'gameover' : 'crashed');
        return next;
      });
      setRideGameSpeed(0);
      setRideGameObstacles((prev) => prev.filter((obs) => obs.y < 90 || obs.y > 112));
    }
  }, [rideGameObstacles, rideGameSteer, rideGameStatus, showRideStartedGameModal, rideGameLives]);

  useEffect(() => {
    if (rideGameProgress >= 100 && rideGameStatus === 'running') {
      setRideGameStatus('finished');
    }
  }, [rideGameProgress, rideGameStatus]);

  useEffect(() => {
    if (!(mode === 'USER' && isPassengerCardExpanded && !userBookedRide)) {
      passengerFeatureRevealAnim.setValue(0);
      passengerFeaturePulseAnim.setValue(0);
      return;
    }

    Animated.timing(passengerFeatureRevealAnim, {
      toValue: 1,
      duration: 360,
      useNativeDriver: true,
    }).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(passengerFeaturePulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(passengerFeaturePulseAnim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    pulseLoop.start();
    return () => {
      pulseLoop.stop();
      passengerFeaturePulseAnim.setValue(0);
    };
  }, [isPassengerCardExpanded, mode, passengerFeaturePulseAnim, passengerFeatureRevealAnim, userBookedRide]);

  useEffect(() => {
    if (!userBookedRide?.id || userBookedRide.type !== 'ShareAuto') return;
    const rebalance = userBookedRide.shareAutoFareRebalance;
    if (!rebalance?.active) return;
    if (!rebalance.remainingPassengerIds.includes(currentUserId)) return;
    if (rebalance.passengerApprovedIds?.includes(currentUserId)) return;
    if (rebalance.passengerDeclinedIds?.includes(currentUserId)) return;
    if (lastFareRebalancePromptRef.current === rebalance.requestedAtMs) return;

    lastFareRebalancePromptRef.current = rebalance.requestedAtMs;
    const extraIndex = rebalance.remainingPassengerIds.findIndex((id) => id === currentUserId);
    const extraFare = extraIndex >= 0 ? rebalance.extraFares[extraIndex] : 0;
    const newFare = extraIndex >= 0 ? rebalance.newFares[extraIndex] : 0;
    const totalFare = rebalance.totalNewFare + rebalance.chargedFare;
    Alert.alert(
      'Fare update',
      `${rebalance.cancelledPassengerName || 'A passenger'} cancelled after OTP. Extra fare for you: ₹${extraFare}. New fare: ₹${newFare}. Total ride fare: ₹${totalFare}. Continue?`,
      [
        {
          text: 'Decline',
          style: 'destructive',
          onPress: async () => {
            await updateRideSafely(userBookedRide.id, {
              'shareAutoFareRebalance.passengerDeclinedIds': arrayUnion(currentUserId),
            }, () => {
              setUserBookedRide(null);
            });
          },
        },
        {
          text: 'Accept',
          onPress: async () => {
            await updateRideSafely(userBookedRide.id, {
              'shareAutoFareRebalance.passengerApprovedIds': arrayUnion(currentUserId),
            }, () => {
              setUserBookedRide(null);
            });
          },
        },
      ]
    );
  }, [userBookedRide, currentUserId]);

  useEffect(() => {
    if (!currentRide?.id || currentRide.type !== 'ShareAuto') return;
    const rebalance = currentRide.shareAutoFareRebalance;
    if (!rebalance?.active || rebalance.driverApproved) return;
    if (lastDriverFareRebalancePromptRef.current === rebalance.requestedAtMs) return;

    lastDriverFareRebalancePromptRef.current = rebalance.requestedAtMs;
    const totalFare = rebalance.totalNewFare + rebalance.chargedFare;
    Alert.alert(
      'Fare update request',
      `${rebalance.cancelledPassengerName || 'A passenger'} cancelled after OTP. Total ride fare becomes ₹${totalFare}. Continue ride with updated fares?`,
      [
        {
          text: 'Cancel Ride',
          style: 'destructive',
          onPress: async () => {
            await deleteDoc(doc(db, 'rides', currentRide.id!));
            setCurrentRide(null);
          },
        },
        {
          text: 'Accept',
          onPress: async () => {
            await updateRideSafely(currentRide.id, {
              'shareAutoFareRebalance.driverApproved': true,
            }, () => {
              setCurrentRide(null);
            });
          },
        },
      ]
    );
  }, [currentRide]);

  useEffect(() => {
    if (mode !== 'USER') return;

    if (userBookedRide?.id) {
      lastUserRideStateRef.current = { id: userBookedRide.id, status: userBookedRide.status };
      return;
    }

    const last = lastUserRideStateRef.current;
    if (!last?.id) return;

    const lastRide = rides.find((r) => r.id === last.id);
    if (lastRide?.driverId) {
      setPendingRideForRating(lastRide);
      setShowRatingModal(true);
      setSelectedRating(0);
    }
    lastUserRideStateRef.current = null;
  }, [mode, userBookedRide, rides]);

  useEffect(() => {
    if (!currentRide?.id || currentRide.type !== 'ShareAuto') return;
    const rebalance = currentRide.shareAutoFareRebalance;
    if (!rebalance?.active) return;

    if (rebalance.passengerDeclinedIds && rebalance.passengerDeclinedIds.length > 0) {
      deleteDoc(doc(db, 'rides', currentRide.id!)).catch(() => {});
      setCurrentRide(null);
      return;
    }

    const allPassengerApproved = rebalance.remainingPassengerIds.every((id) => rebalance.passengerApprovedIds?.includes(id));
    if (!rebalance.driverApproved || !allPassengerApproved) return;

    const applyFareRebalance = async () => {
      const ids = currentRide.shareAutoPassengerIds || [];
      const names = currentRide.shareAutoPassengerNames || [];
      const phones = currentRide.shareAutoPassengerPhones || [];
      const pickups = currentRide.shareAutoPassengerPickups || [];
      const drops = currentRide.shareAutoPassengerDrops || [];
      const pickupAddrs = currentRide.shareAutoPassengerPickupAddrs || [];
      const dropAddrs = currentRide.shareAutoPassengerDropAddrs || [];
      const distances = currentRide.shareAutoPassengerDistances || [];

      const filteredIndexes = ids
        .map((id, index) => ({ id, index }))
        .filter((item) => item.id !== rebalance.cancelledPassengerId)
        .map((item) => item.index);

      const nextIds = filteredIndexes.map((index) => ids[index]);
      const nextNames = filteredIndexes.map((index) => names[index]);
      const nextPhones = filteredIndexes.map((index) => phones[index]);
      const nextPickups = filteredIndexes.map((index) => pickups[index]);
      const nextDrops = filteredIndexes.map((index) => drops[index]);
      const nextPickupAddrs = filteredIndexes.map((index) => pickupAddrs[index]);
      const nextDropAddrs = filteredIndexes.map((index) => dropAddrs[index]);
      const nextDistances = filteredIndexes.map((index) => distances[index]);

      const nextFares = nextIds.map((id) => {
        const matchIndex = rebalance.remainingPassengerIds.findIndex((pid) => pid === id);
        return matchIndex >= 0 ? rebalance.newFares[matchIndex] : getSharePassengerFareById(currentRide, id);
      });

      const nextPickupDone = (currentRide.shareAutoPickupCompletedIds || []).filter((id) => id !== rebalance.cancelledPassengerId);
      const nextDropDone = (currentRide.shareAutoDropCompletedIds || []).filter((id) => id !== rebalance.cancelledPassengerId);
      const nextTotalFare = nextFares.reduce((sum, x) => sum + x, 0);
      const nextGroupKey = nextIds.slice().sort().join('|');

      await updateRideSafely(currentRide.id, {
        shareAutoPassengerIds: nextIds,
        shareAutoPassengerNames: nextNames,
        shareAutoPassengerPhones: nextPhones,
        shareAutoPassengerPickups: nextPickups,
        shareAutoPassengerDrops: nextDrops,
        shareAutoPassengerPickupAddrs: nextPickupAddrs,
        shareAutoPassengerDropAddrs: nextDropAddrs,
        shareAutoPassengerDistances: nextDistances,
        shareAutoPassengerFares: nextFares,
        shareAutoPickupCompletedIds: nextPickupDone,
        shareAutoDropCompletedIds: nextDropDone,
        shareAutoSeats: nextIds.length,
        shareAutoGroupKey: nextGroupKey,
        fare: nextTotalFare,
        baseFare: nextTotalFare,
        shareAutoFareRebalance: {
          ...rebalance,
          active: false,
        },
      }, () => {
        setCurrentRide(null);
      });
    };

    applyFareRebalance().catch(() => {});
  }, [currentRide]);

  const getLocalDateKey = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = `${now.getMonth() + 1}`.padStart(2, '0');
    const d = `${now.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${d}`;
  };
  const getDriverDestinationToggleUsageStorageKey = () => `driver_destination_toggle_usage_${currentUserId || 'guest'}`;
  const todayDateKey = getLocalDateKey();
  const driverDestinationToggleUsesToday = driverDestinationToggleUsageDate === todayDateKey ? driverDestinationToggleUsageCount : 0;
  const driverDestinationToggleUsesLeft = Math.max(0, DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT - driverDestinationToggleUsesToday);

  const persistDriverDestinationToggleUsage = async (nextDate: string, nextCount: number) => {
    setDriverDestinationToggleUsageDate(nextDate);
    setDriverDestinationToggleUsageCount(nextCount);
    if (!currentUserId) return;
    try {
      await AsyncStorage.setItem(
        getDriverDestinationToggleUsageStorageKey(),
        JSON.stringify({ date: nextDate, count: nextCount })
      );
    } catch {
      // Ignore storage errors; runtime state still enforces the limit for this session.
    }
  };

  const canUseDriverDestinationToggleToday = () => {
    const today = getLocalDateKey();
    const usedToday = driverDestinationToggleUsageDate === today ? driverDestinationToggleUsageCount : 0;
    return usedToday < DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT;
  };

  const runLocationSearch = useCallback(async (field: 'pickup' | 'drop', query: string) => {
    const trimmed = query.trim();
    const requestId = suggestionRequestIdRef.current + 1;
    suggestionRequestIdRef.current = requestId;
    const recentFallback = recentSearchSuggestions
      .slice(0, 3)
      .map((item) => ({ ...item, placeType: RECENT_SEARCH_SUGGESTION_TYPE }));

    if (trimmed.length < 2 || trimmed.toLowerCase() === 'current location') {
      setSearchSuggestions(recentFallback);
      setIsLoadingSuggestions(false);
      setSearchSuggestionState(recentFallback.length ? 'ready' : 'idle');
      setSearchSuggestionMessage(recentFallback.length ? 'Previous searches' : '');
      setActiveSearchField(field);
      return;
    }

    setIsLoadingSuggestions(true);
    setSearchSuggestionState('loading');
    setSearchSuggestionMessage('');
    const result = await searchHyderabadLocationsDetailed(trimmed);
    if (suggestionRequestIdRef.current !== requestId) return;

    const nextSuggestions = result.results.length ? result.results : recentFallback;
    setSearchSuggestions(nextSuggestions);
    setIsLoadingSuggestions(false);
    if (result.error === 'network') {
      setSearchSuggestionState('error');
      setSearchSuggestionMessage('Could not load locations right now. Check your connection and try again.');
    } else if (!result.results.length) {
      setSearchSuggestionState(recentFallback.length ? 'ready' : 'empty');
      setSearchSuggestionMessage(recentFallback.length ? 'Previous searches' : 'No locations found');
    } else {
      setSearchSuggestionState('ready');
      setSearchSuggestionMessage('');
    }
    setActiveSearchField(field);
  }, [recentSearchSuggestions]);

  const debouncedLocationSearch = useMemo(
    () => debounce((field: 'pickup' | 'drop', query: string) => {
      void runLocationSearch(field, query);
    }, 500),
    [runLocationSearch]
  );

  useEffect(() => () => {
    debouncedLocationSearch.cancel();
  }, [debouncedLocationSearch]);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(RECENT_SEARCHES_KEY)
      .then((raw) => {
        if (!raw || !alive) return;
        const parsed = JSON.parse(raw) as StoredLocationSuggestion[];
        if (Array.isArray(parsed)) {
          setRecentSearchSuggestions(parsed.slice(0, 10));
        }
      })
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, []);

  const saveRecentSearchSuggestion = useCallback(async (suggestion: LocationSuggestion) => {
    const storedSuggestion: StoredLocationSuggestion = {
      ...suggestion,
      placeType: suggestion.placeType === RECENT_SEARCH_SUGGESTION_TYPE ? undefined : suggestion.placeType,
      usedCount: 1,
      lastUsedAt: Date.now(),
    };

    const next = [
      storedSuggestion,
      ...recentSearchSuggestions.filter((item) => item.placeId !== suggestion.placeId),
    ]
      .map((item, index) => index === 0 ? item : { ...item })
      .sort((a, b) => ((b.usedCount || 1) - (a.usedCount || 1)) || ((b.lastUsedAt || 0) - (a.lastUsedAt || 0)))
      .slice(0, 10);

    const existing = recentSearchSuggestions.find((item) => item.placeId === suggestion.placeId);
    if (existing) {
      next[0] = {
        ...storedSuggestion,
        usedCount: (existing.usedCount || 1) + 1,
      };
      next.sort((a, b) => ((b.usedCount || 1) - (a.usedCount || 1)) || ((b.lastUsedAt || 0) - (a.lastUsedAt || 0)));
    }

    setRecentSearchSuggestions(next);
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch(() => {});
  }, [recentSearchSuggestions]);

  const handleSearchFieldFocus = useCallback((field: 'pickup' | 'drop') => {
    if (!isPassengerCardExpanded) animatePassengerCard(true);
    setActiveSearchField(field);
    const query = field === 'pickup' ? pickupInput : destination;
    void runLocationSearch(field, query);
  }, [animatePassengerCard, destination, isPassengerCardExpanded, pickupInput, runLocationSearch]);

  const handleLocationInputChange = useCallback((field: 'pickup' | 'drop', value: string) => {
    setActiveSearchField(field);
    setRouteDistanceKm(null);
    setRouteDurationSeconds(null);
    setRouteDistanceError('');
    setIsCalculatingFares(!!value.trim() && !!(field === 'pickup' ? destination : pickupInput).trim());

    if (field === 'pickup') {
      setPickupInput(value);
      setPickupCoords(null);
    } else {
      setDestination(value);
      setDestCoords(null);
    }

    debouncedLocationSearch(field, value);
  }, [debouncedLocationSearch, destination, pickupInput]);

  const applySearchSuggestion = async (field: 'pickup' | 'drop', suggestion: LocationSuggestion) => {
    setActiveSearchField(null);
    setSearchSuggestions([]);
    setIsLoadingSuggestions(false);
    setSearchSuggestionState('idle');
    setSearchSuggestionMessage('');
    setIsCalculatingFares(true);
    setRouteDistanceKm(null);
    setRouteDurationSeconds(null);
    setRouteDistanceError('');
    const coord = { latitude: suggestion.latitude, longitude: suggestion.longitude };

    if (!isWithinHyderabadService(coord)) {
      Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
      setIsCalculatingFares(false);
      return;
    }

    if (field === 'pickup') {
      setPickupInput(suggestion.displayName);
      setPickupCoords(coord);
    } else {
      setDestination(suggestion.displayName);
      setDestCoords(coord);
    }
    await saveRecentSearchSuggestion(suggestion);
    await playMarkerSound(400);
  };

  const handleSuggestionPress = useCallback((item: LocationSuggestion) => {
    if (activeSearchField) void applySearchSuggestion(activeSearchField, item);
  }, [activeSearchField, applySearchSuggestion]);

  const renderSuggestionItem = useCallback(({ item }: { item: LocationSuggestion }) => (
    <TouchableOpacity
      style={styles.searchSuggestionItem}
      activeOpacity={0.86}
      onPress={() => handleSuggestionPress(item)}
    >
      <View style={styles.searchSuggestionIconWrap}>
        <Ionicons
          name={item.placeType === RECENT_SEARCH_SUGGESTION_TYPE ? 'time-outline' : 'location-sharp'}
          size={17}
          color={item.placeType === RECENT_SEARCH_SUGGESTION_TYPE ? '#64748B' : '#2563EB'}
        />
      </View>
      <View style={styles.searchSuggestionTextWrap}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={styles.searchSuggestionTitle}>{item.title}</Text>
        {!!item.subtitle && (
          <Text numberOfLines={2} ellipsizeMode="tail" style={styles.searchSuggestionSubtitle}>{item.subtitle}</Text>
        )}
      </View>
    </TouchableOpacity>
  ), [handleSuggestionPress]);

  const getDistanceFromDriver = (ride: Ride) => {
    if (!location) return Number.POSITIVE_INFINITY;
    return calcDist(location, ride.pickup);
  };

  const getDemandLevel = () => getPricingDemandLevel(getDemandFactor);

  const getDemandFactor = () => {
    if (!location) return 0;
    
    // Calculate number of waiting passengers within 1.8km radius
    const nearbyWaitingUsers = rides.filter((r) => 
      r.status === 'waiting' && 
      calcDist(location, r.pickup) <= 1.8
    ).length;

    // Calculate number of online drivers within 1.8km radius
    const nearbyOnlineDrivers = allDrivers.filter((d) => 
      d.isOnline && 
      d.lastLocation && 
      calcDist(location, d.lastLocation) <= 1.8
    ).length;

    if (nearbyOnlineDrivers === 0) return 0; // Triggers 'low' demand logic as per requirement
    return nearbyWaitingUsers / nearbyOnlineDrivers;
  };

  const getNearbyActivePassengerCount = () => {
    const center = pickupCoords || location;
    if (!center) return 0;

    const nearbyPassengerIds = new Set<string>();
    rides.forEach((ride) => {
      if (ride.status !== 'waiting') return;
      if (calcDist(center, ride.pickup) > 4) return;
      nearbyPassengerIds.add(ride.passengerId || ride.id || `${ride.pickup.latitude}:${ride.pickup.longitude}`);
    });

    if (currentUserId) nearbyPassengerIds.add(currentUserId);
    return nearbyPassengerIds.size;
  };

  const getAppUserFactor = () => {
    // Proxy for active app users based on live ride documents.
    const activeUsers = rides.length;
    return Math.min(1, activeUsers / 30);
  };

  const getFinalDiscountRate = () => {
    const demandFactor = getDemandFactor();
    const appUserFactor = getAppUserFactor();
    const activityFactor = (demandFactor + appUserFactor) / 2;
    // Inverse relation: higher activity/users => lower discount (closer to 12.5%).
    return 0.16 - (0.035 * activityFactor); // 16% down to 12.5%
  };

  const roundToNearestFive = (value: number) => Math.round(value / 5) * 5;
  const roundToNearestFour = (value: number) => Math.round(value / 4) * 4;
  const applyBikeExtraDiscount = (value: number) => Math.max(0, Math.round(value * 0.96));
  const applyFinalDiscount = (value: number) => {
    const discountRate = getFinalDiscountRate();
    return Math.max(0, Math.round(value * (1 - discountRate)));
  };

  const isPeakHour = () => {
    const hour = new Date().getHours();
    return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21);
  };

  const isRainyTime = () => {
    const month = new Date().getMonth() + 1;
    return month >= 6 && month <= 9;
  };

  const isCabPeakHour = () => {
    const hour = new Date().getHours();
    return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 22);
  };

  const BIKE_FARE_TABLE = [
    { distanceKm: 1, normal: 18, peak: 25 },
    { distanceKm: 2, normal: 20, peak: 30 },
    { distanceKm: 3, normal: 24, peak: 40 },
    { distanceKm: 4, normal: 34, peak: 60 },
    { distanceKm: 5, normal: 38, peak: 72 },
    { distanceKm: 6, normal: 42, peak: 78 },
    { distanceKm: 7, normal: 65, peak: 87},
    { distanceKm: 8, normal: 80, peak: 98 },
    { distanceKm: 9, normal: 90, peak: 109 },
    { distanceKm: 10, normal: 102, peak: 130 },
    { distanceKm: 11, normal: 120, peak: 152 },
    { distanceKm: 12, normal: 130, peak: 162 },
    { distanceKm: 13, normal: 138, peak: 187 },
    { distanceKm: 14, normal: 150, peak: 200 },
    { distanceKm: 15, normal: 175, peak: 230 },
    { distanceKm: 16, normal: 190, peak: 250 },
    { distanceKm: 17, normal: 210, peak: 280 },
    { distanceKm: 18, normal: 230, peak: 290 },
  ] as const;

  const getBikeFareFromTable = (distanceKm: number, demandLevel: DemandLevel) => {
    const matchedRow = BIKE_FARE_TABLE.find((row) => distanceKm <= row.distanceKm);
    if (!matchedRow) return null;

    if (demandLevel === 'peak') return matchedRow.peak;
    return matchedRow.normal;
  };

  const getDynamicBikeFare = (distanceKm: number) => {
    const now = new Date().getHours();
    return calculateRideFare('bike', distanceKm, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now, getNearbyActivePassengerCount()).finalFare;
  };

  const getDynamicParcelFare = (distanceKm: number) => {
    const bikeFare = getDynamicBikeFare(distanceKm);
    return roundToNearestFive(Math.max(0, Math.round(bikeFare * 0.45)));
  };

  const getDynamicAutoFare = (distanceKm: number) => {
    const now = new Date().getHours();
    return calculateRideFare('auto', distanceKm, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now, getNearbyActivePassengerCount()).finalFare;
  };

  const getDynamicCabFare = (distanceKm: number) => {
    const now = new Date().getHours();
    return calculateRideFare('car', distanceKm, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now).finalFare;
  };

  const getShareAutoDemandIncreaseRate = () => {
    const demandLevel = getDemandLevel();
    if (demandLevel === 'low') return 0.10;
    if (demandLevel === 'normal') return 0.12;
    if (demandLevel === 'high') return 0.135;
    return 0.15;
  };

  const applyShareAutoDemandIncrease = (value: number) => {
    const increaseRate = getShareAutoDemandIncreaseRate();
    return Math.round(value * (1 + increaseRate));
  };

  const getShareAutoTwoPassengerFare = (distanceKm: number) => {
    const m = distanceKm < 2
      ? SHARE_AUTO_FARE_SETTINGS.twoPassenger.under2Km.baseM + Math.min(
          SHARE_AUTO_FARE_SETTINGS.twoPassenger.under2Km.maxIncrease,
          distanceKm * SHARE_AUTO_FARE_SETTINGS.twoPassenger.under2Km.increasePerKm
        )
      : SHARE_AUTO_FARE_SETTINGS.twoPassenger.over2Km.baseM + Math.min(
          SHARE_AUTO_FARE_SETTINGS.twoPassenger.over2Km.maxIncrease,
          Math.max(0, distanceKm - 2) * SHARE_AUTO_FARE_SETTINGS.twoPassenger.over2Km.increasePerKmAfter2
        );
    const kRaw = SHARE_AUTO_FARE_SETTINGS.twoPassenger.kFactor.base + (distanceKm * SHARE_AUTO_FARE_SETTINGS.twoPassenger.kFactor.perKm);
    const k = Math.round(kRaw / SHARE_AUTO_FARE_SETTINGS.twoPassenger.kFactor.roundStep) * SHARE_AUTO_FARE_SETTINGS.twoPassenger.kFactor.roundStep;
    return applyShareAutoDemandIncrease(Math.round(14 + (m * distanceKm) + k));
  };

  const getShareAutoFare = (distanceKm: number, passengerCount: number) => {
    if (passengerCount === 3) {
      const base = SHARE_AUTO_FARE_SETTINGS.threePassenger.baseFare;
      const perKm = SHARE_AUTO_FARE_SETTINGS.threePassenger.perKmRate;
      return applyShareAutoDemandIncrease(Math.round(base + distanceKm * perKm));
    }
    if (passengerCount === 2) return getShareAutoTwoPassengerFare(distanceKm);
    return fares.ShareAuto;
  };

  const clearShareAutoTimers = () => {
    if (shareAutoTimersRef.current.search) clearTimeout(shareAutoTimersRef.current.search);
    if (shareAutoTimersRef.current.fallback) clearTimeout(shareAutoTimersRef.current.fallback);
    shareAutoTimersRef.current = {};
  };

  const resetShareAutoSearch = () => {
    clearShareAutoTimers();
    setShareAutoSearchActive(false);
    setShareAutoSearchStartedAt(0);
    setShareAutoPoolId('');
    setShareAutoElapsed(0);
    setShareAutoFoundMembers(0);
    setShowShareAutoGame(false);
  };

  useEffect(() => {
    if (!shareAutoSearchActive) return;
    if (!userBookedRide?.id || userBookedRide.type !== 'ShareAuto') return;
    resetShareAutoSearch();
    setShowShareAutoFallback(false);
  }, [shareAutoSearchActive, userBookedRide?.id, userBookedRide?.type]);

  const startShareAutoFallback = (reason: string) => {
    setShareAutoFallbackReason(reason);
    setShowShareAutoFallback(true);
    resetShareAutoSearch();
  };

  const getRandomTargetPosition = () => ({
    x: Math.floor(Math.random() * 80) + 10,
    y: Math.floor(Math.random() * 60) + 15,
  });

  const hitBird = () => {
    if (gameTimeLeft <= 0) return;
    void playGameSound('birdHit');
    setBirdHits((prev) => prev + 1);
    setBirdTarget(getRandomTargetPosition());
  };

  const hitZombie = () => {
    void playGameSound('zombieHit');
    setZombieHits((prev) => prev + 1);
    setZombieTarget(getRandomTargetPosition());
  };

  const restartBirdGame = () => {
    void playGameSound('ui');
    setGameMode('bird');
    setGameTimeLeft(45);
    setBirdHits(0);
    setBirdTarget(getRandomTargetPosition());
  };

  const startZombieGame = () => {
    void playGameSound('ui');
    setGameMode('zombie');
    setZombieTarget(getRandomTargetPosition());
  };

  const cancelShareAutoSearch = async () => {
    try {
      if (shareAutoPoolId) {
        await deleteDoc(doc(db, 'shareAutoPools', shareAutoPoolId)).catch(() => undefined);
      }
    } finally {
      resetShareAutoSearch();
      setShowShareAutoFallback(false);
      setSelectedRide(null);
      setSearchTimer(0);
      setShareAutoElapsed(0);
      setShareAutoFoundMembers(0);
      Alert.alert('Cancelled', 'ShareAuto search has been stopped.');
    }
  };

  useEffect(() => {
    if (!shareAutoSearchActive || !shareAutoPoolId || !pickupCoords || !destCoords) return;

    const updateFoundMembers = async () => {
      try {
        const poolSnapshot = await getDocs(query(collection(db, 'shareAutoPools'), where('status', '==', 'searching')));
        const candidates = poolSnapshot.docs
          .map((d) => ({ id: d.id, ...d.data() } as ShareAutoPool))
          .filter((pool) => pool.id !== shareAutoPoolId)
          .map(toPoolPassenger);

        const selfPassenger: PoolPassenger = {
          id: currentUserId,
          name: profileName,
          phone: profilePhone,
          pickup: pickupCoords,
          drop: destCoords,
          pickupAddr: pickupInput,
          dropAddr: destination,
        };

        const matched = findShareAutoMatch(selfPassenger, candidates);
        setShareAutoFoundMembers(matched ? matched.passengers.length : 0);
      } catch {
        setShareAutoFoundMembers(0);
      }
    };

    updateFoundMembers();
    const interval = setInterval(updateFoundMembers, 8000);
    return () => clearInterval(interval);
  }, [shareAutoSearchActive, shareAutoPoolId, pickupCoords, destCoords, profileName, profilePhone, pickupInput, destination, currentUserId]);

  const getDriverNotificationStage = (ride: Ride) => {
    if (ride.type !== 'ShareAuto' || !location) return 99;
    const distance = getDistanceFromDriver(ride);
    if (distance <= 1.5) return 0;
    if (distance <= 3) return 1;
    return 2;
  };

  const isWithinDriverDestinationMarkerRadius = (ride: Ride) => {
    if (!driverDestinationFilterEnabled || !driverDestinationMarker) return true;
    return calcDist(ride.drop, driverDestinationMarker) <= DRIVER_DESTINATION_MARKER_RADIUS_KM;
  };

  const isParcelWithinCycleRadius = (ride: Ride) => {
    if (!location) return false;
    return calcDist(location, ride.pickup) <= 4 && calcDist(location, ride.drop) <= 4;
  };

  const isDriverEligibleForRide = useCallback((ride: Ride) => (
    ride.type === driverVehicle ||
    (driverVehicle === 'Auto' && ride.type === 'ShareAuto') ||
    (ride.type === 'Parcel' && (
      driverVehicle === 'Bike' ||
      (driverVehicle === 'Cycle' && isParcelWithinCycleRadius(ride))
    ))
  ), [driverVehicle, location]);

  const visibleDriverRides = useMemo(() => {
    if (!driverOnline) return [];
    const reductionPercentage = getNotificationReductionPercentage();
    const ratingDelayMs = getRatingBasedDelay(driverStats.rating || 0);

    return rides
      .filter((ride) => isDriverEligibleForRide(ride) && !ignoredRides.includes(ride.id!) && isFreshWaitingRide(ride))
      .filter((ride) => isWithinDriverDestinationMarkerRadius(ride))
      .filter((ride) => ride.type !== 'ShareAuto' || !location || getDistanceFromDriver(ride) <= 3)
      .filter((ride) => {
        const createdAtMs = getRideCreatedAtMs(ride.createdAt);
        if (!createdAtMs) return true;
        return (Date.now() - createdAtMs) >= ratingDelayMs;
      })
      .filter((ride) => {
        const maxFare = getMaxFareForBehaviorReport();
        if (maxFare === 0) return true;
        return ride.fare <= maxFare;
      })
      .filter((ride) => shouldSurfaceRideUnderReduction(ride.id || '', reductionPercentage))
      .reduce((list, ride) => {
        if (ride.type !== 'ShareAuto') {
          list.push(ride);
          return list;
        }

        const groupKey = ride.shareAutoGroupKey || (ride.shareAutoPassengerIds || []).slice().sort().join('|');
        const existingIndex = list.findIndex((item) => {
          if (item.type !== 'ShareAuto') return false;
          const itemKey = item.shareAutoGroupKey || (item.shareAutoPassengerIds || []).slice().sort().join('|');
          return itemKey === groupKey;
        });

        if (existingIndex === -1) {
          list.push(ride);
          return list;
        }

        const existing = list[existingIndex];
        const existingCreated = existing.createdAt?.toMillis?.() || 0;
        const nextCreated = ride.createdAt?.toMillis?.() || 0;
        if (nextCreated > existingCreated) {
          list[existingIndex] = ride;
        }
        return list;
      }, [] as Ride[])
      .sort((a, b) => {
        const stageDiff = getDriverNotificationStage(a) - getDriverNotificationStage(b);
        if (stageDiff !== 0) return stageDiff;
        if (a.type === 'ShareAuto' && b.type === 'ShareAuto') return getDistanceFromDriver(a) - getDistanceFromDriver(b);
        return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
      });
  }, [driverOnline, rides, ignoredRides, location, isDriverEligibleForRide, driverStats.rating, driverStats.completed, driverStats.reportHistory]);

  const playChatSound = async () => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: CHAT_SOUND_URL },
        { shouldPlay: true, volume: 1 }
      );

      setTimeout(async () => {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore unload errors for short UI sounds
        }
      }, 1200);
    } catch {
      // ignore chat sound failures so messaging always works
    }
  };

  const playDriverAlertForTwoSeconds = async () => {
    if (alertPlayingRef.current) return;
    alertPlayingRef.current = true;
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: DRIVER_ALERT_SOUND_URL },
        { shouldPlay: true, isLooping: true, volume: 1 }
      );

      setTimeout(async () => {
        try {
          await sound.stopAsync();
          await sound.unloadAsync();
        } finally {
          alertPlayingRef.current = false;
        }
      }, 2000);
    } catch {
      alertPlayingRef.current = false;
    }
  };

  const playUiTapSound = async (type: 'vehicle' | 'cta') => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: type === 'vehicle' ? VEHICLE_SELECT_SOUND_URL : PRIMARY_ACTION_SOUND_URL },
        { shouldPlay: true, volume: 0.9 }
      );

      setTimeout(async () => {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore unload errors for short UI sounds
        }
      }, 900);
    } catch {
      // ignore UI sound failures so taps always work
    }
  };

  const playGameSound = async (type: 'birdHit' | 'zombieHit' | 'unlock' | 'ui') => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const soundUri =
        type === 'birdHit'
          ? GAME_BIRD_HIT_SOUND_URL
          : type === 'zombieHit'
            ? GAME_ZOMBIE_HIT_SOUND_URL
            : type === 'unlock'
              ? GAME_UNLOCK_SOUND_URL
              : PRIMARY_ACTION_SOUND_URL;

      const { sound } = await Audio.Sound.createAsync(
        { uri: soundUri },
        { shouldPlay: true, volume: type === 'unlock' ? 1 : 0.85 }
      );

      setTimeout(async () => {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore unload errors for short game sounds
        }
      }, 900);
    } catch {
      // ignore game sound failures so gameplay remains smooth
    }
  };

  const playMarkerSound = async (durationMs: number = 400) => {
    try {
      await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
      const { sound } = await Audio.Sound.createAsync(
        { uri: MARKER_PLACE_SOUND_URL },
        { shouldPlay: true, volume: 0.95 }
      );

      setTimeout(async () => {
        try {
          await sound.unloadAsync();
        } catch {
          // ignore unload errors for marker sounds
        }
      }, durationMs);
    } catch {
      // ignore marker sound failures so map interaction always works
    }
  };

  // PENALTY LOGIC APPLIED INDIVIDUALLY [cite: 173]
  const getPenaltyStatus = () => {
    const now = Date.now();
    const oneHrAgo = now - (1 * 60 * 60 * 1000);
    const twoHrsAgo = now - (2 * 60 * 60 * 1000);
    const threeHrsAgo = now - (3 * 60 * 60 * 1000);
    const fiveHrsAgo = now - (5 * 60 * 60 * 1000);
    const sixHrsAgo = now - (6 * 60 * 60 * 1000);
    const fifteenHrsAgo = now - (15 * 60 * 60 * 1000);
    const thirtyHrsAgo = now - (30 * 60 * 60 * 1000);
    const twelveHrsAgo = now - (12 * 60 * 60 * 1000);

    const cancelsLast15 = driverStats.cancelHistory.filter(t => t > fifteenHrsAgo).length;
    const cancelsLast30 = driverStats.cancelHistory.filter(t => t > thirtyHrsAgo).length;
    const reportsLast1Hr = driverStats.reportHistory.filter(t => t > oneHrAgo).length;
    const reportsLast5Hrs = driverStats.reportHistory.filter(t => t > fiveHrsAgo).length;
    const reportsLast2 = driverStats.reportHistory.filter(t => t > twoHrsAgo).length;
    const reportsLast3 = driverStats.reportHistory.filter(t => t > threeHrsAgo).length;
    const reportsLast6 = driverStats.reportHistory.filter(t => t > sixHrsAgo).length;

    if (driverStats.isPermanentlySuspended) return "PERMANENT";
    if (reportsLast6 >= 8) return "SUSPENDED_36_HOURS";
    if (reportsLast3 >= 7) return "SUSPENDED_2_HOURS";
    // NEW: If 3 or more bad reports in 5 hours, suspend for 12 hours
    if (reportsLast5Hrs >= 3) return "BEHAVIOR_SUSPENDED_12_HOURS";
    if (reportsLast2 >= 2) return "BEHAVIOR_WARNING";
    if (cancelsLast30 >= 20) return "SUSPENDED_2_DAYS";
    if (cancelsLast15 >= 13) return "BLOCKED_5_HOURS";
    if (cancelsLast15 >= 10) return "WARNING";
    
    return "CLEAR";
  };

  const penalty = getPenaltyStatus(); // Updated to ensure penalty is fetched correctly
  const reportsLast5Hours = useMemo(() => {
    const fiveHrsAgo = Date.now() - (5 * 60 * 60 * 1000);
    return driverStats.reportHistory.filter((t) => t > fiveHrsAgo).length;
  }, [driverStats.reportHistory]);
  const reportsLast1Hour = useMemo(() => {
    const oneHrAgo = Date.now() - (1 * 60 * 60 * 1000);
    return driverStats.reportHistory.filter((t) => t > oneHrAgo).length;
  }, [driverStats.reportHistory]);

  const behaviorRestrictionMessage = useMemo(() => {
    if (reportsLast5Hours >= 3) {
      return '3+ reports in last 5 hours: ride notifications reduced by 75% and rides above ₹100 are blocked.';
    }
    if (reportsLast5Hours >= 2 && reportsLast1Hour >= 1) {
      return '2 reports in last 5 hours: ride notifications reduced by 50% and rides above ₹250 are blocked for 1 hour.';
    }
    if (reportsLast5Hours >= 1) {
      return 'Behaviour report found. Next reports can reduce your notifications and suspend your account.';
    }
    return '';
  }, [reportsLast5Hours, reportsLast1Hour]);

  const handleCrewUnlock = () => {
    if (crewUnlockCode === "sorry123") {
      setDriverStats({
        ...driverStats,
        cancelled: 0,
        cancelHistory: [],
        reportHistory: [],
        isPermanentlySuspended: false
      });
      setCrewUnlockCode('');
      Alert.alert("Success", "Account Reactivated by Crew");
    } else {
      Alert.alert("Error", "Invalid Crew Code");
    }
  };

      // BEHAVIOR REPORT FILTERING: Reduce notifications based on report count
      function getMaxFareForBehaviorReport() {
        const now = Date.now();
        const oneHrAgo = now - (1 * 60 * 60 * 1000);
        const fiveHrsAgo = now - (5 * 60 * 60 * 1000);
        const reportsLast1Hr = driverStats.reportHistory.filter((t) => t > oneHrAgo).length;
        const reportsLast5Hrs = driverStats.reportHistory.filter(t => t > fiveHrsAgo).length;
    
        if (reportsLast5Hrs >= 3) return 100; // 75% reduction: only rides >100 rupees rejected
        if (reportsLast5Hrs >= 2 && reportsLast1Hr >= 1) return 250; // 50% reduction for next hour
        return 0; // No restrictions
      }

      function getNotificationReductionPercentage() {
        const now = Date.now();
        const oneHrAgo = now - (1 * 60 * 60 * 1000);
        const fiveHrsAgo = now - (5 * 60 * 60 * 1000);
        const reportsLast1Hr = driverStats.reportHistory.filter((t) => t > oneHrAgo).length;
        const reportsLast5Hrs = driverStats.reportHistory.filter(t => t > fiveHrsAgo).length;
    
        if (reportsLast5Hrs >= 3) return 0.75; // 75% reduction
        if (reportsLast5Hrs >= 2 && reportsLast1Hr >= 1) return 0.50; // 50% reduction for next hour
        return 0;
      }

      function shouldSurfaceRideUnderReduction(rideId: string, reduction: number) {
        if (!rideId || reduction <= 0) return true;
        const hash = rideId.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
        return (hash % 100) >= Math.round(reduction * 100);
      }

      // RATING-BASED NOTIFICATION DELAY: Higher rated drivers get rides first
      function getRatingBasedDelay(driverRating: number): number {
        // Only apply rating-based delay if driver has completed more than 8 rides
        if (driverStats.completed <= 8) return 0;
    
        if (driverRating > 4) return 0; // Immediate notification
        if (driverRating >= 2 && driverRating <= 4) return 3000; // 3 seconds delay
        if (driverRating < 2) return 5000; // 5 seconds delay
        return 0;
      }

  useEffect(() => {
    const cleanup = setInterval(async () => {
      try {
        const fiveMinsAgo = new Date(Date.now() - FIVE_MIN_MS);
        const q = query(collection(db, 'rides'), where('status', '==', 'waiting'));
        const snapshot = await getDocs(q);
        snapshot.forEach((d) => {
          if (d.data().createdAt?.toDate() < fiveMinsAgo) deleteDoc(doc(db, 'rides', d.id));
        });
      } catch {
        // Ignore transient cleanup failures (permissions/network).
      }
    }, 30000);
    return () => clearInterval(cleanup);
  }, []);

  useEffect(() => {
    let mounted = true;
    let locationSubscription: Location.LocationSubscription | null = null;
    const authUnsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[auth] state changed', { loggedIn: !!user, uid: user?.uid || null });
      if (!mounted) return;
      setLoggedIn(!!user);
      console.log('[navigation] auth state applied', { target: user ? 'RideAppScreen/home' : 'RideAppScreen/login' });
      if (!user) {
        try {
          await clearDriverIdentityOnThisDevice();
        } catch (error) {
          console.error('[auth] failed clearing signed-out state', error);
        }
        setProfileName('');
        setProfileNameEdit('');
        setProfilePhone('');
        setProfileEarnWallet(0);
        setHomeLocation(null);
        setHomeLocationLabel('');
        return;
      }

      try {
        await ensureDeviceInstallId();
        const authPhone = normalizePhoneDigits(user.phoneNumber || mobileNumber);
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (!mounted) return;
        if (userSnap.exists()) {
          const userData = userSnap.data() as { name?: string; phone?: string; email?: string; earnWallet?: number; earnWithdrawMobile?: string; homeLocation?: Coord; homeLocationLabel?: string };
          const storedPhone = normalizePhoneDigits(userData.phone || authPhone);
          const storedName = userData.name || nameForSignup || '';
          setProfileName(storedName);
          setProfileNameEdit(storedName);
          setProfilePhone(storedPhone || '');
          setEmail(userData.email || user.email || '');
          setProfileEarnWallet(userData.earnWallet || 0);
          setEarnWithdrawMobile(userData.earnWithdrawMobile || storedPhone || '');
          setHomeLocation(userData.homeLocation || null);
          setHomeLocationLabel(userData.homeLocationLabel || '');
          if (authPhone && (!userData.phone || userData.phone !== authPhone)) {
            setDoc(doc(db, 'users', user.uid), { phone: authPhone }, { merge: true }).catch(() => {});
          }
          if (storedPhone) {
            const claimDevice = otpClaimPhoneRef.current === storedPhone;
            await syncDriverRecordForPhone(storedPhone, { userId: user.uid, nameFallback: storedName, claimDevice });
            if (claimDevice) otpClaimPhoneRef.current = '';
          }
        } else {
          const fallbackName = nameForSignup || '';
          if (authPhone) {
            await setDoc(doc(db, 'users', user.uid), {
              phone: authPhone,
              name: fallbackName,
              createdAt: Timestamp.now(),
            }, { merge: true });
          }
          setProfileName(fallbackName);
          setProfileNameEdit(fallbackName);
          setProfilePhone(authPhone || '');
          setEmail(user.email || '');
          setProfileEarnWallet(0);
          setHomeLocation(null);
          setHomeLocationLabel('');
          if (authPhone) {
            const claimDevice = otpClaimPhoneRef.current === authPhone;
            await syncDriverRecordForPhone(authPhone, { userId: user.uid, nameFallback: fallbackName, claimDevice });
            if (claimDevice) otpClaimPhoneRef.current = '';
          }
        }
        console.log('[auth] profile hydration completed');
      } catch (error) {
        console.error('[auth] profile hydration failed', error);
        if (!mounted) return;
        setProfileName('');
        setProfileNameEdit('');
        setProfilePhone('');
        setEmail(user.email || '');
        setProfileEarnWallet(0);
        setHomeLocation(null);
        setHomeLocationLabel('');
      }
    });

    const init = async () => {
      try {
        console.log('[startup] RideAppScreen init started');
        const savedVehicle = await AsyncStorage.getItem('driver_vehicle');
        if (mounted && savedVehicle) {
          if (savedVehicle === 'Bike' || savedVehicle === 'Cycle' || savedVehicle === 'Auto' || savedVehicle === 'Cab') {
            setDriverVehicle(savedVehicle as DriverVehicleType);
          } else if (savedVehicle === 'ShareAuto') {
            setDriverVehicle('Auto');
          }
        }

        const savedFarePenalty = await AsyncStorage.getItem('fare_penalty');
        if (mounted && savedFarePenalty) setFarePenalty(parseInt(savedFarePenalty) || 0);

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const applyResolvedLocation = (pos: Coord) => {
            if (!mounted) return;
            const quickArea = getNearestPopularArea(pos);
            setLocation(pos);
            setPickupCoords((prev) => prev || pos);
            setPickupInput((prev) => (prev === 'Current Location' ? quickArea : prev));
            setIsFetchingCurrentLocation(false);

            getAreaLabelFromCoord(pos, quickArea).then((pickupArea) => {
              if (!mounted) return;
              setPickupInput((prev) => (prev === 'Current Location' || prev === quickArea ? pickupArea : prev));
            });
          };

          const lastKnown = await Location.getLastKnownPositionAsync({});
          if (lastKnown) {
            applyResolvedLocation({ latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude });
          }

          try {
            const initial = await Promise.race<Location.LocationObject | null>([
              Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }),
              new Promise<Location.LocationObject | null>((resolve) => setTimeout(() => resolve(null), 4500)),
            ]);

            if (initial) {
              applyResolvedLocation({ latitude: initial.coords.latitude, longitude: initial.coords.longitude });
            }
          } catch {
            if (mounted && !lastKnown) setIsFetchingCurrentLocation(false);
          }

          locationSubscription = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Highest, distanceInterval: 5, timeInterval: 1000 }, (loc) => {
            if (!mounted) return;
            setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
          });
        } else if (mounted) {
          setIsFetchingCurrentLocation(false);
        }
        console.log('[startup] RideAppScreen init completed');
      } catch (error) {
        console.error('[startup] RideAppScreen init failed', error);
        if (mounted) setIsFetchingCurrentLocation(false);
        // Keep app functional even when location/storage services fail.
      }
    };
    init();

    return () => {
      mounted = false;
      authUnsubscribe();
      locationSubscription?.remove();
    };
  }, [clearDriverIdentityOnThisDevice, ensureDeviceInstallId, mobileNumber, nameForSignup, normalizePhoneDigits, syncDriverRecordForPhone]);

  useEffect(() => {
    let mounted = true;
    const loadDriverDestinationToggleUsage = async () => {
      const today = getLocalDateKey();
      if (!currentUserId) {
        if (!mounted) return;
        setDriverDestinationToggleUsageDate(today);
        setDriverDestinationToggleUsageCount(0);
        return;
      }

      try {
        const raw = await AsyncStorage.getItem(getDriverDestinationToggleUsageStorageKey());
        if (!mounted) return;

        if (!raw) {
          setDriverDestinationToggleUsageDate(today);
          setDriverDestinationToggleUsageCount(0);
          return;
        }

        const parsed = JSON.parse(raw) as { date?: string; count?: number };
        const storedDate = parsed?.date || today;
        const storedCount = Number.isFinite(parsed?.count) ? Math.max(0, parsed.count as number) : 0;

        if (storedDate === today) {
          setDriverDestinationToggleUsageDate(storedDate);
          setDriverDestinationToggleUsageCount(storedCount);
          return;
        }

        setDriverDestinationToggleUsageDate(today);
        setDriverDestinationToggleUsageCount(0);
      } catch {
        if (!mounted) return;
        setDriverDestinationToggleUsageDate(today);
        setDriverDestinationToggleUsageCount(0);
      }
    };

    loadDriverDestinationToggleUsage();

    return () => {
      mounted = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    if (!activeRide?.id) {
      setChatMessages([]);
      setHasUnreadChat(false);
      chatLastMessageAtRef.current = 0;
      chatListenerHydratedRef.current = false;
      setChatTargetPassengerId('ALL');
      return;
    }

    chatLastMessageAtRef.current = 0;
    chatListenerHydratedRef.current = false;

    return onSnapshot(collection(db, 'rides', activeRide.id, 'messages'), (snapshot) => {
      const fullList = snapshot.docs
        .map(d => {
          const data = d.data() as Partial<ChatMessage> & { sender?: string; senderName?: string };
          const senderId = data.senderId || data.sender || '';
          return {
            ...data,
            senderId,
            senderRole: data.senderRole || (senderId === currentUserId ? mode : mode === 'USER' ? 'DRIVER' : 'USER'),
            senderName: data.senderName,
            createdAt: typeof data.createdAt === 'number' ? data.createdAt : 0,
          } as ChatMessage;
        })
        .sort((a, b) => a.createdAt - b.createdAt);

      const list = fullList.filter((message) => {
        if (mode !== 'USER') return true;
        if (activeRide.type !== 'ShareAuto') return true;
        if (!message.targetPassengerId) return true;
        return message.targetPassengerId === currentUserId || message.senderId === currentUserId;
      });

      setChatMessages(list);

      const last = list[list.length - 1];
      if (last) {
        const isNewMessage = last.createdAt > chatLastMessageAtRef.current;
        if (chatListenerHydratedRef.current && isNewMessage && last.senderId !== currentUserId) {
          playChatSound();
        }
        chatLastMessageAtRef.current = Math.max(chatLastMessageAtRef.current, last.createdAt);
      }
      chatListenerHydratedRef.current = true;

      if (!chatOpen && last && last.senderRole !== mode) {
        setHasUnreadChat(true);
      }
    }, () => {
      // Ignore chat stream permission/network errors.
    });
  }, [activeRide?.id, chatOpen, mode]);

  useEffect(() => {
    if (chatOpen) setHasUnreadChat(false);
  }, [chatOpen]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !activeRide || activeRide.type !== 'ShareAuto') {
      setChatTargetPassengerId('ALL');
      return;
    }

    const firstPassenger = activeRide.shareAutoPassengerIds?.[0] || 'ALL';
    setChatTargetPassengerId(firstPassenger);
  }, [mode, activeRide?.id, activeRide?.type]);

  useEffect(() => {
    const shouldAnimate = mode === 'USER' && userBookedRide?.status === 'accepted' && userBookedRide?.type === 'ShareAuto';
    if (!shouldAnimate) {
      arrivalAutoPulse.stopAnimation();
      arrivalAutoPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(arrivalAutoPulse, { toValue: 1, duration: 750, useNativeDriver: true }),
        Animated.timing(arrivalAutoPulse, { toValue: 0, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mode, userBookedRide?.status, userBookedRide?.type, arrivalAutoPulse]);

  useEffect(() => {
    if (mode !== 'USER' || userBookedRide?.status !== 'started') {
      journeyAnim.stopAnimation();
      journeyAnim.setValue(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentQuoteIndex((prev) => (prev + 1) % journeyQuotes.length);
    }, 4500);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(journeyAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(journeyAnim, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
      clearInterval(interval);
      journeyAnim.setValue(0);
    };
  }, [mode, userBookedRide?.status, journeyAnim, journeyQuotes.length]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !currentRide || currentRide.type !== 'ShareAuto' || currentRide.status !== 'accepted') return;

    const passengerCount = currentRide.shareAutoPassengerIds?.length || 0;
    const pickupDone = currentRide.shareAutoPickupCompletedIds || [];
    const dropDone = currentRide.shareAutoDropCompletedIds || [];
    const pickupPhase = pickupDone.length < passengerCount;

    const activeList = pickupPhase
      ? getOrderedSharePassengers(currentRide).filter((p) => !pickupDone.includes(p.id))
      : getOrderedShareDropPassengers(currentRide).filter((p) => !dropDone.includes(p.id));

    if (!activeList.some((p) => p.id === selectedSharePassengerId)) {
      setSelectedSharePassengerId(activeList[0]?.id || '');
    }
  }, [mode, currentRide, location, selectedSharePassengerId]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !currentRide?.id || !location) return;
    updateRideSafely(currentRide.id, { driverLocation: location }, () => {
      setCurrentRide(null);
    }).catch(() => undefined);
  }, [mode, currentRide?.id, location]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !currentUserId) return;
    const q = query(collection(db, 'rideHistory'), where('driverId', '==', currentUserId));
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RideHistory));
      list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setDriverHistory(list);
      maybeOpenRideBillFromHistory(list, 'DRIVER');
      const payableAmount = list.reduce((sum, item) => sum + (item.appFeeToApp || 0), 0);
      setDriverPayableToApp(Math.max(0, Math.round(payableAmount)));
      const pickupTimes = list
        .filter((item) => item.status === 'completed' && typeof item.pickupReachMinutes === 'number' && item.pickupReachMinutes > 0)
        .map((item) => item.pickupReachMinutes as number);
      const avgPickupMinutes = pickupTimes.length
        ? Math.round(pickupTimes.reduce((sum, mins) => sum + mins, 0) / pickupTimes.length)
        : 0;
      setDriverAvgPickupMinutes(avgPickupMinutes);
    }, () => {
      setDriverHistory([]);
      setDriverPayableToApp(0);
      setDriverAvgPickupMinutes(0);
    });
  }, [mode, currentUserId]);

  useEffect(() => {
    if (mode !== 'USER' || !currentUserId) {
      setPassengerHistory([]);
      return;
    }
    const q = query(collection(db, 'rideHistory'), where('passengerId', '==', currentUserId));
    return onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RideHistory));
      list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setPassengerHistory(list);
      maybeOpenRideBillFromHistory(list, 'PASSENGER');
    }, () => {
      setPassengerHistory([]);
    });
  }, [mode, currentUserId, maybeOpenRideBillFromHistory]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !driverOnline || !driverVehicle || !isIdentitySet || !!currentRide) return;

    const freshRideIds = rides
      .filter(r => isDriverEligibleForRide(r) && !ignoredRides.includes(r.id || '') && isFreshWaitingRide(r))
      .filter((r) => isWithinDriverDestinationMarkerRadius(r))
      .map(r => r.id)
      .filter((id): id is string => !!id);

    const activeIdSet = new Set(freshRideIds);
    alertedRideIdsRef.current.forEach((id) => {
      if (!activeIdSet.has(id)) alertedRideIdsRef.current.delete(id);
    });

    const hasNewRide = freshRideIds.some((id) => !alertedRideIdsRef.current.has(id));
    if (hasNewRide) {
      freshRideIds.forEach((id) => alertedRideIdsRef.current.add(id));
      playDriverAlertForTwoSeconds();
    }
  }, [mode, driverOnline, driverVehicle, isIdentitySet, currentRide, rides, ignoredRides, driverDestinationFilterEnabled, driverDestinationMarker]);

  useEffect(() => {
    return onSnapshot(collection(db, 'rides'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Ride));
      setRides(list);
      if (userBookedRide?.id) {
        const nextRide = list.find(r => r.id === userBookedRide.id) || null;
        setUserBookedRide(nextRide && isActiveRideStatus(nextRide.status) ? nextRide : null);
      } else if (currentUserId) {
        const nextRide = list.find(r =>
          r.passengerId === currentUserId ||
          r.comboParcelSenderId === currentUserId ||
          r.shareAutoPassengerIds?.includes(currentUserId)
        ) || null;
        setUserBookedRide(nextRide && isActiveRideStatus(nextRide.status) ? nextRide : null);
      }
      if (currentRide?.id) {
        const nextDriverRide = list.find(r => r.id === currentRide.id) || null;
        setCurrentRide(nextDriverRide && isActiveRideStatus(nextDriverRide.status) ? nextDriverRide : null);
      }
    }, () => {
      setRides([]);
    });
  }, [userBookedRide?.id, currentRide?.id, currentUserId]);

  useEffect(() => {
    // Subscription to online drivers for demand calculation.
    // Note: This requires appropriate Firestore security rules to allow reading basic driver info.
    return onSnapshot(collection(db, 'drivers'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Driver));
      setAllDrivers(list);
    }, () => {
      setAllDrivers([]);
    });
  }, []);

  useEffect(() => {
    // If current user is a driver and online, periodically update their location in the 'drivers' collection
    // so that other users can see them and the demand factor is accurate.
    if (mode !== 'DRIVER' || !driverDocId || !location || !driverOnline) return;

    const updateDriverLocation = async () => {
      try {
        await updateDoc(doc(db, 'drivers', driverDocId), {
          lastLocation: location,
          isOnline: driverOnline,
          lastActiveAt: Timestamp.now()
        });
      } catch (error) {
        console.warn('[driver] failed to update location in drivers collection', error);
      }
    };

    updateDriverLocation();
  }, [mode, driverDocId, location, driverOnline]);

  useEffect(() => {
    if (!userBookedRide?.id || userBookedRide.type !== 'ShareAuto' || !currentUserId) return;

    return onSnapshot(doc(db, 'rides', userBookedRide.id), (snapshot) => {
      if (snapshot.exists()) {
        const updatedRide = { id: snapshot.id, ...snapshot.data() } as Ride;
        if (isActiveRideStatus(updatedRide.status)) {
          setUserBookedRide(updatedRide);
        } else {
          setUserBookedRide(null);
        }
      }
    }, () => {});
  }, [userBookedRide?.id, currentUserId]);

  useEffect(() => {
    if (!userBookedRide?.id || userBookedRide.type !== 'ShareAuto' || !currentUserId) return;

    return onSnapshot(doc(db, 'rideAcceptanceBroadcast', `${userBookedRide.id}_${currentUserId}`), (snapshot) => {
      if (snapshot.exists()) {
        const broadcastData = snapshot.data();
        if (broadcastData?.status === 'accepted' && userBookedRide?.id === broadcastData?.rideId) {
          setUserBookedRide((prev) => prev ? { ...prev, status: 'accepted' as const } : null);
        }
      }
    }, () => {});
  }, [userBookedRide?.id, currentUserId]);

  useEffect(() => {
    if (!shareAutoSearchActive || !shareAutoPoolId) return;

    const scanShareAutoMatch = async (options: { allowPartialMatch: boolean; isFallbackAttempt: boolean }) => {
      if (!pickupCoords || !destCoords || !profileName || !profilePhone || shareAutoMatchInFlightRef.current) return;

      shareAutoMatchInFlightRef.current = true;
      try {
        const poolSnapshot = await getDocs(query(collection(db, 'shareAutoPools'), where('status', '==', 'searching')));
        const allPools = poolSnapshot.docs.map((d) => ({ id: d.id, ...d.data() } as ShareAutoPool));
        const candidates = allPools
          .filter((pool) => pool.id !== shareAutoPoolId)
          .map(toPoolPassenger);

        const selfPassenger: PoolPassenger = {
          id: currentUserId,
          name: profileName,
          phone: profilePhone,
          pickup: pickupCoords,
          drop: destCoords,
          pickupAddr: pickupInput,
          dropAddr: destination,
        };

        const matched = findShareAutoMatch(selfPassenger, candidates);
        const selectedPassengers = matched ? [selfPassenger, ...matched.passengers] : [];
        const passengerCount = selectedPassengers.length;
        setShareAutoFoundMembers(passengerCount);

        if (matched && (passengerCount >= 3 || options.allowPartialMatch)) {
          setShowShareAutoGame(false);
          setShareAutoGamePausedByRide(true);

          const passengerDistances = await Promise.all(
            selectedPassengers.map(async (p) => (await getRouteDistance(p.pickup, p.drop)).distanceKm)
          );
          const baseDistance = passengerDistances.reduce((sum, x) => sum + x, 0) / passengerCount;
          const baseFare = getShareAutoFare(baseDistance, passengerCount);

          const passengerFares = passengerDistances.map((distance) => {
            const ratio = Math.max(0.85, Math.min(1.2, distance / Math.max(baseDistance, 0.5)));
            return Math.round(baseFare * ratio);
          });
          const totalFare = passengerFares.reduce((sum, fare) => sum + fare, 0);
          const shareAutoGroupKey = selectedPassengers.map((p) => p.id).slice().sort().join('|');
          const passengerEncryptedOtps = selectedPassengers.map(() => encryptOTP(generateOTP()));

          const waitingRidesSnapshot = await getDocs(query(collection(db, 'rides'), where('status', '==', 'waiting')));
          const existingGroupedRide = waitingRidesSnapshot.docs
            .map((d) => ({ id: d.id, ...d.data() } as Ride))
            .find((ride) => ride.type === 'ShareAuto' && (
              ride.shareAutoGroupKey === shareAutoGroupKey ||
              ((ride.shareAutoPassengerIds || []).slice().sort().join('|') === shareAutoGroupKey)
            ));

          if (existingGroupedRide?.id) {
            await deleteDoc(doc(db, 'shareAutoPools', shareAutoPoolId)).catch(() => undefined);
            setUserBookedRide(existingGroupedRide);
            Alert.alert('Congratulations', 'All passengers found. Waiting for driver acceptance.');
            resetShareAutoSearch();
            return;
          }

          const rideData: Ride = {
            type: 'ShareAuto',
            fare: totalFare,
            baseFare: totalFare,
            tip: 0,
            distance: passengerDistances.reduce((sum, x) => sum + x, 0) / passengerDistances.length,
            pickup: pickupCoords,
            drop: destCoords,
            pickupAddr: pickupInput,
            dropAddr: destination,
            encryptedOTP: encryptOTP(generateOTP()),
            passengerId: currentUserId,
            passengerName: profileName,
            passengerPhone: profilePhone,
            shareAutoPassengerIds: selectedPassengers.map((p) => p.id),
            shareAutoPassengerNames: selectedPassengers.map((p) => p.name),
            shareAutoPassengerPhones: selectedPassengers.map((p) => p.phone),
            shareAutoPassengerPickups: selectedPassengers.map((p) => p.pickup),
            shareAutoPassengerDrops: selectedPassengers.map((p) => p.drop),
            shareAutoPassengerPickupAddrs: selectedPassengers.map((p) => p.pickupAddr || 'Pickup'),
            shareAutoPassengerDropAddrs: selectedPassengers.map((p) => p.dropAddr || 'Drop'),
            shareAutoPassengerDistances: passengerDistances,
            shareAutoPassengerFares: passengerFares,
            shareAutoPassengerEncryptedOTPs: passengerEncryptedOtps,
            shareAutoPickupCompletedIds: [],
            shareAutoDropCompletedIds: [],
            shareAutoSeats: passengerCount,
            shareAutoGroupKey,
            shareAutoMatchWay: matched.way,
            shareAutoRouteNote: `${matched.way}-Way group formed. A-Way is always prioritized when available.`,
            status: 'waiting',
            createdAt: Timestamp.now()
          };

          const ref = await addDoc(collection(db, 'rides'), rideData);
          const rideWithId = { ...rideData, id: ref.id };
          setUserBookedRide(rideWithId);

          const selectedPassengerIds = new Set(selectedPassengers.map((p) => p.id));
          const docsToDelete = allPools.filter((pool) => selectedPassengerIds.has(pool.passengerId));
          await Promise.all(docsToDelete.map((docSnap) => deleteDoc(doc(db, 'shareAutoPools', docSnap.id!)).catch(() => undefined)));

          Alert.alert('Congratulations', 'All passengers found. Waiting for driver acceptance.');
          resetShareAutoSearch();
          return;
        }

        if (options.isFallbackAttempt) {
          await deleteDoc(doc(db, 'shareAutoPools', shareAutoPoolId)).catch(() => undefined);
          if (!matched) {
            startShareAutoFallback('No matching ShareAuto passengers were found within 3 minutes. Bike, Auto, or Cab is recommended for a faster trip.');
          }
        }
      } catch {
        setShareAutoFoundMembers(0);
      } finally {
        shareAutoMatchInFlightRef.current = false;
      }
    };

    const poolQuery = query(collection(db, 'shareAutoPools'), where('status', '==', 'searching'));
    const unsubPoolListener = onSnapshot(poolQuery, () => {
      void scanShareAutoMatch({ allowPartialMatch: false, isFallbackAttempt: false });
    }, () => {
      // Ignore listener errors to prevent noisy uncaught rejections.
    });

    void scanShareAutoMatch({ allowPartialMatch: false, isFallbackAttempt: false });

    shareAutoTimersRef.current.search = setTimeout(() => {
      void scanShareAutoMatch({ allowPartialMatch: true, isFallbackAttempt: false });
    }, 90 * 1000);

    shareAutoTimersRef.current.fallback = setTimeout(() => {
      void scanShareAutoMatch({ allowPartialMatch: true, isFallbackAttempt: true });
    }, 3 * 60 * 1000);

    return () => {
      unsubPoolListener();
      clearShareAutoTimers();
    };
  }, [shareAutoSearchActive, shareAutoPoolId, pickupCoords, destCoords, profileName, profilePhone, pickupInput, destination, fares.ShareAuto, currentUserId]);

  useEffect(() => {
    if (!shareAutoSearchActive) {
      setShareAutoElapsed(0);
      return;
    }

    setShareAutoElapsed(0);
    const interval = setInterval(() => {
      setShareAutoElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [shareAutoSearchActive]);

  useEffect(() => {
    if (!showShareAutoGame || shareAutoGamePausedByRide || gameMode !== 'bird') return;
    if (gameTimeLeft <= 0) return;

    const timer = setInterval(() => {
      setGameTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [showShareAutoGame, shareAutoGamePausedByRide, gameMode, gameTimeLeft]);

  useEffect(() => {
    if (!showShareAutoGame || shareAutoGamePausedByRide || gameMode !== 'bird') return;
    if (gameTimeLeft <= 0) return;

    const birdMotion = setInterval(() => {
      setBirdTarget(getRandomTargetPosition());
    }, 700);

    return () => clearInterval(birdMotion);
  }, [showShareAutoGame, shareAutoGamePausedByRide, gameMode, gameTimeLeft]);

  useEffect(() => {
    if (!showShareAutoGame || shareAutoGamePausedByRide || gameMode !== 'zombie') return;

    const zombieMotion = setInterval(() => {
      setZombieTarget(getRandomTargetPosition());
    }, 650);

    return () => clearInterval(zombieMotion);
  }, [showShareAutoGame, shareAutoGamePausedByRide, gameMode]);

  useEffect(() => {
    if (gameMode !== 'bird' || gameTimeLeft > 0 || zombieUnlocked) return;
    if (birdHits >= 60) {
      setZombieUnlocked(true);
      void playGameSound('unlock');
      Alert.alert('Great job!', 'You hit the bird 60 times. Zombie Shooter unlocked!');
    }
  }, [gameMode, gameTimeLeft, birdHits, zombieUnlocked]);

  useEffect(() => {
    if (!shareAutoSearchActive) {
      shareAutoPulse.stopAnimation();
      shareAutoPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shareAutoPulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(shareAutoPulse, { toValue: 0, duration: 700, useNativeDriver: true })
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shareAutoSearchActive, shareAutoPulse]);

  useEffect(() => {
    if (mode !== 'DRIVER') {
      driverPromoPulse.stopAnimation();
      driverPromoPulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(driverPromoPulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(driverPromoPulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [mode, driverPromoPulse]);

  useEffect(() => {
    let interval: any;
    if (userBookedRide?.status === 'waiting') {
      interval = setInterval(() => {
        setSearchTimer(prev => {
          const next = prev + 1;
          if (next <= 10) setSearchRadius(1.0);
          else if (next <= 18) setSearchRadius(2.0);
          else if (next <= 27) setSearchRadius(3.5);
          else if (next === 28 && userBookedRide.tip === 0) {
              clearInterval(interval);
              setShowTipModal(true); 
          }
          return next;
        });
      }, 1000);
      Animated.loop(Animated.sequence([
        Animated.timing(searchAnim, { toValue: 1.5, duration: 800, useNativeDriver: true }),
        Animated.timing(searchAnim, { toValue: 1, duration: 800, useNativeDriver: true })
      ])).start();
    } else {
      clearInterval(interval);
      searchAnim.setValue(1);
    }
    return () => clearInterval(interval);
  }, [userBookedRide?.status]);

  useEffect(() => {
    const requestId = routeRequestIdRef.current + 1;
    routeRequestIdRef.current = requestId;

    if (!pickupCoords || !destCoords) {
      setRouteDistanceKm(null);
      setRouteDurationSeconds(null);
      setRouteDistanceError('');
      setIsCalculatingFares(false);
      return;
    }

    setIsCalculatingFares(true);
    setRouteDistanceError('');

    getRouteDistance(pickupCoords, destCoords)
      .then((route) => {
        if (routeRequestIdRef.current !== requestId) return;

        const dist = route.distanceKm;
        const now = new Date().getHours();
        const nearbyActivePassengers = getNearbyActivePassengerCount();

        setRouteDistanceKm(dist);
        setRouteDurationSeconds(route.durationSeconds);
        setFares({
          Bike: calculateRideFare('bike', dist, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now, nearbyActivePassengers).finalFare,
          Auto: calculateRideFare('auto', dist, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now, nearbyActivePassengers).finalFare,
          Cab: calculateRideFare('car', dist, 0, 0, PASSENGER_QUOTE_DEMAND_LEVEL, now).finalFare,
          ShareAuto: getShareAutoFare(dist, 3),
          Parcel: getDynamicParcelFare(dist),
        });
        setIsCalculatingFares(false);
      })
      .catch(() => {
        if (routeRequestIdRef.current !== requestId) return;
        setRouteDistanceKm(null);
        setRouteDurationSeconds(null);
        setRouteDistanceError('Could not calculate road distance. Please check your connection and try again.');
        setIsCalculatingFares(false);
      });
  }, [destCoords, pickupCoords]);

  const isComboParcelSender = (ride: Ride | null) => !!ride && ride.comboMode === 'PARCEL_PLUS_BIKE' && ride.comboParcelSenderId === currentUserId;

  const getUserPerspectivePickup = (ride: Ride | null) => {
    if (!ride) return null;
    if (isComboParcelSender(ride)) return ride.comboParcelPickup || ride.pickup;
    return ride.pickup;
  };

  const getUserPerspectiveDrop = (ride: Ride | null) => {
    if (!ride) return null;
    if (isComboParcelSender(ride)) return ride.comboParcelDrop || ride.drop;
    return ride.drop;
  };

  const getUserPerspectivePickupAddr = (ride: Ride | null) => {
    if (!ride) return 'N/A';
    if (isComboParcelSender(ride)) return ride.comboParcelPickupAddr || ride.pickupAddr || 'Pickup';
    return ride.pickupAddr || 'Pickup';
  };

  const getUserPerspectiveDropAddr = (ride: Ride | null) => {
    if (!ride) return 'N/A';
    if (isComboParcelSender(ride)) return ride.comboParcelDropAddr || ride.dropAddr || 'Drop';
    return ride.dropAddr || 'Drop';
  };

  const getUserPerspectiveFare = (ride: Ride | null) => {
    if (!ride) return 0;
    if (isComboParcelSender(ride)) return ride.comboParcelFare || ride.fare;
    if (ride.type === 'ShareAuto') {
      const shareIndex = ride.shareAutoPassengerIds?.findIndex((id) => id === currentUserId) ?? -1;
      const shareFare = shareIndex >= 0 ? ride.shareAutoPassengerFares?.[shareIndex] : null;
      if (typeof shareFare === 'number') return shareFare;
    }
    return ride.fare;
  };

  const getUserRideLabel = (ride: Ride | null) => {
    if (!ride) return '';
    if (isComboParcelSender(ride)) return 'Parcel';
    return ride.type;
  };

  const getPickupReachMinutes = (ride: Ride) => {
    const acceptedAtMs = ride.acceptedAtMs || getRideCreatedAtMs(ride.createdAt);
    if (!acceptedAtMs) return 0;
    return Math.max(1, Math.round((Date.now() - acceptedAtMs) / 60000));
  };

  const getDirectionCosine = (aStart: Coord, aEnd: Coord, bStart: Coord, bEnd: Coord) => {
    const ax = aEnd.latitude - aStart.latitude;
    const ay = aEnd.longitude - aStart.longitude;
    const bx = bEnd.latitude - bStart.latitude;
    const by = bEnd.longitude - bStart.longitude;
    const aMag = Math.sqrt((ax * ax) + (ay * ay));
    const bMag = Math.sqrt((bx * bx) + (by * by));
    if (!aMag || !bMag) return -1;
    return ((ax * bx) + (ay * by)) / (aMag * bMag);
  };

  const isSameDirectionForCombo = (parcelPickup: Coord, parcelDrop: Coord, bikePickup: Coord, bikeDrop: Coord) => {
    const pickupGap = calcDist(parcelPickup, bikePickup);
    const dropGap = calcDist(parcelDrop, bikeDrop);
    const directionSimilarity = getDirectionCosine(parcelPickup, parcelDrop, bikePickup, bikeDrop);
    return pickupGap <= 3 && dropGap <= 5 && directionSimilarity >= 0.55;
  };

  const handleTip = async (amt: number) => {
    if (!userBookedRide?.id) return;
    const newFare = userBookedRide.baseFare + amt;
    await updateRideSafely(userBookedRide.id, { fare: newFare, tip: amt }, () => {
      setUserBookedRide(null);
    });
    setSearchRadius(6.0); 
    setShowTipModal(false);
  };

  const handleSearch = async (type: 'pickup' | 'drop', explicitQuery?: string) => {
    const queryStr = explicitQuery ?? (type === 'pickup' ? pickupInput : destination);
    if (!queryStr || queryStr === 'Current Location') return;
    setIsCalculatingFares(true);

    try {
      const res = await searchHyderabadLocationsDetailed(queryStr);
      const firstResult = res.results[0];

      if (!firstResult) {
        setIsCalculatingFares(false);
        Alert.alert(
          res.error === 'network' ? 'Search unavailable' : 'Location not found',
          res.error === 'network'
            ? 'Could not search locations right now. Please check your connection and try again.'
            : 'Please choose a suggestion or try a more specific Hyderabad location.'
        );
        return;
      }

      const coord = { latitude: firstResult.latitude, longitude: firstResult.longitude };
      if (!isWithinHyderabadService(coord)) {
        Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
        setIsCalculatingFares(false);
        return;
      }

      await playMarkerSound(400);
      if (type === 'pickup') {
        setPickupInput(firstResult.displayName);
        setPickupCoords(coord);
      } else {
        setDestination(firstResult.displayName);
        setDestCoords(coord);
      }
    } catch (error) {
      setIsCalculatingFares(false);
      Alert.alert('Search unavailable', 'Could not search locations right now. Please check your connection and try again.');
    }
  };

  const bookRide = async (
    rideType?: RideType,
    earnMeta?: {
      passengerName: string;
      passengerPhone: string;
      passengerEmail: string;
    }
  ) => {
    const rideChoice = rideType ?? selectedRide;
    if (!rideChoice) {
      setBookingValidation({ visible: true, title: 'Select a vehicle', message: 'Please choose a vehicle type (Bike, Auto, Cab) before booking. Tap the vehicle icon to select.' });
      return;
    }
    if (!pickupCoords || !destCoords) {
      setBookingValidation({ visible: true, title: 'Add pickup & drop', message: 'Please set both pickup and drop locations so we can find nearby drivers for your trip.' });
      return;
    }
    if (!isWithinHyderabadService(pickupCoords) || !isWithinHyderabadService(destCoords)) {
      Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
      return;
    }
    let tripDistanceKm: number;
    let tripDurationSeconds = routeDurationSeconds;
    if (typeof routeDistanceKm === 'number' && routeDistanceKm > 0) {
      tripDistanceKm = routeDistanceKm;
    } else {
      try {
        const route = await getRouteDistance(pickupCoords, destCoords);
        tripDistanceKm = route.distanceKm;
        tripDurationSeconds = route.durationSeconds;
        setRouteDistanceKm(route.distanceKm);
        setRouteDurationSeconds(route.durationSeconds);
      } catch {
        Alert.alert('Route unavailable', 'Could not calculate road distance for this trip. Please check your connection and try again.');
        return;
      }
    }
    if (!profileName || !profilePhone) {
      setBookingValidation({ visible: true, title: 'Profile required', message: 'Please sign in or create an account before booking. It only takes a moment.' });
      return;
    }

    if (rideChoice === 'ShareAuto') {
      if (tripDistanceKm < SHARE_AUTO_FARE_SETTINGS.minimumTripDistanceKm) {
        Alert.alert(
          'Minimum distance required',
          `ShareAuto can be booked only for trips of at least ${SHARE_AUTO_FARE_SETTINGS.minimumTripDistanceKm.toFixed(1)} km.`
        );
        return;
      }
      clearShareAutoTimers();
      setShareAutoPoolId('');
      setShareAutoSearchActive(true);
      setShareAutoSearchStartedAt(Date.now());
      setUserBookedRide(null);
      setShowShareAutoFallback(false);
      setShareAutoFallbackReason('');

      try {
        const poolRef = await addDoc(collection(db, 'shareAutoPools'), {
          passengerId: currentUserId,
          passengerName: profileName,
          passengerPhone: profilePhone,
          pickup: pickupCoords,
          drop: destCoords,
          routeDurationSeconds: tripDurationSeconds,
          pickupAddr: pickupInput,
          dropAddr: destination,
          createdAt: Timestamp.now(),
          status: 'searching'
        });

        setShareAutoPoolId(poolRef.id);
      } catch {
        resetShareAutoSearch();
        Alert.alert('ShareAuto unavailable', 'Could not start ShareAuto search right now. Please try again.');
      }
      return;
    }

    if (rideChoice === 'Parcel') {
      const parcelFare = fares.Parcel;
      const parcelOtp = encryptOTP(generateOTP());

      const bikeQ = query(collection(db, 'rides'), where('status', '==', 'waiting'), where('type', '==', 'Bike'));
      const bikeSnapshot = await getDocs(bikeQ);
      const bikeCandidates = bikeSnapshot.docs
        .map((d) => ({ id: d.id, ...d.data() } as Ride))
        .filter((r) => r.passengerId && r.passengerId !== currentUserId)
        .filter((r) => !r.comboMode)
        .filter((r) => isSameDirectionForCombo(pickupCoords, destCoords, r.pickup, r.drop));

      bikeCandidates.sort((a, b) => {
        const aScore = calcDist(pickupCoords, a.pickup) + calcDist(destCoords, a.drop);
        const bScore = calcDist(pickupCoords, b.pickup) + calcDist(destCoords, b.drop);
        return aScore - bScore;
      });

      const matchedBikeRide = bikeCandidates[0];

      if (matchedBikeRide?.id) {
        const comboTotalFare = (matchedBikeRide.fare || 0) + parcelFare;
        let comboTotalDistance = tripDistanceKm;
        try {
          const [toPassengerPickup, passengerTrip, fromPassengerDrop] = await Promise.all([
            getRouteDistance(pickupCoords, matchedBikeRide.pickup),
            getRouteDistance(matchedBikeRide.pickup, matchedBikeRide.drop),
            getRouteDistance(matchedBikeRide.drop, destCoords),
          ]);
          comboTotalDistance = toPassengerPickup.distanceKm + passengerTrip.distanceKm + fromPassengerDrop.distanceKm;
        } catch {
          Alert.alert('Route unavailable', 'Could not calculate the full combo route distance. Please try again.');
          return;
        }

        await updateRideSafely(matchedBikeRide.id, {
          comboMode: 'PARCEL_PLUS_BIKE',
          comboParcelSenderId: currentUserId,
          comboParcelSenderName: profileName,
          comboParcelSenderPhone: profilePhone,
          comboParcelPickup: pickupCoords,
          comboParcelDrop: destCoords,
          comboParcelPickupAddr: pickupInput,
          comboParcelDropAddr: destination,
          comboParcelDistance: tripDistanceKm,
          comboParcelFare: parcelFare,
          comboParcelEncryptedOTP: parcelOtp,
          comboTotalFare,
          comboTotalDistance,
          comboStage: 'parcel_pickup',
          createdAt: Timestamp.now(),
        }, () => {
          Alert.alert('Ride unavailable', 'Matched bike ride is no longer available. Please retry.');
        });

        setUserBookedRide({
          ...matchedBikeRide,
          comboMode: 'PARCEL_PLUS_BIKE',
          comboParcelSenderId: currentUserId,
          comboParcelSenderName: profileName,
          comboParcelSenderPhone: profilePhone,
          comboParcelPickup: pickupCoords,
          comboParcelDrop: destCoords,
          comboParcelPickupAddr: pickupInput,
          comboParcelDropAddr: destination,
          comboParcelDistance: tripDistanceKm,
          comboParcelFare: parcelFare,
          comboParcelEncryptedOTP: parcelOtp,
          comboTotalFare,
          comboTotalDistance,
          comboStage: 'parcel_pickup',
        });
        return;
      }
    }

    const bFare = fares[rideChoice];
    const rideData: Ride = {
      type: rideChoice, fare: bFare, baseFare: bFare, tip: 0,
      distance: tripDistanceKm, pickup: pickupCoords, drop: destCoords,
      routeDurationSeconds: tripDurationSeconds,
      pickupAddr: pickupInput, dropAddr: destination, encryptedOTP: encryptOTP(generateOTP()),
      passengerId: currentUserId,
      passengerName: earnMeta?.passengerName || profileName,
      passengerPhone: earnMeta?.passengerPhone || profilePhone,
      ...(earnMeta
        ? {
            earnBookedByUserId: currentUserId,
            earnBookedByName: profileName,
            earnBookedByEmail: auth.currentUser?.email || email.trim(),
            earnPassengerName: earnMeta.passengerName,
            earnPassengerPhone: earnMeta.passengerPhone,
            earnPassengerEmail: earnMeta.passengerEmail,
          }
        : {}),
      status: 'waiting', createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'rides'), rideData);
    setUserBookedRide({ ...rideData, id: ref.id });
  };

  const openEarnPage = () => {
    setEarnPassengerName(profileName || '');
    setEarnPassengerPhone(profilePhone || '');
    setEarnPassengerEmail((auth.currentUser?.email || email || '').trim());
    setEarnWithdrawMobile((prev) => prev || profilePhone || '');
    setEarnRideType('Bike');
    setShowEarnPage(true);
  };

  const saveEarnWithdrawMobile = async () => {
    const mobile = earnWithdrawMobile.trim();
    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before setting up withdrawals.');
      return;
    }
    if (!isValidMobileFn(mobile)) {
      Alert.alert('Invalid mobile', 'Enter the 10-digit mobile number linked to your UPI.');
      return;
    }

    setEarnWithdrawSaving(true);
    try {
      await setDoc(doc(db, 'users', currentUserId), {
        earnWithdrawMobile: mobile,
        earnAutoWithdrawProvider: 'razorpay',
        earnAutoWithdrawEnabled: true,
        earnAutoWithdrawDay: 'friday_night',
        earnAutoWithdrawMinimum: 30,
        earnWithdrawUpdatedAt: Timestamp.now(),
      }, { merge: true });
      Alert.alert('Withdraw setup saved', 'Your earned money will be requested for Razorpay payout every Friday night when your balance is at least ₹30.');
    } catch {
      Alert.alert('Could not save', 'Please try again after a moment.');
    } finally {
      setEarnWithdrawSaving(false);
    }
  };

  const requestEmergencyEarnWithdraw = async () => {
    const mobile = earnWithdrawMobile.trim();
    if (!currentUserId) {
      Alert.alert('Login required', 'Please login before requesting withdrawal.');
      return;
    }
    if (!isValidMobileFn(mobile)) {
      Alert.alert('Invalid mobile', 'Enter the 10-digit mobile number linked to your UPI.');
      return;
    }
    if (profileEarnWallet <= 20) {
      Alert.alert('Not enough balance', 'Emergency withdrawal needs more than ₹20 because ₹20 is deducted as service fee.');
      return;
    }

    const payoutAmount = profileEarnWallet - 20;
    setEarnEmergencySaving(true);
    try {
      await addDoc(collection(db, 'earnWithdrawals'), {
        userId: currentUserId,
        name: profileName,
        mobile,
        provider: 'razorpay',
        type: 'emergency',
        requestedAmount: profileEarnWallet,
        serviceFee: 20,
        payoutAmount,
        status: 'requested',
        createdAt: Timestamp.now(),
      });
      await updateDoc(doc(db, 'users', currentUserId), {
        earnWallet: 0,
        earnWithdrawMobile: mobile,
        earnLastEmergencyWithdrawAt: Timestamp.now(),
      });
      setProfileEarnWallet(0);
      Alert.alert('Emergency withdrawal requested', `Razorpay payout request created. ₹20 service fee deducted, payout amount ₹${payoutAmount}.`);
    } catch {
      Alert.alert('Could not request withdrawal', 'Please try again after a moment.');
    } finally {
      setEarnEmergencySaving(false);
    }
  };

  const bookEarnRide = async () => {
    const passengerName = earnPassengerName.trim();
    const passengerPhone = earnPassengerPhone.trim();
    const passengerEmail = earnPassengerEmail.trim().toLowerCase();

    if (!passengerName) {
      Alert.alert('Required', 'Please enter passenger name.');
      return;
    }
    if (!isValidMobileFn(passengerPhone)) {
      Alert.alert('Invalid mobile', 'Enter a valid 10-digit mobile number for passenger.');
      return;
    }
    if (!isValidEmail(passengerEmail)) {
      Alert.alert('Invalid email', 'Enter a valid passenger email address.');
      return;
    }

    await bookRide(earnRideType, {
      passengerName,
      passengerPhone,
      passengerEmail,
    });
    setShowEarnPage(false);
  };

  const settleEarnFlowForCompletedRide = async (ride: Ride) => {
    const baseDriverPayout = Math.max(0, Math.round(ride.fare || 0));
    if (!ride.earnBookedByUserId) {
      return {
        finalFare: baseDriverPayout,
        driverPayout: baseDriverPayout,
        appFeeToApp: 0,
      };
    }

    const eligibleHiddenChargeRideType = ride.type === 'Bike' || ride.type === 'Auto' || ride.type === 'Cab';
    const eligibleEarnReward = eligibleHiddenChargeRideType && baseDriverPayout > 120;

    try {
      const earnUserRef = doc(db, 'users', ride.earnBookedByUserId);
      if (eligibleEarnReward) {
        await updateDoc(earnUserRef, {
          earnWallet: increment(EARN_REWARD_AMOUNT),
          earnUsageCount: increment(1),
        });
        if (ride.earnBookedByUserId === currentUserId) {
          setProfileEarnWallet((prev) => prev + EARN_REWARD_AMOUNT);
        }

        return {
          finalFare: baseDriverPayout,
          driverPayout: baseDriverPayout,
          appFeeToApp: 0,
        };
      }

      await updateDoc(earnUserRef, {
        earnIneligibleRideCount: increment(1),
      });

      return {
        finalFare: baseDriverPayout,
        driverPayout: baseDriverPayout,
        appFeeToApp: 0,
      };
    } catch {
      // Do not block completion if earn settlement storage fails.
      return {
        finalFare: baseDriverPayout,
        driverPayout: baseDriverPayout,
        appFeeToApp: 0,
      };
    }
  };

  const requestRide = async () => {
    if (!selectedRide) {
      Alert.alert('Select a ride type', 'Please choose a ride option to continue.');
      return;
    }
    if (!pickupCoords) {
      Alert.alert('Pickup location required', 'Please wait for current location or choose a pickup point on the map.');
      return;
    }
    if (!destCoords || !destination) {
      Alert.alert('Drop location required', 'Please enter your destination.');
      return;
    }

    if (selectedRide === 'ShareAuto') {
      const introSeen = await AsyncStorage.getItem('shareauto_intro_seen');
      if (introSeen === '1') {
        setShowShareAutoTerms(true);
      } else {
        setShowShareAutoIntro(true);
      }
      return;
    }
    if (selectedRide === 'Parcel') {
      setShowParcelTerms(true);
      return;
    }
    await bookRide();
  };

  const sendChatMessage = async () => {
    if (!activeRide?.id || !chatText.trim()) return;
    const senderId = currentUserId || (mode === 'DRIVER' ? currentRide?.driverId || '' : activeRide?.passengerId || '');
    if (!senderId) {
      Alert.alert('Chat unavailable', 'Please wait for your ride context to load and try again.');
      return;
    }

    const targetPassengerName =
      mode === 'DRIVER' &&
      activeRide.type === 'ShareAuto' &&
      chatTargetPassengerId !== 'ALL'
        ? activeRide.shareAutoPassengerNames?.[activeRide.shareAutoPassengerIds?.findIndex((id) => id === chatTargetPassengerId) || 0]
        : undefined;

    try {
      const payload: Record<string, unknown> = {
        text: chatText.trim(),
        senderId,
        senderRole: mode,
        createdAt: Date.now()
      };

      const senderName = (mode === 'DRIVER' ? driverName : profileName)?.trim();
      if (senderName) payload.senderName = senderName;

      if (mode === 'DRIVER' && activeRide.type === 'ShareAuto' && chatTargetPassengerId !== 'ALL') {
        payload.targetPassengerId = chatTargetPassengerId;
        if (targetPassengerName) payload.targetPassengerName = targetPassengerName;
      }

      await addDoc(collection(db, 'rides', activeRide.id, 'messages'), payload);

      playChatSound();
      setChatText('');
    } catch {
      Alert.alert('Message not sent', 'Could not send the message right now. Please try again.');
    }
  };

  const sendDriverReachingMessage = async (passengerId: string, passengerName: string) => {
    if (!activeRide?.id || mode !== 'DRIVER') return;
    const senderId = currentUserId || currentRide?.driverId || '';
    if (!senderId) return;
    await addDoc(collection(db, 'rides', activeRide.id, 'messages'), {
      text: `Reaching ${passengerName}. Please be ready at pickup point.`,
      senderId,
      senderRole: 'DRIVER',
      senderName: driverName,
      targetPassengerId: passengerId,
      targetPassengerName: passengerName,
      createdAt: Date.now()
    });
  };

  const addRideHistoryEntry = async (
    ride: Ride,
    status: 'completed' | 'cancelled',
    cancelledBy?: 'DRIVER' | 'PASSENGER',
    settlement?: {
      finalFare?: number;
      driverPayout?: number;
      appFeeToApp?: number;
    }
  ) => {
    const historyPayload: Record<string, any> = {
      rideId: ride.id || '',
      rideType: ride.type,
      fare: settlement?.finalFare ?? ride.fare,
      status,
      createdAt: Timestamp.now(),
      ...(ride.pickupAddr ? { pickupAddr: ride.pickupAddr } : {}),
      ...(ride.dropAddr ? { dropAddr: ride.dropAddr } : {}),
      ...(cancelledBy ? { cancelledBy } : {}),
      ...(ride.driverId || currentUserId ? { driverId: ride.driverId || currentUserId } : {}),
      ...(ride.driverName || driverName ? { driverName: ride.driverName || driverName } : {}),
      ...(ride.passengerId ? { passengerId: ride.passengerId } : {}),
      ...(ride.passengerName ? { passengerName: ride.passengerName } : {}),
      ...(ride.earnBookedByUserId ? { earnBookedByUserId: ride.earnBookedByUserId } : {}),
      ...(ride.earnBookedByName ? { earnBookedByName: ride.earnBookedByName } : {}),
      ...(ride.earnBookedByEmail ? { earnBookedByEmail: ride.earnBookedByEmail } : {}),
      ...(ride.earnPassengerName ? { earnPassengerName: ride.earnPassengerName } : {}),
      ...(ride.earnPassengerPhone ? { earnPassengerPhone: ride.earnPassengerPhone } : {}),
      ...(ride.earnPassengerEmail ? { earnPassengerEmail: ride.earnPassengerEmail } : {}),
      ...(typeof ride.pickupReachMinutes === 'number' && ride.pickupReachMinutes > 0 ? { pickupReachMinutes: ride.pickupReachMinutes } : {}),
      ...(typeof settlement?.driverPayout === 'number' ? { driverPayout: settlement.driverPayout } : {}),
      ...(typeof settlement?.appFeeToApp === 'number' ? { appFeeToApp: settlement.appFeeToApp } : {}),
      ...(typeof settlement?.appFeeToApp === 'number' && settlement.appFeeToApp > 0 ? { hiddenEarnSurcharge: settlement.appFeeToApp } : {}),
    };

    const pickupTimeMs = ride.startedAtMs || ride.acceptedAtMs || getRideCreatedAtMs(ride.createdAt) || Date.now();
    const dropTimeMs = Date.now();
    const totalTimeMinutes = status === 'completed' ? Math.max(1, Math.round((dropTimeMs - pickupTimeMs) / 60000)) : undefined;
    const distance = typeof ride.comboTotalDistance === 'number'
      ? ride.comboTotalDistance
      : typeof ride.distance === 'number'
        ? ride.distance
        : undefined;

    if (status === 'completed') {
      historyPayload.distance = distance;
      historyPayload.pickupTimeMs = pickupTimeMs;
      historyPayload.dropTimeMs = dropTimeMs;
      historyPayload.totalTimeMinutes = totalTimeMinutes;
      historyPayload.billGeneratedAtMs = dropTimeMs;
    }

    const historyRef = await addDoc(collection(db, 'rideHistory'), historyPayload);
    return { id: historyRef.id, ...historyPayload } as RideBillRecord;
  };

  const shareRideBill = useCallback(async () => {
    if (!activeRideBill) return;

    const message = buildRideBillShareMessage(activeRideBill);
    try {
      const whatsappUrl = buildRideBillShareUrl(activeRideBill);
      const canOpenWhatsapp = await Linking.canOpenURL(whatsappUrl);
      if (canOpenWhatsapp) {
        await Linking.openURL(whatsappUrl);
        return;
      }
    } catch {
      // Fall back to the native share sheet below.
    }

    try {
      await Share.share({ message, title: 'Ride bill' });
    } catch {
      Alert.alert('Share failed', 'Could not share this bill right now.');
    }
  }, [activeRideBill]);

  const uploadDriverPhoto = async (uri: string) => {
    try {
      Alert.alert("Uploading", "Please wait while we upload your photo...");
      const response = await fetch(uri);
      const blob = await response.blob();
      const photoRef = ref(storage, `driver_photos/${auth.currentUser?.uid}/${Date.now()}.jpg`);
      
      await uploadBytes(photoRef, blob);
      const downloadUrl = await getDownloadURL(photoRef);
      
      setDriverPhotoUrl(downloadUrl);
      if (driverDocId) {
        setDoc(doc(db, 'drivers', driverDocId), {
          driverPhotoUrl: downloadUrl,
          driverPhotoUpdatedAt: Timestamp.now(),
        }, { merge: true }).catch(() => {});
      }
      Alert.alert("Success", "Photo uploaded successfully!");
      return downloadUrl;
    } catch (error) {
      console.error("Photo upload error:", error);
      Alert.alert("Error", "Failed to upload photo. Please try again.");
      return null;
    }
  };

  const pickDriverPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });

      if (!result.canceled && result.assets?.[0]?.uri) {
        const [{ uri }] = result.assets;
        setDriverPhotoUri(uri);
        await uploadDriverPhoto(uri);
      }
    } catch (error) {
      console.error("Photo picker error:", error);
      Alert.alert("Error", "Failed to pick photo");
    }
  };


    const submitDriverRating = async (rideId: string, driverId: string, rating: number) => {
      try {
        if (!rating || rating < 1 || rating > 5) {
          rating = 4.8;
        }
        const driverRef = doc(db, 'users', driverId);
        await setDoc(driverRef, { ratings: arrayUnion(rating), lastRatedAt: Timestamp.now() }, { merge: true });
        await addDoc(collection(db, 'rideRatings'), { rideId, driverId, passengerId: currentUserId, rating, createdAt: Timestamp.now() });
        setShowRatingModal(false);
        setPendingRideForRating(null);
        setSelectedRating(0);
      } catch (error) {
        Alert.alert('Error', 'Failed to submit rating');
      }
    };
  const reportDriverBehavior = async (rideId: string, driverId: string, reason: string) => {
    try {
      await addDoc(collection(db, 'driverReports'), { rideId, driverId, passengerId: currentUserId, reason, createdAt: Timestamp.now() });
      await setDoc(doc(db, 'users', driverId), { reportHistory: arrayUnion(Date.now()) }, { merge: true });
      Alert.alert('Report Submitted', 'Thank you for helping us maintain quality.');
    } catch {
      Alert.alert('Error', 'Failed to submit report');
    }
  };

  const load28DayEarnings = async () => {
    try {
      if (!currentUserId) return;
      const cutoffMs = Date.now() - (28 * 24 * 60 * 60 * 1000);
      const q = query(collection(db, 'rideHistory'), where('driverId', '==', currentUserId), where('status', '==', 'completed'));
      const snapshot = await getDocs(q);
      const dailyEarnings: Record<string, number> = {};
      snapshot.forEach((historyDoc) => {
        const data = historyDoc.data();
        const createdAtMs = data.createdAt?.toMillis?.() || 0;
        if (createdAtMs < cutoffMs) return;
        const date = new Date(createdAtMs);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
        const earning = data.driverPayout || data.fare || 0;
        dailyEarnings[dateStr] = (dailyEarnings[dateStr] || 0) + earning;
      });
      setDriverEarningsLast28Days(dailyEarnings);
    } catch {
      // Ignore transient fetch errors.
    }
  };

  const acceptRide = async (ride: Ride) => {
    const pStatus = getPenaltyStatus();
    if (pStatus === "BLOCKED_5_HOURS" || pStatus === "SUSPENDED_2_DAYS" || pStatus === "PERMANENT" || pStatus === "SUSPENDED_2_HOURS" || pStatus === "SUSPENDED_36_HOURS") {
      return Alert.alert("Access Denied", "Your account is currently restricted.");
    }
    if (!driverVerified) {
      Alert.alert('Awaiting approval', 'Please wait for approval before accessing driver features.');
      return;
    }
    if (!driverPhone || !vehiclePlate) return setIsIdentitySet(false);
    const acceptedAtMs = Date.now();
    const updatePayload: any = {
      status: 'accepted', driverId: auth.currentUser?.uid,
      driverPhone: driverPhone, driverName: driverName, vehiclePlate: vehiclePlate,
      acceptedAtMs,
      ...(ride.type === 'ShareAuto'
        ? { shareAutoPickupCompletedIds: [], shareAutoDropCompletedIds: [] }
        : {})
    };
    
    if (driverPhotoUrl) {
      updatePayload.driverPhotoUrl = driverPhotoUrl;
    }
    
    const acceptedRide = {
      ...ride,
      status: 'accepted' as const,
      driverId: auth.currentUser?.uid || ride.driverId || null,
      driverPhone,
      driverName,
      vehiclePlate,
      acceptedAtMs,
      driverPhotoUrl: driverPhotoUrl || undefined,
    };
    setCurrentRide(acceptedRide);

    const updated = await updateRideSafely(ride.id, updatePayload, () => {
      setCurrentRide(null);
      Alert.alert('Ride unavailable', 'This request was already closed or reassigned.');
    });

    if (!updated) return;

    if (ride.type === 'ShareAuto' && ride.shareAutoPassengerIds) {
      for (const passengerId of ride.shareAutoPassengerIds) {
        await setDoc(doc(db, 'rideAcceptanceBroadcast', `${ride.id!}_${passengerId}`), {
          rideId: ride.id!,
          passengerId,
          status: 'accepted',
          acceptedAtMs,
          createdAt: Timestamp.now(),
        }).catch(() => {});
      }
    }
  };

  const cancelRide = async (id: string, isDriver: boolean, reason?: string) => {
    if (isDriver) {
        Alert.alert(
            "Warning", 
        "Cancelling after accepting will cancel this ride for the passenger. Continue?",
            [
                { text: "Go Back", style: "cancel" },
                { text: "Confirm Cancel", style: "destructive", onPress: async () => {
                  if (!id) {
                    Alert.alert('Unassign failed', 'Trip id is missing. Please refresh and try again.');
                    return;
                  }

                  try {
                    const rideRef = doc(db, 'rides', id);
                    const rideSnap = await getDoc(rideRef);
                    if (rideSnap.exists()) {
                      const rideData = { id: rideSnap.id, ...rideSnap.data() } as Ride;
                      try {
                        await addRideHistoryEntry(rideData, 'cancelled', 'DRIVER');
                      } catch {
                        // Keep cancellation functional even if history logging fails.
                      }
                    }

                    await updateRideSafely(id, {
                      status: 'waiting',
                      cancelledBy: deleteField(),
                      driverId: null,
                      driverPhone: '',
                      driverName: '',
                      vehiclePlate: '',
                      driverLocation: deleteField()
                    }, () => {
                      setCurrentRide(null);
                    });

                    setCurrentRide(null);
                    const newHistory = [...driverStats.cancelHistory, Date.now()];
                    let isPerm = driverStats.isPermanentlySuspended;
                    if (driverStats.cancelHistory.filter(t => t > (Date.now() - 48*60*60*1000)).length > 25) {
                        isPerm = true;
                    }
                    setDriverStats(prev => ({ ...prev, cancelled: prev.cancelled + 1, cancelHistory: newHistory, isPermanentlySuspended: isPerm }));
                    setShowDetails(false);
                  } catch {
                    Alert.alert('Cancel failed', 'Could not cancel this trip right now. Please try again.');
                  }
                }}
            ]
        );
    } else {
        try {
          const rideRef = doc(db, 'rides', id);
          const rideSnap = await getDoc(rideRef);
          if (rideSnap.exists()) {
            const rideData = { id: rideSnap.id, ...rideSnap.data() } as Ride;
            if (rideData.driverId && (reason === 'extra_money' || reason === 'bad_behavior' || reason === 'cancel_after_otp')) {
              await reportDriverBehavior(
                rideData.id || id,
                rideData.driverId,
                reason === 'extra_money' ? 'EXTRA_MONEY' : reason === 'bad_behavior' ? 'BEHAVIOR' : 'CANCEL_AFTER_OTP'
              );
            }
            const isShareAutoCancelEligible =
              rideData.type === 'ShareAuto' &&
              rideData.status !== 'waiting' &&
              (rideData.shareAutoPassengerIds || []).length > 1 &&
              (rideData.shareAutoPassengerIds || []).includes(currentUserId) &&
              !rideData.shareAutoFareRebalance?.active;

            if (isShareAutoCancelEligible) {
              const rebalance = buildShareAutoFareRebalance(rideData, currentUserId);
              await updateRideSafely(id, {
                shareAutoFareRebalance: rebalance,
                shareAutoCancelledPassengerIds: arrayUnion(currentUserId),
              }, () => {
                setUserBookedRide(null);
              });
              Alert.alert(
                'ShareAuto cancellation submitted',
                `You will be charged ₹${rebalance.chargedFare} based on distance traveled. Remaining passengers must approve the new fares to continue.`
              );
              setUserBookedRide(null);
              setDestCoords(null);
              setShowDetails(false);
              setShowTipModal(false);
              return;
            }
            if (rideData.comboMode === 'PARCEL_PLUS_BIKE' && rideData.comboParcelSenderId === currentUserId) {
              await updateRideSafely(id, {
                comboMode: deleteField(),
                comboParcelSenderId: deleteField(),
                comboParcelSenderName: deleteField(),
                comboParcelSenderPhone: deleteField(),
                comboParcelPickup: deleteField(),
                comboParcelDrop: deleteField(),
                comboParcelPickupAddr: deleteField(),
                comboParcelDropAddr: deleteField(),
                comboParcelDistance: deleteField(),
                comboParcelFare: deleteField(),
                comboParcelEncryptedOTP: deleteField(),
                comboTotalFare: deleteField(),
                comboTotalDistance: deleteField(),
                comboStage: deleteField(),
              }, () => {
                setUserBookedRide(null);
              });
              setUserBookedRide(null);
              setDestCoords(null);
              setShowDetails(false);
              setShowTipModal(false);
              return;
            }
            try {
              await addRideHistoryEntry(rideData, 'cancelled', 'PASSENGER');
            } catch {
              // Keep cancellation functional even if history logging is blocked.
            }
          }
          await deleteDoc(doc(db, 'rides', id));
          setUserBookedRide(null);
          setDestCoords(null);
          setShowDetails(false);
          setShowTipModal(false);
          
          // Increase fare penalty for passenger cancellation
          const newPenalty = farePenalty + 1;
          setFarePenalty(newPenalty);
          await AsyncStorage.setItem('fare_penalty', newPenalty.toString());
        } catch {
          Alert.alert('Cancel failed', 'Could not cancel this ride. Please try again.');
        }
    }
  };

  userBookedRideRef.current = userBookedRide;
  cancelRideRef.current = cancelRide;

  useEffect(() => {
    if (mode !== 'USER') {
      if (waitingCancelTimerRef.current) {
        clearTimeout(waitingCancelTimerRef.current);
        waitingCancelTimerRef.current = null;
        waitingCancelRideIdRef.current = null;
      }
      return;
    }

    if (userBookedRide?.id && userBookedRide.status === 'waiting' && waitingCancelRideIdRef.current !== userBookedRide.id) {
      if (waitingCancelTimerRef.current) {
        clearTimeout(waitingCancelTimerRef.current);
        waitingCancelTimerRef.current = null;
      }

      waitingCancelRideIdRef.current = userBookedRide.id;
      const rideId = userBookedRide.id;
      waitingCancelTimerRef.current = setTimeout(async () => {
        const latestRide = userBookedRideRef.current;
        if (!latestRide || latestRide.id !== rideId || latestRide.status !== 'waiting') return;
        if (!cancelRideRef.current) return;
        await cancelRideRef.current(rideId, false, 'no_driver_accepted');
      }, 4 * 60 * 1000);
    } else if (mode === 'USER' && waitingCancelTimerRef.current) {
      clearTimeout(waitingCancelTimerRef.current);
      waitingCancelTimerRef.current = null;
      waitingCancelRideIdRef.current = null;
    }

    return () => {
      if (waitingCancelTimerRef.current) {
        clearTimeout(waitingCancelTimerRef.current);
        waitingCancelTimerRef.current = null;
      }
    };
  }, [mode, userBookedRide?.id, userBookedRide?.status]);

  useEffect(() => {
    if (mode !== 'USER') {
      lastUserRideStateRef.current = null;
      return;
    }

    const prev = lastUserRideStateRef.current;
    if (
      prev?.id &&
      userBookedRide?.id &&
      prev.id === userBookedRide.id &&
      prev.status === 'accepted' &&
      userBookedRide.status === 'waiting'
    ) {
      Alert.alert('Ride update', 'sorry driver cancelled your ride let me search new driver');
    }

    lastUserRideStateRef.current = userBookedRide?.id
      ? { id: userBookedRide.id, status: userBookedRide.status }
      : null;
  }, [mode, userBookedRide?.id, userBookedRide?.status]);

  const openGoogleMaps = (lat: number, lon: number, label: string) => {
    const url = Platform.select({ ios: `maps:0,0?q=${label}@${lat},${lon}`, android: `geo:0,0?q=${lat},${lon}(${label})` });
    if (url) Linking.openURL(url);
  };

  const openDialPad = (phone?: string) => {
    if (!phone) return;
    Linking.openURL(`tel:${phone}`);
  };
  
  const focusOnCurrentLocation = () => {
    if (!location || !mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: location.latitude,
      longitude: location.longitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 450);
  };

  const getOrderedSharePassengers = (ride: Ride) => {
    const ids = ride.shareAutoPassengerIds || [];
    const names = ride.shareAutoPassengerNames || [];
    const phones = ride.shareAutoPassengerPhones || [];
    const pickups = ride.shareAutoPassengerPickups || [];
    const pickupAddrs = ride.shareAutoPassengerPickupAddrs || [];

    const list = ids.map((id, index) => ({
      id,
      name: names[index] || 'Passenger',
      phone: phones[index] || '',
      pickup: pickups[index] || ride.pickup,
      pickupAddr: pickupAddrs[index] || 'Pickup',
      distanceFromDriver: location ? calcDist(location, pickups[index] || ride.pickup) : 0,
    }));

    return list.sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);
  };

  const getOrderedShareDropPassengers = (ride: Ride) => {
    const ids = ride.shareAutoPassengerIds || [];
    const names = ride.shareAutoPassengerNames || [];
    const phones = ride.shareAutoPassengerPhones || [];
    const drops = ride.shareAutoPassengerDrops || [];
    const dropAddrs = ride.shareAutoPassengerDropAddrs || [];

    const list = ids.map((id, index) => ({
      id,
      name: names[index] || 'Passenger',
      phone: phones[index] || '',
      drop: drops[index] || ride.drop,
      dropAddr: dropAddrs[index] || 'Drop',
      distanceFromDriver: location ? calcDist(location, drops[index] || ride.drop) : 0,
    }));

    return list.sort((a, b) => a.distanceFromDriver - b.distanceFromDriver);
  };

  const getSharePassengerOtpById = (ride: Ride | null, passengerId: string) => {
    if (!ride) return '';
    if (ride.type !== 'ShareAuto') return decryptOTP(ride.encryptedOTP);

    const ids = ride.shareAutoPassengerIds || [];
    const encryptedOtps = ride.shareAutoPassengerEncryptedOTPs || [];
    const index = ids.findIndex((id) => id === passengerId);
    if (index >= 0 && encryptedOtps[index]) return decryptOTP(encryptedOtps[index]);
    return decryptOTP(ride.encryptedOTP);
  };

  const getSharePassengerDistanceById = (ride: Ride, passengerId: string) => {
    const ids = ride.shareAutoPassengerIds || [];
    const distances = ride.shareAutoPassengerDistances || [];
    const index = ids.findIndex((id) => id === passengerId);
    if (index >= 0 && distances[index]) return distances[index];
    const pickups = ride.shareAutoPassengerPickups || [];
    const drops = ride.shareAutoPassengerDrops || [];
    if (index >= 0 && pickups[index] && drops[index]) {
      return calcDist(pickups[index], drops[index]);
    }
    return ride.distance || 0;
  };

  const getSharePassengerFareById = (ride: Ride, passengerId: string) => {
    const ids = ride.shareAutoPassengerIds || [];
    const faresList = ride.shareAutoPassengerFares || [];
    const index = ids.findIndex((id) => id === passengerId);
    if (index >= 0 && typeof faresList[index] === 'number') return faresList[index];
    if (ride.shareAutoSeats) return Math.round(ride.fare / Math.max(1, ride.shareAutoSeats));
    return ride.fare || 0;
  };

  const getSharePassengerTravelledDistance = (ride: Ride, passengerId: string) => {
    if (!ride.driverLocation) return 0;
    const ids = ride.shareAutoPassengerIds || [];
    const pickups = ride.shareAutoPassengerPickups || [];
    const pickupDone = ride.shareAutoPickupCompletedIds || [];
    const index = ids.findIndex((id) => id === passengerId);
    if (index < 0 || !pickups[index]) return 0;
    if (!pickupDone.includes(passengerId)) return 0;
    const travelled = calcDist(pickups[index], ride.driverLocation);
    const total = getSharePassengerDistanceById(ride, passengerId);
    return Math.min(travelled, total);
  };

  const buildShareAutoFareRebalance = (ride: Ride, cancelledPassengerId: string) => {
    const ids = ride.shareAutoPassengerIds || [];
    const names = ride.shareAutoPassengerNames || [];
    const remainingPassengerIds = ids.filter((id) => id !== cancelledPassengerId);
    const cancelledIndex = ids.findIndex((id) => id === cancelledPassengerId);
    const cancelledName = cancelledIndex >= 0 ? names[cancelledIndex] : 'Passenger';
    const cancelledFare = getSharePassengerFareById(ride, cancelledPassengerId);
    const passengerDistance = getSharePassengerDistanceById(ride, cancelledPassengerId);
    const travelledDistance = getSharePassengerTravelledDistance(ride, cancelledPassengerId);
    const travelledRatio = passengerDistance > 0 ? Math.min(1, Math.max(0, travelledDistance / passengerDistance)) : 0;
    const chargedFare = Math.round(cancelledFare * travelledRatio);
    const remainingFare = Math.max(0, cancelledFare - chargedFare);

    const remainingDistances = remainingPassengerIds.map((id) => getSharePassengerDistanceById(ride, id));
    const totalRemainingDistance = remainingDistances.reduce((sum, d) => sum + d, 0) || 1;
    const extraFares = remainingPassengerIds.map((id, idx) => {
      const share = remainingFare * (remainingDistances[idx] / totalRemainingDistance);
      return Math.round(share);
    });

    const extraDiff = remainingFare - extraFares.reduce((sum, x) => sum + x, 0);
    if (extraFares.length > 0 && extraDiff !== 0) {
      extraFares[extraFares.length - 1] += extraDiff;
    }

    const newFares = remainingPassengerIds.map((id, idx) => {
      const baseFare = getSharePassengerFareById(ride, id);
      return baseFare + extraFares[idx];
    });

    const totalNewFare = newFares.reduce((sum, x) => sum + x, 0);

    return {
      active: true,
      cancelledPassengerId,
      cancelledPassengerName: cancelledName,
      chargedFare,
      remainingFare,
      remainingPassengerIds,
      extraFares,
      newFares,
      totalNewFare,
      requestedAtMs: Date.now(),
      driverApproved: false,
      passengerApprovedIds: [],
      passengerDeclinedIds: [],
    };
  };

  const getCurrentUserRideOtp = (ride: Ride | null) => {
    if (!ride) return '';
    if (isComboParcelSender(ride)) return decryptOTP(ride.comboParcelEncryptedOTP || ride.encryptedOTP);
    return getSharePassengerOtpById(ride, currentUserId);
  };

  const getShareNotificationSummary = (ride: Ride) => {
    const pickups = getOrderedSharePassengers(ride);
    const drops = getOrderedShareDropPassengers(ride);
    const totalFare = (ride.shareAutoPassengerFares || []).reduce((sum, x) => sum + x, 0) || ride.fare;
    const fromCoord = pickups[0]?.pickup || ride.pickup;
    const toCoord = drops[drops.length - 1]?.drop || ride.drop;
    const fromAddr = pickups[0]?.pickupAddr || ride.pickupAddr || 'Pickup';
    const toAddr = drops[drops.length - 1]?.dropAddr || ride.dropAddr || 'Drop';
    const totalDistance = calcDist(fromCoord, toCoord);
    return { totalFare, fromAddr, toAddr, totalDistance };
  };

  const handleSharePickupConfirm = async () => {
    if (!currentRide?.id || !selectedSharePassengerId) return;
    const expectedOtp = getSharePassengerOtpById(currentRide, selectedSharePassengerId);
    if (otpInput.trim() !== expectedOtp) {
      Alert.alert('Error', 'Invalid passenger OTP');
      return;
    }

    const done = new Set(currentRide.shareAutoPickupCompletedIds || []);
    done.add(selectedSharePassengerId);
    const isFirstPickup = (currentRide.shareAutoPickupCompletedIds || []).length === 0;
    const updatePayload: Record<string, unknown> = { shareAutoPickupCompletedIds: Array.from(done) };
    if (isFirstPickup && !currentRide.pickupReachMinutes) {
      updatePayload.pickupReachMinutes = getPickupReachMinutes(currentRide);
    }
    await updateRideSafely(currentRide.id, updatePayload, () => {
      setCurrentRide(null);
    });
    setOtpInput('');
    setSelectedSharePassengerId('');
  };

  const handleShareDropComplete = async () => {
    if (!currentRide?.id || !selectedSharePassengerId) return;

    const passengerIds = currentRide.shareAutoPassengerIds || [];
    const passengerDrops = currentRide.shareAutoPassengerDrops || [];
    const passengerNames = currentRide.shareAutoPassengerNames || [];
    const selectedIndex = passengerIds.findIndex((id) => id === selectedSharePassengerId);
    const selectedDrop = selectedIndex >= 0 ? (passengerDrops[selectedIndex] || currentRide.drop) : currentRide.drop;
    const selectedName = selectedIndex >= 0 ? (passengerNames[selectedIndex] || 'Passenger') : 'Passenger';

    if (!location) {
      Alert.alert('Location needed', 'Driver location is required to complete passenger drop.');
      return;
    }

    const distanceToDrop = calcDist(location, selectedDrop);
    if (distanceToDrop > 1.5) {
      Alert.alert('Too far from drop', `Move closer to ${selectedName}'s drop point. You can complete this drop within 1.5 km.`);
      return;
    }

    const done = new Set(currentRide.shareAutoDropCompletedIds || []);
    done.add(selectedSharePassengerId);
    const allPassengerCount = currentRide.shareAutoPassengerIds?.length || 0;
    const completedDrops = Array.from(done);

    if (completedDrops.length >= allPassengerCount && allPassengerCount > 0) {
      const totalShareFare = (currentRide.shareAutoPassengerFares || []).reduce((sum, x) => sum + x, 0) || currentRide.fare;
      const bill = await addRideHistoryEntry(currentRide, 'completed');
      driverRideBillSeenRef.current = bill.id || driverRideBillSeenRef.current;
      openRideBill(bill);
      setDriverStats(prev => ({ ...prev, completed: prev.completed + 1, earnings: prev.earnings + totalShareFare }));
      await deleteDoc(doc(db, 'rides', currentRide.id));
      setCurrentRide(null);
      setSelectedSharePassengerId('');
      return;
    }

    await updateRideSafely(currentRide.id, { shareAutoDropCompletedIds: completedDrops }, () => {
      setCurrentRide(null);
    });
    setSelectedSharePassengerId('');
  };

  // Email/password auth removed — phone-only OTP flow handled by Send/Verify OTP handlers.

  if (authInitializing) {
    return (
      <View style={styles.authLoadingScreen}>
        <Text style={styles.authLoadingTitle}>share-it</Text>
        <Text style={styles.authLoadingText}>Restoring your ride session...</Text>
      </View>
    );
  }

  if (!loggedIn) {
    return (
      <View style={styles.loginScreen}>
        <View style={styles.loginHero}>
          <Text style={styles.loginBrandName}>share-it</Text>
          <Text style={styles.loginBrandTagline}>Ride Smart • Earn Easy</Text>
        </View>

        <View style={styles.loginForm}>
          <Text style={styles.loginFormTitle}>Welcome back</Text>
          <Text style={styles.loginFormSubtitle}>Sign in or create an account to continue</Text>

          <View style={styles.loginInputWrap}>
            <Text style={styles.loginLabel}>Mobile number</Text>
            <TextInput
              style={styles.loginInput}
              placeholder="Enter 10-digit number"
              value={mobileNumber}
              onChangeText={(v) => setMobileNumber(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              maxLength={10}
              placeholderTextColor="#9CA3AF"
            />
          </View>

          {verificationSent ? (
            <>
              <View style={styles.loginInputWrap}>
                <Text style={styles.loginLabel}>Your name (for signup)</Text>
                <TextInput
                  style={styles.loginInput}
                  placeholder="Enter your full name"
                  value={nameForSignup}
                  onChangeText={setNameForSignup}
                  placeholderTextColor="#9CA3AF"
                />
              </View>

              <View style={styles.loginInputWrap}>
                <Text style={styles.loginLabel}>Enter OTP</Text>
                <TextInput
                  style={styles.loginInput}
                  placeholder="6-digit code from SMS"
                  value={otpInput}
                  onChangeText={setOtpInput}
                  keyboardType="number-pad"
                  placeholderTextColor="#9CA3AF"
                  maxLength={6}
                />
              </View>

              <Pressable style={styles.loginPrimaryButton} onPress={handleVerifyOtp}>
                <Text style={styles.loginPrimaryButtonText}>Verify & Continue</Text>
              </Pressable>

              <Pressable style={styles.loginSecondaryButton} onPress={() => { setVerificationSent(false); setOtpInput(''); setNameForSignup(''); }}>
                <Text style={styles.loginSecondaryButtonText}>Change number</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.loginHintText}>We&apos;ll send a 6-digit code to verify your number.</Text>
              <Pressable style={styles.loginPrimaryButton} onPress={handleSendOtp}>
                <Text style={styles.loginPrimaryButtonText}>Send OTP</Text>
              </Pressable>
            </>
          )}
        </View>

        <Text style={styles.loginFooter}>Secure phone-only authentication • Your number stays private</Text>
        <View nativeID="recaptcha-container" style={{ width: 0, height: 0 }} />
        <FirebaseRecaptchaVerifier ref={recaptchaVerifier} firebaseConfig={firebaseConfig} />

        <Modal visible={bookingValidation.visible} transparent animationType="fade" onRequestClose={() => setBookingValidation({ visible: false })}>
          <View style={styles.validationModalWrap}>
            <View style={styles.validationModalCard}>
              <Text style={styles.validationModalTitle}>{bookingValidation.title}</Text>
              <Text style={styles.validationModalMessage}>{bookingValidation.message}</Text>
              <Pressable style={styles.validationModalButton} onPress={() => setBookingValidation({ visible: false })}>
                <Text style={styles.validationModalButtonText}>Got it</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  return (
    <View style={styles.container}>
        {driverBanned && (
          <BlockedAccount
            visible={showBlockedModal}
            message={bannedMessage || BLOCKED_DRIVER_MESSAGE}
            contact={BLOCKED_DRIVER_PHONE}
            email={BLOCKED_DRIVER_EMAIL}
          />
        )}
      {mode === 'USER' ? (
          (!userBookedRide || showRideHomeButton) ? (
            <OSMMapView
              ref={mapRef}
              style={styles.map}
              onPress={async (e) => {
                const point = e.nativeEvent.coordinate;
                if (!isWithinHyderabadService(point)) {
                  Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
                  return;
                }
                void playMarkerSound(400);
                setDestCoords(point);
                const dropArea = await getAreaLabelFromCoord(point, 'Dropped Pin');
                setDestination(dropArea);
              }}
              initialRegion={location ? {...location, latitudeDelta: 0.05, longitudeDelta: 0.05} : DEFAULT_MAP_REGION}
              markers={[
                ...(pickupCoords ? [{ coordinate: pickupCoords, title: 'Pickup', color: '#2563EB', label: 'P' }] : []),
                ...(destCoords ? [{ coordinate: destCoords, title: 'Drop', color: '#EF4444', label: 'D' }] : []),
              ]}
            />
          ) : (
            (userBookedRide.status === 'accepted' || userBookedRide.status === 'started') ? (
              <View style={{ flex: 1, position: 'relative' }}>
                <OSMMapView
                  ref={mapRef}
                  style={styles.map}
                  initialRegion={location ? { ...location, latitudeDelta: 0.05, longitudeDelta: 0.05 } : DEFAULT_MAP_REGION}
                  markers={[
                    { coordinate: getUserPerspectivePickup(userBookedRide) || userBookedRide.pickup, title: 'Pickup', color: '#2563EB', label: 'P' },
                    { coordinate: getUserPerspectiveDrop(userBookedRide) || userBookedRide.drop, title: 'Drop', color: '#EF4444', label: 'D' },
                    ...(userBookedRide.driverLocation ? [{
                      coordinate: userBookedRide.driverLocation,
                      title: 'Driver',
                      description: userBookedRide.driverName || 'Driver',
                      color: '#16A34A',
                      label: icons[userBookedRide.type],
                    }] : []),
                  ]}
                />
                {userBookedRide.status === 'started' && (
                  <Animated.View style={[styles.journeyQuoteCard, { opacity: journeyAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }]}>
                    <Text style={styles.journeyQuoteText}>{journeyQuotes[currentQuoteIndex]}</Text>
                  </Animated.View>
                )}
              </View>
            ) : (
              <View style={styles.loyaltyBackground}>
                  <Animated.Text style={[styles.loyaltyIcon, { transform: [{ scale: searchAnim }] }]}>🔍</Animated.Text>
                 <Text style={styles.loyaltyTitle}>Finding your {getUserRideLabel(userBookedRide)}...</Text>
                 <View style={styles.loyaltyCard}>
                    <Text style={styles.loyaltyText}>✅ <Text style={{fontWeight:'bold'}}>Low Prices:</Text> We keep it affordable every day.</Text>
                    <Text style={styles.loyaltyText}>⚡ <Text style={{fontWeight:'bold'}}>Quick Rides:</Text> Drivers are nearby and ready.</Text>
                    <Text style={styles.loyaltyText}>🛡️ <Text style={{fontWeight:'bold'}}>Safe Travel:</Text> Verified drivers for your peace of mind.</Text>
                 </View>
                 <Text style={styles.loyaltySlogan}>Share It — Travel Smart, Save More.</Text>
              </View>
            )
          )
      ) : (
      <View style={styles.proBackground}>
             <ScrollView
               style={{ width: '100%' }}
               contentContainerStyle={{ alignItems: 'stretch', paddingHorizontal: 16, paddingTop: 80, paddingBottom: 220 + bottomSafeSpacing, flexGrow: 1 }}
               showsVerticalScrollIndicator={false}
             >
               <View style={styles.brandingContainer}>
                  <Text style={styles.brandName}>Share-It</Text>
                  <Text style={styles.slogan}>Where the driver is the king 👑</Text>

                  {(penalty === "WARNING" || penalty === "BEHAVIOR_WARNING") && (
                      <View style={styles.warningBox}>
                          <Text style={styles.warningTitle}>⚠️ {penalty === "BEHAVIOR_WARNING" ? "BEHAVIOR WARNING" : "STRONG WARNING"}</Text>
                          <Text style={styles.warningDesc}>
                            {penalty === "BEHAVIOR_WARNING" 
                              ? "Behaviour report found. Please avoid bad behaviour, extra fare requests, or cancelling after OTP. Repeated reports can suspend your account."
                                : "You have cancelled many rides. If you reach 13, you will be blocked for 5 hours."}
                          </Text>
                      </View>
                  )}

                  {!!behaviorRestrictionMessage && (
                    <View style={[styles.warningBox, { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }]}>
                      <Text style={[styles.warningTitle, { color: '#B45309' }]}>Notification Restrictions</Text>
                      <Text style={styles.warningDesc}>{behaviorRestrictionMessage}</Text>
                    </View>
                  )}

          {penalty === "BEHAVIOR_SUSPENDED_12_HOURS" && (
            <View style={[styles.warningBox, {borderColor: '#DC2626'}]}>
              <Text style={[styles.warningTitle, {color: '#DC2626'}]}>🚨 ACCOUNT SUSPENDED - 12 HOURS</Text>
              <Text style={styles.warningDesc}>Your account is suspended for 12 hours due to multiple behavior reports. You will not receive ride notifications. This is a final warning before account permanent suspension.</Text>
            </View>
          )}
                  {penalty === "BLOCKED_5_HOURS" && (
                      <View style={[styles.warningBox, {borderColor: '#FF3B30'}]}>
                          <Text style={[styles.warningTitle, {color: '#FF3B30'}]}>🚫 ACCESS BLOCKED</Text>
                          <Text style={styles.warningDesc}>Notifications stopped for 5 hours due to frequent cancellations.</Text>
                      </View>
                  )}

                  <View style={styles.dashboard}>
                    <View style={styles.dashItem}><Text style={styles.dashVal}>{driverStats.completed}</Text><Text style={styles.dashLab}>Rides</Text></View>
                    <View style={styles.dashItem}><Text style={[styles.dashVal, {color:'#34C759'}]}>₹{driverStats.earnings}</Text><Text style={styles.dashLab}>Earned</Text></View>
                    <View style={styles.dashItem}><Text style={[styles.dashVal, {color:'#FF3B30'}]}>{driverStats.cancelled}</Text><Text style={styles.dashLab}>Cancelled</Text></View>
                    <View style={styles.dashItem}><Text style={styles.dashVal}>⭐ {driverStats.rating || 'N/A'}</Text><Text style={styles.dashLab}>Rating</Text></View>
                    <View style={styles.dashItem}><Text style={styles.dashVal}>{driverAvgPickupMinutes ? `${driverAvgPickupMinutes} min` : 'N/A'}</Text><Text style={styles.dashLab}>Avg pickup time</Text></View>
                    <View style={styles.dashItem}><Text style={[styles.dashVal, {color:'#B26A00'}]}>₹{driverPayableToApp}</Text><Text style={styles.dashLab}>Need to pay for app</Text></View>
                  </View>
                  <View style={styles.driverInfoCard}>
                    <Text style={styles.driverInfoTitle}>Driver Details</Text>
                    <Text style={styles.driverInfoText}>Name: {driverName || 'N/A'}</Text>
                    <Text style={styles.driverInfoText}>Mobile: {driverPhone || 'N/A'}</Text>
                    <Text style={styles.driverInfoText}>Vehicle No: {vehiclePlate || 'N/A'}</Text>
                  </View>
                  <Pressable style={styles.historyBtn} onPress={() => setShowHistory(true)}>
                    <Text style={styles.historyBtnEyebrow}>Driver tools</Text>
                    <Text style={styles.historyBtnText}>View Ride History</Text>
                    <Text style={styles.historyBtnSubtext}>Check completed trips, cancellations, and trip details</Text>
                  </Pressable>
                  {!!driverVehicle && (
                    <Pressable
                      style={styles.changeVehicleBtn}
                      onPress={async () => {
                        await AsyncStorage.removeItem('driver_vehicle');
                        setDriverVehicle(null);
                        setIsIdentitySet(false);
                      }}
                    >
                      <Text style={styles.changeVehicleBtnText}>Change Vehicle</Text>
                    </Pressable>
                  )}
               </View>

               {(penalty === "SUSPENDED_2_DAYS" || penalty === "PERMANENT" || penalty.includes("SUSPENDED")) && (
                   <View style={styles.suspensionOverlay}>
                     <Text style={styles.suspensionEmoji}>🛑</Text>
                       <Text style={styles.suspensionTitle}>ACCOUNT SUSPENDED</Text>
                       <Text style={styles.suspensionText}>
                           {penalty === "PERMANENT" 
                            ? "Your account is permanently suspended. Visit office to pay ₹500 fine." 
                            : penalty === "SUSPENDED_36_HOURS" ? "Suspended for 36 hours due to serious passenger reports."
                            : penalty === "SUSPENDED_2_HOURS" ? "Suspended for 2 hours due to behavior reports."
                           : penalty === "BEHAVIOR_SUSPENDED_12_HOURS" ? "Suspended for 12 hours due to repeated behavior/extra fare complaints in last 5 hours."
                            : "Account suspended for 2 days. Final warning before permanent suspension."}
                       </Text>
                       <View style={styles.crewBox}>
                           <Text style={styles.crewLabel}>CREW ONLY: UNLOCK CODE</Text>
                           <TextInput style={styles.crewInput} placeholder="Enter secret code" value={crewUnlockCode} onChangeText={setCrewUnlockCode} secureTextEntry />
                           <TouchableOpacity style={styles.crewBtn} onPress={handleCrewUnlock}>
                                <Text style={{color:'white', fontWeight:'bold'}}>ACTIVATE ACCOUNT</Text>
                           </TouchableOpacity>
                       </View>
                   </View>
               )}

               <View style={styles.driverFilterCard}>
                 <View style={{ flex: 1 }}>
                   <Text style={styles.driverFilterTitle}>Destination Marker Filter</Text>
                   <Text style={styles.driverFilterHint}>
                     {driverDestinationFilterEnabled && driverDestinationMarker
                       ? `Notifications only for rides with destination within ${DRIVER_DESTINATION_MARKER_RADIUS_KM} km`
                       : 'Turn on to choose a destination area on map'}
                   </Text>
                   <Text style={styles.driverFilterHint}>Uses left today: {driverDestinationToggleUsesLeft}/{DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT}</Text>
                 </View>
                 <Switch
                   value={driverDestinationFilterEnabled}
                   onValueChange={(enabled) => {
                     if (enabled) {
                       if (!canUseDriverDestinationToggleToday()) {
                         Alert.alert('Daily limit reached', `You can use this toggle only ${DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT} times in a day.`);
                         return;
                       }
                       setPendingDriverDestinationMarker(driverDestinationMarker || location || null);
                       setShowDriverDestinationMap(true);
                       return;
                     }
                     setDriverDestinationFilterEnabled(false);
                   }}
                   disabled={!driverDestinationFilterEnabled && driverDestinationToggleUsesLeft <= 0}
                   trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                   thumbColor={driverDestinationFilterEnabled ? '#16A34A' : '#F8FAFC'}
                 />
               </View>

               <View style={styles.driverPromoFooter}>
                 <Animated.View
                   style={[
                     styles.driverPromoPulse,
                     {
                       opacity: driverPromoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.15, 0.45] }),
                       transform: [
                         {
                           scale: driverPromoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.04] }),
                         },
                       ],
                     },
                   ]}
                 />
                 <Text style={styles.driverPromoTitle}>Share-It driver app</Text>
                 <Text style={styles.driverPromoText}>Stay connected, accept rides faster, and keep passengers happy with smooth in-app driver tools.</Text>
               </View>
            </ScrollView>
          </View>
      )}
      
      {mode === 'USER' && !!location && !userBookedRide && !isPassengerCardExpanded && (
        <Pressable style={[styles.currentLocFab, { bottom: 235 + CURRENT_LOC_FAB_RISE + bottomSafeSpacing }]} onPress={focusOnCurrentLocation}>
          <Text style={styles.currentLocFabText}>⌖</Text>
        </Pressable>
      )}
      {mode === 'USER' && showRideHomeButton && userBookedRide?.status === 'started' && userBookedRide?.passengerId === currentUserId && (
        <Animated.View
          style={[
            styles.activeRideButton,
            {
              top: activeRideButtonPos.y,
              left: activeRideButtonPos.x,
              transform: [{ scale: activeRideButtonScale }],
            },
          ]}
          {...activeRideButtonPanResponder.panHandlers}
        >
          <Pressable
            style={styles.activeRideButtonPressable}
            onPress={() => {
              setShowRideStartedGameModal(true);
              setShowRideHomeButton(false);
            }}
          >
            <Text style={styles.activeRideButtonText}>Active Ride</Text>
          </Pressable>
        </Animated.View>
      )}

      {/* HEADER */}
      {!(mode === 'USER' && !userBookedRide && isPassengerCardExpanded) && (
      <View style={styles.header}>
        <Pressable style={styles.badge} onPress={() => setMode(mode === 'USER' ? 'DRIVER' : 'USER')}>
          {mode === 'USER' ? (
            <Ionicons name="car-sport" size={22} color="#111827" />
          ) : (
            <Text style={{fontWeight:'700'}}>Pro Driver</Text>
          )}
        </Pressable>
        <View style={{position: 'relative'}}>
          <Pressable style={styles.logout} onPress={() => setShowLogoutMenu(!showLogoutMenu)}>
            <Text style={{color:'white', fontSize: 18}}>⋯</Text>
          </Pressable>
          {showLogoutMenu && (
            <View style={styles.logoutMenu}>
              {mode === 'USER' && (
                <>
                  <Pressable style={styles.logoutMenuItem} onPress={() => {
                    setShowLogoutMenu(false);
                    setShowProfileModal(true);
                  }}>
                    <Text style={styles.menuItemText}>Profile</Text>
                  </Pressable>
                  <Pressable style={styles.logoutMenuItem} onPress={() => {
                    setShowLogoutMenu(false);
                    setShowPassengerHistoryModal(true);
                  }}>
                    <Text style={styles.menuItemText}>Ride history</Text>
                  </Pressable>
                  <Pressable style={styles.logoutMenuItem} onPress={() => {
                    setShowLogoutMenu(false);
                    setShowNotificationsModal(true);
                  }}>
                    <Text style={styles.menuItemText}>Notifications</Text>
                  </Pressable>
                </>
              )}
              <Pressable style={styles.logoutMenuItem} onPress={() => {
                setShowLogoutMenu(false);
                Alert.alert(
                  'Logout',
                  `Are you sure you want to logout as ${mode === 'USER' ? 'Passenger' : 'Driver'}?`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Logout', style: 'destructive', onPress: () => signOut(auth) }
                  ]
                );
              }}>
                <Text style={styles.logoutMenuText}>Logout as {mode === 'USER' ? 'Passenger' : 'Driver'}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
      )}

      {/* FIXED BOTTOM ACTION CARD - Replaced <div> with <View>  */}
      <Animated.View
        {...(mode === 'USER' && !userBookedRide && !isPassengerCardExpanded ? passengerCardPanResponder.panHandlers : {})}
        onLayout={(event) => {
          if (mode === 'USER' && !userBookedRide && !isPassengerCardExpanded) {
            setPassengerCardCollapsedHeight(event.nativeEvent.layout.height);
          }
        }}
        style={[
          styles.bottomCard,
          mode === 'USER' && !userBookedRide && isPassengerCardExpanded ? styles.bottomCardOverlay : null,
          mode === 'USER' && !userBookedRide
            ? (isPassengerCardExpanded ? null : { transform: [{ translateY: passengerCardTranslateY }] })
            : null,
        ]}
      >
        {mode === 'USER' ? (
          <>
            {(!userBookedRide || showRideHomeButton) ? (
              <>
                <View
                  style={styles.passengerCardHandleWrap}
                  {...(mode === 'USER' && !userBookedRide ? passengerCardPanResponder.panHandlers : {})}
                >
                  <View style={styles.passengerCardHandle} />
                  <Text style={styles.passengerCardHandleHint}>{isPassengerCardExpanded ? 'Pull down to collapse' : 'Pull up to expand'}</Text>
                </View>
                {isPassengerCardExpanded ? (
                  <ScrollView style={styles.passengerExpandedPage} showsVerticalScrollIndicator={false} contentContainerStyle={styles.passengerExpandedPageContent}>
                    <View style={styles.passengerExpandedHeaderRow}>
                      <Text style={styles.passengerExpandedTitle}>Quick Booking Page</Text>
                    </View>
                    <Text style={styles.passengerExpandedSubTitle}>Book instantly, use Go Home, and pull down anytime to pin markers on map.</Text>

                    <TextInput
                      style={styles.input}
                      placeholder="Pickup Area"
                      value={pickupInput}
                      onFocus={() => handleSearchFieldFocus('pickup')}
                      onChangeText={(v) => handleLocationInputChange('pickup', v)}
                      onSubmitEditing={() => handleSearch('pickup')}
                    />
                    <Text style={styles.routeToText}>To</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Drop Area"
                      value={destination}
                      onFocus={() => handleSearchFieldFocus('drop')}
                      onChangeText={(v) => handleLocationInputChange('drop', v)}
                      onSubmitEditing={() => handleSearch('drop')}
                    />
                    {activeSearchField && (isLoadingSuggestions || searchSuggestionState !== 'idle' || !!searchSuggestions.length) && (
                      <View style={styles.searchSuggestionPanel}>
                        {isLoadingSuggestions ? (
                          <Text style={styles.searchSuggestionText}>Searching locations...</Text>
                        ) : searchSuggestionState === 'error' ? (
                          <Text style={styles.searchSuggestionErrorText}>{searchSuggestionMessage}</Text>
                        ) : searchSuggestionState === 'empty' ? (
                          <Text style={styles.searchSuggestionEmptyText}>{searchSuggestionMessage}</Text>
                        ) : (
                          <FlatList
                            data={searchSuggestions}
                            keyExtractor={(item) => item.placeId}
                            keyboardShouldPersistTaps="handled"
                            renderItem={renderSuggestionItem}
                          />
                        )}
                      </View>
                    )}
                    {isCalculatingFares && (
                      <Text style={styles.fareCalculatingText}>Calculating your fares...</Text>
                    )}
                    {!!routeDistanceError && (
                      <Text style={styles.fareCalculatingText}>{routeDistanceError}</Text>
                    )}

                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ marginBottom: 10 }}>
                      {(['Bike', 'Auto', 'Cab', 'ShareAuto', 'Parcel'] as RideType[]).map(r => (
                        <Pressable
                          key={r}
                          style={[
                            styles.rideCard,
                            r === 'ShareAuto' && styles.shareRideCard,
                            r === 'Parcel' && styles.parcelRideCard,
                            selectedRide === r && styles.selected,
                          ]}
                          onPress={async () => {
                            playUiTapSound('vehicle');
                            setSelectedRide(r);
                          }}
                        >
                          {r === 'ShareAuto' && <Text style={styles.shareAttractLabel}>SAVE MONEY</Text>}
                          {r === 'Parcel' && <Text style={styles.parcelAttractLabel}>DELIVERY</Text>}
                          <Text style={{fontSize: 24}}>{icons[r]}</Text>
                          <Text style={{fontWeight:'bold'}}>₹{fares[r]}</Text>
                          <Text style={{fontSize: 10}}>{r === 'Parcel' ? 'Parcel' : r}</Text>
                          {r === 'Parcel' && <Text style={styles.parcelCardHint}>Small parcels only</Text>}
                        </Pressable>
                      ))}
                      <Pressable
                        style={[styles.rideCard, styles.earnRideCard]}
                        onPress={() => {
                          playUiTapSound('vehicle');
                          openEarnPage();
                        }}
                      >
                        <Text style={styles.earnAttractLabel}>EARN</Text>
                        <Text style={{fontSize: 24}}>💸</Text>
                        <Text style={{fontWeight:'bold'}}>₹5</Text>
                        <Text style={{fontSize: 10}}>Earn</Text>
                        <Text style={styles.earnCardHint}>Book for others</Text>
                      </Pressable>
                    </ScrollView>

                    <Pressable
                      style={styles.primaryButton}
                      onPress={() => {
                        playUiTapSound('cta');
                        requestRide();
                      }}
                    >
                      <Text style={styles.buttonText}>Lets Go</Text>
                    </Pressable>

                    <View style={styles.goHomeWrap}>
                      <Pressable style={styles.goHomeButton} onPress={handleGoHomePress}>
                        <Text style={styles.goHomeButtonText}>Go Home</Text>
                      </Pressable>
                      <Text style={styles.goHomeHintText}>
                        {homeLocation
                          ? `Home: ${homeLocationLabel || `${homeLocation.latitude.toFixed(4)}, ${homeLocation.longitude.toFixed(4)}`}`
                          : 'First time: tap Go Home and pin your home on map'}
                      </Text>
                    </View>

                    <Animated.View
                      style={[
                        styles.passengerFeatureCard,
                        {
                          opacity: passengerFeatureRevealAnim,
                          transform: [{
                            translateY: passengerFeatureRevealAnim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })
                          }],
                        },
                      ]}
                    >
                      <Animated.Text
                        style={[
                          styles.passengerFeatureTitle,
                          {
                            transform: [{
                              scale: passengerFeaturePulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] })
                            }],
                          },
                        ]}
                      >
                        ✨ Why people love Share-It
                      </Animated.Text>
                      <View style={styles.passengerFeatureGrid}>
                        {passengerFeatureItems.map((item, index) => (
                          <Animated.View
                            key={item.title}
                            style={[
                              styles.passengerFeatureTile,
                              {
                                opacity: passengerFeatureRevealAnim,
                                transform: [{
                                  translateY: passengerFeatureRevealAnim.interpolate({ inputRange: [0, 1], outputRange: [18 + (index * 3), 0] })
                                }],
                              },
                            ]}
                          >
                            <Text style={styles.passengerFeatureTileIcon}>{item.icon}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.passengerFeatureTileTitle}>{item.title}</Text>
                              <Text style={styles.passengerFeatureTileText}>{item.text}</Text>
                            </View>
                          </Animated.View>
                        ))}
                      </View>
                    </Animated.View>

                    <Pressable style={styles.passengerExpandedBottomBackBtn} onPress={() => animatePassengerCard(false)}>
                      <Text style={styles.passengerExpandedBottomBackBtnText}>Back to Map</Text>
                    </Pressable>
                  </ScrollView>
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder="Pickup Area"
                      value={pickupInput}
                      onFocus={() => handleSearchFieldFocus('pickup')}
                      onChangeText={(v) => handleLocationInputChange('pickup', v)}
                      onSubmitEditing={() => handleSearch('pickup')}
                    />
                    <Text style={styles.routeToText}>To</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Drop Area"
                      value={destination}
                      onFocus={() => handleSearchFieldFocus('drop')}
                      onChangeText={(v) => handleLocationInputChange('drop', v)}
                      onSubmitEditing={() => handleSearch('drop')}
                    />
                    {activeSearchField && (isLoadingSuggestions || searchSuggestionState !== 'idle' || !!searchSuggestions.length) && (
                      <View style={styles.searchSuggestionPanel}>
                        {isLoadingSuggestions ? (
                          <Text style={styles.searchSuggestionText}>Searching locations...</Text>
                        ) : searchSuggestionState === 'error' ? (
                          <Text style={styles.searchSuggestionErrorText}>{searchSuggestionMessage}</Text>
                        ) : searchSuggestionState === 'empty' ? (
                          <Text style={styles.searchSuggestionEmptyText}>{searchSuggestionMessage}</Text>
                        ) : (
                          <FlatList
                            data={searchSuggestions}
                            keyExtractor={(item) => item.placeId}
                            keyboardShouldPersistTaps="handled"
                            renderItem={renderSuggestionItem}
                          />
                        )}
                      </View>
                    )}
                    {isCalculatingFares && (
                      <Text style={styles.fareCalculatingText}>Calculating your fares...</Text>
                    )}
                    {!!routeDistanceError && (
                      <Text style={styles.fareCalculatingText}>{routeDistanceError}</Text>
                    )}
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ marginBottom: 10 }}>
                      {(['Bike', 'Auto', 'Cab', 'ShareAuto', 'Parcel'] as RideType[]).map(r => (
                        <Pressable
                          key={r}
                          style={[
                            styles.rideCard,
                            r === 'ShareAuto' && styles.shareRideCard,
                            r === 'Parcel' && styles.parcelRideCard,
                            selectedRide === r && styles.selected,
                          ]}
                          onPress={() => {
                            playUiTapSound('vehicle');
                            setSelectedRide(r);
                          }}
                        >
                          {r === 'ShareAuto' && <Text style={styles.shareAttractLabel}>SAVE MONEY</Text>}
                          {r === 'Parcel' && <Text style={styles.parcelAttractLabel}>DELIVERY</Text>}
                          <Text style={{fontSize: 24}}>{icons[r]}</Text>
                          <Text style={{fontWeight:'bold'}}>₹{fares[r]}</Text>
                          <Text style={{fontSize: 10}}>{r === 'Parcel' ? 'Parcel' : r}</Text>
                          {r === 'Parcel' && <Text style={styles.parcelCardHint}>Small parcels only</Text>}
                        </Pressable>
                      ))}
                      <Pressable
                        style={[styles.rideCard, styles.earnRideCard]}
                        onPress={() => {
                          playUiTapSound('vehicle');
                          openEarnPage();
                        }}
                      >
                        <Text style={styles.earnAttractLabel}>EARN</Text>
                        <Text style={{fontSize: 24}}>💸</Text>
                        <Text style={{fontWeight:'bold'}}>₹5</Text>
                        <Text style={{fontSize: 10}}>Earn</Text>
                        <Text style={styles.earnCardHint}>Book for others</Text>
                      </Pressable>
                    </ScrollView>
                    <Pressable
                      style={styles.primaryButton}
                      onPress={() => {
                        playUiTapSound('cta');
                        requestRide();
                      }}
                    >
                      <Text style={styles.buttonText}>Lets Go</Text>
                    </Pressable>
                  </>
                )}
                {isFetchingCurrentLocation && (
                  <Text style={styles.currentLocationHintText}>Getting your current location shortly...</Text>
                )}
              </>
            ) : (
              <View style={{alignItems: 'center'}}>
                {userBookedRide.status === 'accepted' ? (
                  <View style={styles.driverArrivingCard}>
                    <Text style={styles.driverNameText}>{userBookedRide.driverName} is coming</Text>
                    <Text style={{color:'#8E8E93', marginBottom:10}}>{userBookedRide.vehiclePlate}</Text>
                    
                    {userBookedRide.driverPhotoUrl && (
                      <View style={{width: 80, height: 80, borderRadius: 40, marginBottom: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#007AFF'}}>
                        <Image source={{ uri: userBookedRide.driverPhotoUrl }} style={{width: '100%', height: '100%'}} />
                      </View>
                    )}
                    
                    <Text style={{fontWeight:'700'}}>{userBookedRide.driverName || 'Driver'} • {userBookedRide.driverPhone || 'N/A'}</Text>
                    {!!userBookedRide.driverPhone && (
                      <Pressable style={styles.callBtn} onPress={() => openDialPad(userBookedRide.driverPhone)}>
                        <Text style={styles.callBtnText}>Call Driver</Text>
                      </Pressable>
                    )}
                    {userBookedRide.type === 'ShareAuto' && (
                      <View style={styles.etaCard}>
                        <Animated.Text
                          style={[
                            styles.etaAuto,
                            {
                              transform: [{
                                translateX: arrivalAutoPulse.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [-6, 6]
                                })
                              }]
                            }
                          ]}
                        >
                          🛺
                        </Animated.Text>
                        <Text style={styles.etaText}>
                          ETA to your pickup: {
                            userBookedRide.driverLocation && userBookedRide.shareAutoPassengerIds?.length
                              ? `${Math.max(2, Math.round((calcDist(
                                userBookedRide.driverLocation,
                                userBookedRide.shareAutoPassengerPickups?.[
                                  Math.max(0, userBookedRide.shareAutoPassengerIds.findIndex((id) => id === currentUserId))
                                ] || userBookedRide.pickup
                              ) / 22) * 60))} min`
                              : 'Calculating...'
                          }
                        </Text>
                      </View>
                    )}
                    <View style={styles.otpClearBox}>
                        <Text style={styles.otpLabel}>SHARE OTP TO START</Text>
                      <Text style={styles.otpValue}>{getCurrentUserRideOtp(userBookedRide)}</Text>
                    </View>
                  </View>
                ) : userBookedRide.status === 'started' ? (
                  <View style={[styles.driverArrivingCard, { backgroundColor: '#ECFDF3', borderColor: '#7DD3A5', borderWidth: 1 }]}> 
                    <Text style={[styles.searchingText, {color: '#15803D'}]}>🎉 Congratulations! Your ride has started.</Text>
                    <Text style={{ color: '#166534', textAlign: 'center', marginTop: 4 }}>Open the creative ride screen and play until destination.</Text>
                    <Pressable style={[styles.navButton, { marginTop: 10 }]} onPress={() => {
                        setShowRideStartedGameModal(true);
                        setShowRideHomeButton(false);
                    }}>
                        <Text style={styles.navButtonText}>Open Ride Experience</Text>
                    </Pressable>
                  </View>
                ) : (userBookedRide.type === 'ShareAuto' && (userBookedRide.shareAutoSeats || 0) >= 3) ? (
                  <View style={styles.driverArrivingCard}>
                    <Text style={[styles.searchingText, {color: '#6B4E00'}]}>Congratulations! All passengers found.</Text>
                    <Text style={{color:'#8E8E93', marginTop: 4, textAlign: 'center'}}>Waiting for driver acceptance. OTP will appear after the driver accepts.</Text>
                    <Pressable style={styles.reasonBtn} onPress={() => setShowShareAutoGame(true)}>
                      <Text>Continue mini game</Text>
                    </Pressable>
                  </View>
                ) : (
                    <Text style={styles.searchingText}>Searching within {searchRadius}km...</Text>
                )}
                {(userBookedRide.status === 'accepted' || userBookedRide.status === 'started') && (
                  <Pressable style={styles.chatButton} onPress={() => setChatOpen(true)}>
                    <Text style={styles.chatButtonText}>Open Chat</Text>
                    {hasUnreadChat && <View style={styles.unreadDot} />}
                  </Pressable>
                )}
                <Pressable style={styles.detailsBtn} onPress={() => setShowDetails(true)}><Text style={styles.detailsBtnText}>Trip Info / Cancel</Text></Pressable>
              </View>
            )}
          </>
        ) : (
          <ScrollView>
            {!driverVehicle ? (
                <View style={{padding: 10}}>
                    <Text style={styles.sectionTitle}>Pick your vehicle</Text>
                    <View style={styles.grid}>
                        {([
                          { value: 'Bike', label: 'Bike' },
                          { value: 'Cycle', label: 'Electric Cycle' },
                          { value: 'Auto', label: 'Auto' },
                          { value: 'Cab', label: 'Cab' },
                        ] as const).map(v => (
                            <Pressable
                              key={v.value}
                              style={styles.rideCard}
                              onPress={async () => {
                                playUiTapSound('vehicle');
                                setDriverVehicle(v.value as DriverVehicleType);
                                await AsyncStorage.setItem('driver_vehicle', v.value);
                                if (driverDocId) {
                                  await setDoc(doc(db, 'drivers', driverDocId), {
                                    vehicleType: v.value,
                                    vehicleTypeUpdatedAt: Timestamp.now(),
                                  }, { merge: true });
                                  if (driverVerified && driverSubscriptionActive) {
                                    setIsIdentitySet(true);
                                  }
                                }
                              }}
                            >
                                <Text style={{fontSize: 30}}>{icons[v.value]}</Text><Text>{v.label}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : !isIdentitySet ? (
                <View style={{padding: 10}}>
                    <Text style={styles.sectionTitle}>Identity Setup</Text>
                    {(waitingForVerification || (driverDocId && !driverVerified && !showDriverVerification)) ? (
                      <View style={styles.pendingReviewPage}>
                        <View style={styles.pendingReviewBadgeRow}>
                          <Text style={styles.pendingReviewBadge}>Under review</Text>
                        </View>
                        <Text style={styles.pendingReviewTitle}>
                          {waitingForVerification ? 'Your documents are being reviewed' : 'Driver access is paused'}
                        </Text>
                        <Text style={styles.pendingReviewText}>
                          {waitingForVerification
                            ? 'Thanks for submitting your RC and driving licence. Our team is reviewing your request manually.'
                            : 'Your driver approval was turned off in Firestore. Please submit documents again to request access.'}
                        </Text>
                        <View style={styles.pendingReviewCard}>
                          <Text style={styles.pendingReviewCardTitle}>What happens next</Text>
                          <Text style={styles.pendingReviewCardText}>1. We verify your documents.</Text>
                          <Text style={styles.pendingReviewCardText}>2. Once approved, the payment page opens automatically.</Text>
                          <Text style={styles.pendingReviewCardText}>3. After payment, driver notifications and ride tools unlock for 28 days.</Text>
                        </View>
                        <View style={styles.pendingReviewFooter}>
                          <Text style={styles.pendingReviewFooterText}>This page stays until approval changes to true.</Text>
                        </View>
                      </View>
                    ) : showDriverVerification ? (
                      <View />
                    ) : (
                      <>
                        <TextInput style={styles.input} placeholder="Full Name" value={driverName} onChangeText={setDriverName} />
                        <View style={styles.driverLockedPhoneCard}>
                          <Text style={styles.driverLockedPhoneLabel}>OTP verified mobile</Text>
                          <Text style={styles.driverLockedPhoneValue}>{profilePhone || mobileNumber || driverPhone || 'Login phone required'}</Text>
                          <Text style={styles.driverLockedPhoneHint}>This number is saved with your driver documents and used to restore driver access on another mobile.</Text>
                        </View>
                        <TextInput style={styles.input} placeholder="Plate Number" value={vehiclePlate} onChangeText={(v) => setVehiclePlate(v.toUpperCase())} autoCapitalize="characters" />
                        <Text style={{fontSize: 12, color: '#666', textAlign: 'center', marginBottom: 10}}>Example: MH12AB1234</Text>
                      </>
                    )}

                    {(showDriverVerification || waitingForVerification) && (
                      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
                        <View style={styles.verificationModal}>
                          {waitingForVerification ? (
                            <View style={styles.pendingWrap}>
                              <Pressable style={styles.pendingBack} onPress={() => { setShowDriverVerification(false); setMode('USER'); }}>
                                <Text style={styles.pendingBackText}>← Back to passenger</Text>
                              </Pressable>
                              <Text style={styles.pendingBadge}>Submitted</Text>
                              <Text style={styles.pendingTitle}>Your request is pending for approval</Text>
                              <Text style={styles.pendingText}>Please wait for 8 hours. Our team will respond to you within 8 hours.</Text>
                              <View style={styles.pendingCard}>
                                <Text style={styles.pendingCardTitle}>What happens next</Text>
                                <Text style={styles.pendingCardText}>{driverVehicle === 'Cycle'
                                  ? 'We review your Aadhar and PAN card manually. Once approved, driver access is unlocked automatically.'
                                  : 'We review your RC and driving licence manually. Once approved, driver access is unlocked automatically.'}</Text>
                              </View>
                            </View>
                          ) : (
                            <DriverVerificationButtons
                              name={driverName}
                              phone={profilePhone || mobileNumber || driverPhone}
                              vehicleNumber={vehiclePlate}
                              authUid={currentUserId}
                              vehicleType={driverVehicle || undefined}
                              driverPhotoUrl={driverPhotoUrl}
                              activeDeviceId={deviceInstallIdRef.current}
                              onSubmitted={(id) => {
                                setShowDriverVerification(false);
                                setWaitingForVerification(true);
                                setDriverDocId(id);
                              }}
                              onBack={() => {
                                setShowDriverVerification(false);
                                setMode('USER');
                              }}
                            />
                          )}
                        </View>
                      </Modal>
                    )}

                    {showDriverPaymentModal && driverVerified && !driverSubscriptionActive && (
                      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => {}}>
                        <View style={styles.subscriptionModal}>
                          <ScrollView contentContainerStyle={styles.subscriptionScroll} showsVerticalScrollIndicator={false}>
                            <View style={styles.subscriptionHero}>
                              <Text style={styles.subscriptionBadge}>Driver access approved</Text>
                              <Text style={styles.subscriptionTitle}>Activate your 28-day driver pass</Text>
                              <Text style={styles.subscriptionSubtitle}>
                                Your documents are verified. Pay once to unlock ride notifications, ride acceptance, and driver tools for the next 28 days.
                              </Text>
                            </View>

                            <View style={styles.subscriptionPriceCard}>
                              <Text style={styles.subscriptionPriceLabel}>Today&apos;s payment</Text>
                              <Text style={styles.subscriptionPriceValue}>₹{DRIVER_SUBSCRIPTION_AMOUNT}</Text>
                              <Text style={styles.subscriptionPriceMeta}>Single payment • {DRIVER_SUBSCRIPTION_DAYS} days access</Text>
                            </View>

                            <View style={styles.subscriptionFeatureCard}>
                              <Text style={styles.subscriptionFeatureTitle}>What you unlock</Text>
                              <Text style={styles.subscriptionFeatureLine}>• Live ride notifications for nearby bookings</Text>
                              <Text style={styles.subscriptionFeatureLine}>• Ride acceptance and driver tools</Text>
                              <Text style={styles.subscriptionFeatureLine}>• Access remains active for 28 days from payment</Text>
                              <Text style={styles.subscriptionFeatureLine}>• If your documents are changed back to false, access is cancelled and you must submit again</Text>
                            </View>

                            {!!driverSubscriptionExpiresAt && (
                              <View style={styles.subscriptionNoticeCard}>
                                <Text style={styles.subscriptionNoticeTitle}>Subscription status</Text>
                                <Text style={styles.subscriptionNoticeText}>
                                  {driverSubscriptionActive ? 'Active now' : 'Payment required'}
                                </Text>
                              </View>
                            )}

                            {!!driverPaymentError && (
                              <View style={styles.subscriptionErrorCard}>
                                <Text style={styles.subscriptionErrorText}>{driverPaymentError}</Text>
                              </View>
                            )}

                            <Pressable
                              style={[styles.subscriptionPayButton, driverPaymentProcessing && { opacity: 0.7 }]}
                              onPress={handleDriverSubscriptionPayment}
                              disabled={driverPaymentProcessing}
                            >
                              <Text style={styles.subscriptionPayButtonText}>
                                {driverPaymentProcessing ? 'Opening payment...' : `Pay ₹${DRIVER_SUBSCRIPTION_AMOUNT} now`}
                              </Text>
                            </Pressable>

                            <Text style={styles.subscriptionFootnote}>
                              Payment is required before the app unlocks driver notifications and acceptance controls.
                            </Text>
                          </ScrollView>
                        </View>
                      </Modal>
                    )}

                    {showDriverCheckout && (
                      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={() => { setShowDriverCheckout(false); setDriverPaymentProcessing(false); }}>
                        <View style={styles.checkoutModalWrap}>
                          <View style={styles.checkoutHeader}>
                            <View>
                              <Text style={styles.checkoutTitle}>Secure payment</Text>
                              <Text style={styles.checkoutSubtitle}>Complete the ₹10 driver subscription.</Text>
                            </View>
                            <Pressable
                              onPress={() => {
                                setShowDriverCheckout(false);
                                setDriverPaymentProcessing(false);
                              }}
                            >
                              <Text style={styles.checkoutClose}>Close</Text>
                            </Pressable>
                          </View>
                          <View style={styles.checkoutWebviewShell}>
                            <WebView
                              source={{ html: driverCheckoutHtml }}
                              onMessage={handleDriverCheckoutMessage}
                              javaScriptEnabled
                              domStorageEnabled
                              originWhitelist={['*']}
                              startInLoadingState
                              style={styles.checkoutWebview}
                            />
                          </View>
                        </View>
                      </Modal>
                    )}
                    
                    <View style={{marginVertical: 12, alignItems: 'center'}}>
                      <Text style={{fontSize: 12, color: '#666', marginBottom: 8}}>Driver Photo (Required)</Text>
                      {driverPhotoUri ? (
                        <View style={{width: 100, height: 100, borderRadius: 50, marginBottom: 10, overflow: 'hidden', borderWidth: 2, borderColor: '#007AFF'}}>
                          <Image source={{ uri: driverPhotoUri }} style={{width: '100%', height: '100%'}} />
                        </View>
                      ) : (
                        <View style={{width: 100, height: 100, borderRadius: 50, marginBottom: 10, backgroundColor: '#E8E8E8', justifyContent: 'center', alignItems: 'center'}}>
                          <Text style={{fontSize: 40}}>📷</Text>
                        </View>
                      )}
                      <Pressable style={[styles.primaryButton, {marginBottom: 10, backgroundColor: '#0B61FF'}]} onPress={pickDriverPhoto}>
                        <Text style={[styles.buttonText, {color:'#FFFFFF'}]}>{driverPhotoUrl ? '✓ Photo Uploaded' : 'Upload Photo *'}</Text>
                      </Pressable>
                    </View>
                    
                    <Pressable
                      style={styles.primaryButton}
                      onPress={async () => {
                        const verifiedDriverPhone = normalizePhoneDigits(profilePhone || mobileNumber || driverPhone);
                        const finalDriverName = (driverName || profileName).trim();
                        if (!finalDriverName || !vehiclePlate) {
                          Alert.alert('Required', 'Fill all details.');
                          return;
                        }
                        if (!isValidMobileFn(verifiedDriverPhone)) {
                          Alert.alert('OTP mobile required', 'Please login again with OTP so your verified mobile number can be attached to the driver documents.');
                          return;
                        }
                        if (!isValidVehiclePlate(vehiclePlate)) {
                          Alert.alert('Invalid vehicle plate', 'Enter a valid Indian vehicle number plate (e.g., MH12AB1234).');
                          return;
                        }
                        if (!driverPhotoUri && !driverPhotoUrl) {
                          Alert.alert('Photo required', 'Please upload a profile photo before proceeding.');
                          return;
                        }
                        setDriverName(finalDriverName);
                        setDriverPhone(verifiedDriverPhone);
                        if (currentUserId) {
                          await setDoc(doc(db, 'users', currentUserId), {
                            name: finalDriverName,
                            phone: verifiedDriverPhone,
                          }, { merge: true });
                        }
                        await ensureDeviceInstallId();
                        setShowDriverVerification(true);
                      }}
                    >
                      <Text style={styles.buttonText}>Go Online</Text>
                    </Pressable>
                </View>
            ) : currentRide ? (
              <View>
                <Text style={styles.sectionTitle}>{currentRide.status === 'started' ? "Trip On" : "New Job"}</Text>
                {currentRide.status === 'accepted' ? (
                  <>
                    {currentRide.comboMode === 'PARCEL_PLUS_BIKE' && (
                      <View style={styles.shareDriverFlowCard}>
                        <Text style={styles.shareDriverFlowTitle}>Combo Job: Delivery + Passenger</Text>
                        <Text style={styles.shareDriverFlowSub}>Total earning: ₹{currentRide.comboTotalFare || ((currentRide.comboParcelFare || 0) + currentRide.fare)}</Text>
                        <Text style={styles.shareDriverTaskMeta}>
                          {(currentRide.comboStage || 'parcel_pickup') === 'parcel_pickup' ? 'Step 1/4: Pickup Parcel' :
                           (currentRide.comboStage || 'parcel_pickup') === 'passenger_pickup' ? 'Step 2/4: Pickup Passenger' :
                           (currentRide.comboStage || 'parcel_pickup') === 'passenger_drop' ? 'Step 3/4: Drop Passenger' :
                           'Step 4/4: Drop Parcel'}
                        </Text>

                        {(currentRide.comboStage || 'parcel_pickup') === 'parcel_pickup' && (
                          <>
                            <Pressable style={styles.navButton} onPress={() => openGoogleMaps((currentRide.comboParcelPickup || currentRide.pickup).latitude, (currentRide.comboParcelPickup || currentRide.pickup).longitude, 'Parcel Pickup')}>
                              <Text style={styles.navButtonText}>📦 Go to Parcel Pickup</Text>
                            </Pressable>
                            <TextInput style={styles.input} placeholder="Enter Parcel OTP" value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" />
                            <Pressable style={styles.primaryButton} onPress={async () => {
                              const expected = decryptOTP(currentRide.comboParcelEncryptedOTP || currentRide.encryptedOTP);
                              if (otpInput.trim() !== expected) return Alert.alert('Error', 'Invalid parcel OTP');
                              await updateRideSafely(currentRide.id, { comboStage: 'passenger_pickup' }, () => {
                                setCurrentRide(null);
                              });
                              setOtpInput('');
                            }}>
                              <Text style={styles.buttonText}>Confirm Parcel Pickup</Text>
                            </Pressable>
                          </>
                        )}

                        {(currentRide.comboStage || 'parcel_pickup') === 'passenger_pickup' && (
                          <>
                            <Pressable style={styles.navButton} onPress={() => openGoogleMaps(currentRide.pickup.latitude, currentRide.pickup.longitude, 'Passenger Pickup')}>
                              <Text style={styles.navButtonText}>👤 Go to Passenger Pickup</Text>
                            </Pressable>
                            <TextInput style={styles.input} placeholder="Enter Passenger OTP" value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" />
                            <Pressable style={styles.primaryButton} onPress={async () => {
                              if (decryptOTP(currentRide.encryptedOTP) !== otpInput.trim()) return Alert.alert('Error', 'Invalid passenger OTP');
                              await updateRideSafely(currentRide.id, {
                                comboStage: 'passenger_drop',
                                status: 'started',
                                startedAtMs: Date.now(),
                                ...(currentRide.pickupReachMinutes ? {} : { pickupReachMinutes: getPickupReachMinutes(currentRide) }),
                              }, () => {
                                setCurrentRide(null);
                              });
                              setOtpInput('');
                            }}>
                              <Text style={styles.buttonText}>Confirm Passenger Pickup</Text>
                            </Pressable>
                          </>
                        )}
                      </View>
                    )}

                    {currentRide.comboMode !== 'PARCEL_PLUS_BIKE' && currentRide.type === 'ShareAuto' && (currentRide.shareAutoPassengerIds?.length || 0) > 1 ? (() => {
                      const passengerCount = currentRide.shareAutoPassengerIds?.length || 0;
                      const pickupDone = currentRide.shareAutoPickupCompletedIds || [];
                      const dropDone = currentRide.shareAutoDropCompletedIds || [];
                      const pickupPhase = pickupDone.length < passengerCount;
                      const pickupCards = getOrderedSharePassengers(currentRide).filter((p) => !pickupDone.includes(p.id));
                      const dropCards = getOrderedShareDropPassengers(currentRide).filter((p) => !dropDone.includes(p.id));
                      const activePassenger = pickupPhase
                        ? pickupCards.find((p) => p.id === selectedSharePassengerId)
                        : dropCards.find((p) => p.id === selectedSharePassengerId);

                      return (
                        <View style={styles.shareDriverFlowCard}>
                          <Text style={styles.shareDriverFlowTitle}>Share Ride Driver Panel</Text>
                          <Text style={styles.shareDriverFlowSub}>{pickupPhase ? 'Pickup cards: nearest to farthest' : 'Drop cards: nearest to farthest'}</Text>

                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                            {(pickupPhase ? pickupCards : dropCards).map((passenger, index) => (
                              <Pressable
                                key={passenger.id}
                                style={[
                                  styles.shareDriverTaskCard,
                                  selectedSharePassengerId === passenger.id && styles.shareDriverTaskCardSelected
                                ]}
                                onPress={() => setSelectedSharePassengerId(passenger.id)}
                              >
                                <Text style={styles.shareDriverTaskTitle}>{index + 1}. {passenger.name}</Text>
                                <Text style={styles.shareDriverTaskMeta}>{pickupPhase ? (passenger as any).pickupAddr : (passenger as any).dropAddr}</Text>
                                <Text style={styles.shareDriverTaskMeta}>{pickupPhase ? 'Pickup' : 'Drop'} • {(passenger.distanceFromDriver || 0).toFixed(1)} km</Text>
                              </Pressable>
                            ))}
                          </ScrollView>

                          {activePassenger && (
                            <View style={styles.shareDriverActionCard}>
                              <Text style={styles.shareDriverTaskTitle}>{activePassenger.name}</Text>
                              {!!activePassenger.phone && (
                                <Pressable style={styles.callBtn} onPress={() => openDialPad(activePassenger.phone)}>
                                  <Text style={styles.callBtnText}>Call Passenger</Text>
                                </Pressable>
                              )}
                              <Pressable
                                style={styles.navButton}
                                onPress={() => openGoogleMaps(
                                  pickupPhase ? (activePassenger as any).pickup.latitude : (activePassenger as any).drop.latitude,
                                  pickupPhase ? (activePassenger as any).pickup.longitude : (activePassenger as any).drop.longitude,
                                  pickupPhase ? `${activePassenger.name} Pickup` : `${activePassenger.name} Drop`
                                )}
                              >
                                <Text style={styles.navButtonText}>{pickupPhase ? '📍 Go to Pickup' : '🏁 Go to Drop'}</Text>
                              </Pressable>

                              {pickupPhase ? (
                                <>
                                  <TextInput style={styles.input} placeholder="Enter Passenger OTP" value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" />
                                  <Pressable style={styles.primaryButton} onPress={handleSharePickupConfirm}>
                                    <Text style={styles.buttonText}>Confirm Pickup</Text>
                                  </Pressable>
                                </>
                              ) : (
                                <Pressable style={styles.primaryButton} onPress={handleShareDropComplete}>
                                  <Text style={styles.buttonText}>Complete Drop</Text>
                                </Pressable>
                              )}
                            </View>
                          )}
                        </View>
                      );
                    })() : (
                      <View style={styles.contactCard}>
                        <Text style={styles.contactTitle}>Passenger Contact</Text>
                        <Text style={styles.contactText}>{currentRide.passengerName || 'Passenger'}</Text>
                        <Text style={styles.contactText}>{currentRide.passengerPhone || 'N/A'}</Text>
                        {!!currentRide.passengerPhone && (
                          <Pressable style={styles.callBtn} onPress={() => openDialPad(currentRide.passengerPhone)}>
                            <Text style={styles.callBtnText}>Call Passenger</Text>
                          </Pressable>
                        )}
                      </View>
                    )}
                    {currentRide.comboMode !== 'PARCEL_PLUS_BIKE' && !(currentRide.type === 'ShareAuto' && (currentRide.shareAutoPassengerIds?.length || 0) > 1) && (
                      <>
                        <Pressable style={styles.navButton} onPress={() => openGoogleMaps(currentRide.pickup.latitude, currentRide.pickup.longitude, "Pickup")}><Text style={styles.navButtonText}>📍 Go to Pickup</Text></Pressable>
                        <TextInput style={styles.input} placeholder="Enter OTP" value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" />
                        <Pressable style={styles.primaryButton} onPress={async () => {
                             if(decryptOTP(currentRide.encryptedOTP) === otpInput) {
                                await updateRideSafely(currentRide.id, {
                                  status: 'started',
                                  startedAtMs: Date.now(),
                                  ...(currentRide.pickupReachMinutes ? {} : { pickupReachMinutes: getPickupReachMinutes(currentRide) }),
                                }, () => {
                                  setCurrentRide(null);
                                });
                                setOtpInput('');
                             } else Alert.alert("Error", "Invalid OTP");
                        }}><Text style={styles.buttonText}>Start Trip</Text></Pressable>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {currentRide.comboMode === 'PARCEL_PLUS_BIKE' ? (
                      <>
                        {(currentRide.comboStage || 'passenger_drop') === 'passenger_drop' ? (
                          <>
                            <Pressable style={[styles.navButton, {backgroundColor: '#34C759'}]} onPress={() => openGoogleMaps(currentRide.drop.latitude, currentRide.drop.longitude, 'Passenger Drop')}><Text style={styles.navButtonText}>🏁 Go to Passenger Drop</Text></Pressable>
                            <Pressable style={styles.primaryButton} onPress={async () => {
                              await updateRideSafely(currentRide.id, { comboStage: 'parcel_drop' }, () => {
                                setCurrentRide(null);
                              });
                            }}><Text style={styles.buttonText}>Confirm Passenger Drop</Text></Pressable>
                          </>
                        ) : (
                          <>
                            <Pressable style={[styles.navButton, {backgroundColor: '#34C759'}]} onPress={() => openGoogleMaps((currentRide.comboParcelDrop || currentRide.drop).latitude, (currentRide.comboParcelDrop || currentRide.drop).longitude, 'Parcel Drop')}><Text style={styles.navButtonText}>📦 Go to Parcel Drop</Text></Pressable>
                            <Pressable style={styles.cancelButton} onPress={async () => {
                                const finalDrop = currentRide.comboParcelDrop || currentRide.drop;
                              if (location && calcDist(location, finalDrop) <= 1) {
                                    const settlement = await settleEarnFlowForCompletedRide(currentRide);
                                    const comboBasePayout = currentRide.comboTotalFare || ((currentRide.comboParcelFare || 0) + currentRide.fare);
                                    const comboFinalFare = comboBasePayout + settlement.appFeeToApp;
                                    const bill = await addRideHistoryEntry(currentRide, 'completed', undefined, {
                                      finalFare: comboFinalFare,
                                      driverPayout: comboBasePayout,
                                      appFeeToApp: settlement.appFeeToApp,
                                    });
                                    driverRideBillSeenRef.current = bill.id || driverRideBillSeenRef.current;
                                    openRideBill(bill);
                                    setDriverStats(prev => ({...prev, completed: prev.completed + 1, earnings: prev.earnings + comboBasePayout}));
                                    await deleteDoc(doc(db, 'rides', currentRide.id!));
                                    setCurrentRide(null);
                              } else Alert.alert('Notice', 'Arrive within 1 km of parcel drop first');
                            }}><Text style={styles.buttonText}>Complete Combo Job</Text></Pressable>
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <Pressable style={[styles.navButton, {backgroundColor: '#34C759'}]} onPress={() => openGoogleMaps(currentRide.drop.latitude, currentRide.drop.longitude, "Dropoff")}><Text style={styles.navButtonText}>🏁 Go to Destination</Text></Pressable>
                        <Pressable style={styles.cancelButton} onPress={async () => {
                          if (location && calcDist(location, currentRide.drop) <= 1) {
                                const settlement = await settleEarnFlowForCompletedRide(currentRide);
                                const bill = await addRideHistoryEntry(currentRide, 'completed', undefined, settlement);
                                driverRideBillSeenRef.current = bill.id || driverRideBillSeenRef.current;
                                openRideBill(bill);
                                setDriverStats(prev => ({...prev, completed: prev.completed + 1, earnings: prev.earnings + settlement.driverPayout}));
                                await deleteDoc(doc(db, 'rides', currentRide.id!));
                                setCurrentRide(null);
                          } else Alert.alert("Notice", "Arrive within 1 km of destination first");
                        }}><Text style={styles.buttonText}>Complete</Text></Pressable>
                      </>
                    )}
                  </>
                )}
                <Pressable style={styles.chatButton} onPress={() => setChatOpen(true)}>
                  <Text style={styles.chatButtonText}>Open Chat</Text>
                  {hasUnreadChat && <View style={styles.unreadDot} />}
                </Pressable>
                <Pressable style={[styles.detailsBtn, {marginTop: 10}]} onPress={() => setShowDetails(true)}><Text style={styles.detailsBtnText}>View Trip Details</Text></Pressable>
              </View>
            ) : (
              <View>
                <View style={styles.row}>
                    <Text style={styles.sectionTitle}>Available ({searchRadius}km)</Text>
                </View>
                <View style={[styles.driverAvailabilityCard, { marginTop: 12, marginBottom: 12 }]}> 
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverAvailabilityTitle}>Ride Requests</Text>
                    <Text style={styles.driverAvailabilityHint}>{driverOnline ? 'You are online and receiving requests' : 'You are offline and hidden from requests'}</Text>
                  </View>
                  <Switch
                    value={driverOnline}
                    onValueChange={setDriverOnline}
                    trackColor={{ false: '#CBD5E1', true: '#86EFAC' }}
                    thumbColor={driverOnline ? '#16A34A' : '#F8FAFC'}
                  />
                </View>
                {(visibleDriverRides.length === 0 || (penalty !== "CLEAR" && penalty !== "WARNING" && penalty !== "BEHAVIOR_WARNING")) ? (
                  <Text style={styles.emptyText}>
                      {!driverOnline
                      ? "🔕 You are offline. Turn on Ride Requests to get trips."
                      : (penalty !== "CLEAR" && penalty !== "WARNING" && penalty !== "BEHAVIOR_WARNING") 
                      ? "❌ Access Restricted." 
                      : "Waiting for requests..."}
                  </Text>
                ) : (
                  <>
                  <ScrollView style={styles.driverNotificationsScroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    {visibleDriverRides.map((r: Ride) => (
                    <View key={r.id} style={styles.notificationCard}>
                      {(() => {
                        const pickupDistanceKm = location ? calcDist(location, r.pickup) : null;
                        const pickupEtaMinutes = pickupDistanceKm !== null ? calcSegmentEtaMinutes(pickupDistanceKm) : null;
                        const pickupNearbyArea = getNearestPopularArea(r.pickup);
                        const dropNearbyArea = getNearestPopularArea(r.drop);
                        const pickupArea = getPrimaryAreaName(r.pickupAddr, pickupNearbyArea);
                        const dropArea = getPrimaryAreaName(r.dropAddr, dropNearbyArea);
                        const pickupMandal = getMandalName(r.pickupAddr, pickupNearbyArea);
                        const dropMandal = getMandalName(r.dropAddr, dropNearbyArea);
                        return (
                      <View style={styles.notifHeader}>
                        <Text style={{fontSize: 28}}>{icons[r.type]}</Text>
                        <View style={{flex: 1, marginLeft: 10}}>
                          <Text style={styles.highlightPrice}>₹{r.comboMode === 'PARCEL_PLUS_BIKE' ? (r.comboTotalFare || ((r.comboParcelFare || 0) + r.fare)) : r.fare} {r.tip > 0 && `(+₹${r.tip})`}</Text>
                          <Text style={{color:'#8E8E93', fontSize: 12}}>{r.comboMode === 'PARCEL_PLUS_BIKE' ? `${(r.comboTotalDistance || r.distance).toFixed(1)} km combo` : (r.type === 'Parcel' ? `${r.distance.toFixed(1)} km delivery` : `${r.distance.toFixed(1)} km ride`)}</Text>
                          <Text style={styles.routeText}>{pickupArea} ➔ {dropArea}</Text>
                          <Text style={{color:'#8E8E93', fontSize: 12}}>Mandal: {pickupMandal} ➔ {dropMandal}</Text>
                          <Text style={{color:'#8E8E93', fontSize: 12}}>
                            {pickupDistanceKm !== null
                              ? `You to pickup: ${pickupDistanceKm.toFixed(1)} km • ~${pickupEtaMinutes} min`
                              : 'You to pickup: waiting for location...'}
                          </Text>
                          {r.comboMode === 'PARCEL_PLUS_BIKE' && (
                            <View style={styles.parcelSingleNotifCard}>
                              <Text style={styles.parcelSingleNotifTitle}>COMBO • Delivery + Passenger Ride</Text>
                              <Text style={styles.parcelSingleNotifMeta}>Parcel: {(r.comboParcelPickupAddr || 'Parcel Pickup')} ➔ {(r.comboParcelDropAddr || 'Parcel Drop')}</Text>
                              <Text style={styles.parcelSingleNotifMeta}>Passenger: {(r.pickupAddr || 'Passenger Pickup')} ➔ {(r.dropAddr || 'Passenger Drop')}</Text>
                              <Text style={styles.parcelSingleNotifMeta}>Flow: parcel pickup ➔ passenger pickup ➔ passenger drop ➔ parcel drop</Text>
                            </View>
                          )}
                          {r.type === 'Parcel' && (
                            <View style={styles.parcelSingleNotifCard}>
                              <Text style={styles.parcelSingleNotifTitle}>Parcel delivery request</Text>
                              <Text style={styles.parcelSingleNotifMeta}>Bike or cycle drivers • not a ride</Text>
                              <Text style={styles.parcelSingleNotifMeta}>Cycle parcels must stay within 4 km of your location</Text>
                            </View>
                          )}
                          {r.type === 'ShareAuto' && (
                            <>
                              {(() => {
                                const summary = getShareNotificationSummary(r);
                                return (
                                  <View style={styles.shareSingleNotifCard}>
                                    <Text style={styles.shareSingleNotifTitle}>Priority Share Ride • {r.shareAutoSeats || 0} passengers</Text>
                                    <Text style={styles.shareSingleNotifMeta}>Driver can earn: ₹{summary.totalFare}</Text>
                                    <Text style={styles.shareSingleNotifMeta}>Total travel: {summary.totalDistance.toFixed(1)} km</Text>
                                    <Text style={styles.shareSingleNotifMeta}>From: {summary.fromAddr}</Text>
                                    <Text style={styles.shareSingleNotifMeta}>To: {summary.toAddr}</Text>
                                  </View>
                                );
                              })()}
                            </>
                          )}
                        </View>
                      </View>
                        );
                      })()}
                      <View style={styles.row}>
                        <Pressable style={styles.negButton} onPress={() => setIgnoredRides([...ignoredRides, r.id!])}><Text style={{color: '#8E8E93'}}>Skip</Text></Pressable>
                        <Pressable style={styles.accButton} onPress={() => acceptRide(r)}><Text style={styles.accText}>ACCEPT</Text></Pressable>
                      </View>
                    </View>
                    ))}
                    </ScrollView>
                  <TouchableOpacity onPress={() => { AsyncStorage.removeItem('driver_vehicle'); setDriverVehicle(null); setIsIdentitySet(false); }} style={{marginTop: 15}}><Text style={{color: '#8E8E93', textAlign:'center'}}>Change Vehicle</Text></TouchableOpacity>
                  </>
                )}
              </View>
            )}
          </ScrollView>
        )}
      </Animated.View>

      {/* TRIP INFO MODAL */}
      <Modal visible={showDetails} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Trip Information</Text>
            <ScrollView style={{maxHeight: 500}}>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>From:</Text>
                  <Text style={styles.valText}>{mode === 'USER' ? getUserPerspectivePickupAddr(userBookedRide) : (currentRide?.pickupAddr || 'N/A')}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>To:</Text>
                  <Text style={styles.valText}>{mode === 'USER' ? getUserPerspectiveDropAddr(userBookedRide) : (currentRide?.dropAddr || 'N/A')}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Final Fare:</Text>
                  <Text style={[styles.valText, {color:'#34C759', fontWeight:'bold'}]}>₹{mode === 'USER' ? getUserPerspectiveFare(userBookedRide) : currentRide?.fare}</Text>
                </View>

                {mode === 'USER' && userBookedRide && (
                    <View style={{marginTop: 20}}>
                        {userBookedRide.type === 'ShareAuto' && (
                          <View style={styles.yellowTermsCard}>
                            <Text style={styles.termsHeading}>ShareAuto fare note</Text>
                            <Text style={styles.termsPoint}>If only 2 passengers are matched, fare uses 14 + mX + K.</Text>
                            <Text style={styles.termsPoint}>If you cancel after matching, a partial-share adjustment may apply based on trip distance.</Text>
                          </View>
                        )}
                        {userBookedRide.status === 'waiting' ? (
                            // CHANGE 1: DIRECT CANCEL BUTTON 
                            <TouchableOpacity style={styles.cancelButton} onPress={() => cancelRide(userBookedRide.id!, false)}>
                                <Text style={styles.buttonText}>Cancel Ride Request</Text>
                            </TouchableOpacity>
                        ) : userBookedRide.status === 'accepted' && (
                            <>
                                <Text style={styles.cancelTitle}>Why are you cancelling?</Text>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'changed_plan')}><Text>I changed my plan</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'mistake')}><Text>Booked by mistake</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'slow')}><Text>Driver coming slow</Text></TouchableOpacity>
                                <Text style={[styles.cancelTitle, {marginTop: 10}]}>Driver Issues</Text>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'extra_money')}><Text>Driver asking extra money</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'bad_behavior')}><Text>Driver behavior not good</Text></TouchableOpacity>
                                <TouchableOpacity style={styles.reasonBtn} onPress={() => cancelRide(userBookedRide.id!, false, 'cancel_after_otp')}><Text>Driver cancelled after OTP</Text></TouchableOpacity>
                            </>
                        )}
                    </View>
                )}

                {mode === 'DRIVER' && currentRide && (
                    <Pressable style={styles.cancelButton} onPress={() => cancelRide(currentRide.id!, true)}>
                        <Text style={styles.buttonText}>Unassign Trip</Text>
                    </Pressable>
                )}

                <Pressable onPress={() => setShowDetails(false)} style={{marginTop: 15, alignSelf:'center'}}><Text style={{color: '#007AFF', fontWeight:'bold'}}>CLOSE</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* PASSENGER PROFILE SCREEN */}
      <Modal visible={showProfileModal} animationType="slide" onRequestClose={() => setShowProfileModal(false)}>
        <View style={styles.profileScreenWrap}>
          <View style={styles.profileScreenHeader}>
            <Text style={styles.profileScreenTitle}>Passenger Profile</Text>
            <Pressable onPress={() => setShowProfileModal(false)}>
              <Text style={styles.profileScreenClose}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.profileScreenContent}>
            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>My Details</Text>
              <Text style={styles.profileLabel}>Name</Text>
              <TextInput
                style={styles.profileInput}
                value={profileNameEdit}
                onChangeText={setProfileNameEdit}
                placeholder="Enter your name"
              />
              <Pressable style={[styles.primaryButton, isSavingProfileName && { opacity: 0.7 }]} disabled={isSavingProfileName} onPress={saveProfileName}>
                <Text style={styles.buttonText}>{isSavingProfileName ? 'Saving...' : 'Save Name'}</Text>
              </Pressable>

              <Text style={[styles.profileLabel, { marginTop: 12 }]}>Phone Number</Text>
              <Text style={styles.profileValue}>{profilePhone || 'N/A'}</Text>

              <Text style={[styles.profileLabel, { marginTop: 12 }]}>Earn Wallet</Text>
              <Text style={styles.profileWalletValue}>₹{profileEarnWallet}</Text>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Ride History (Last 28 Days)</Text>
              <Text style={styles.profileHistoryMeta}>{passengerHistoryLast28Days.length} rides in the last 28 days</Text>
              {passengerHistoryLast28Days.length === 0 ? (
                <Text style={styles.profileValue}>No rides in this period.</Text>
              ) : passengerHistoryLast28Days.slice(0, 8).map((entry) => (
                <View key={entry.id} style={styles.profileHistoryRow}>
                  <Text style={styles.profileHistoryRoute}>{entry.pickupAddr || 'Unknown'} ➔ {entry.dropAddr || 'Unknown'}</Text>
                  <Text style={styles.profileHistoryStatus}>{entry.status === 'completed' ? 'Completed' : 'Cancelled'} • ₹{entry.fare}</Text>
                </View>
              ))}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                <Pressable style={[styles.primaryButton, { flex: 1 }]} onPress={() => setShowPassengerHistoryModal(true)}>
                  <Text style={styles.buttonText}>View All</Text>
                </Pressable>
                <Pressable style={[styles.primaryButton, { flex: 1, backgroundColor: '#DC2626' }]} onPress={clearAllPassengerHistory}>
                  <Text style={styles.buttonText}>Delete History</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Notifications</Text>
              <Text style={styles.profileValue}>{passengerNotifications.length} active notifications</Text>
              <Pressable style={[styles.primaryButton, { marginTop: 12 }]} onPress={() => setShowNotificationsModal(true)}>
                <Text style={styles.buttonText}>View Notifications</Text>
              </Pressable>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Home Location</Text>
              <Text style={styles.profileValue}>
                {homeLocation
                  ? (homeLocationLabel || `${homeLocation.latitude.toFixed(5)}, ${homeLocation.longitude.toFixed(5)}`)
                  : 'Not set yet'}
              </Text>
              <Pressable
                style={[styles.primaryButton, { marginTop: 12 }]}
                onPress={() => {
                  setPendingHomeLocation(homeLocation || location || null);
                  setShowHomeLocationMapModal(true);
                }}
              >
                <Text style={styles.buttonText}>{homeLocation ? 'Edit Home Location' : 'Set Home Location'}</Text>
              </Pressable>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Support</Text>
              <Pressable style={[styles.primaryButton, { marginTop: 8, backgroundColor: '#1D4ED8' }]} onPress={() => setShowHelpModal(true)}>
                <Text style={styles.buttonText}>Help</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, { marginTop: 10, backgroundColor: '#0F766E' }]} onPress={openComplaintEmail}>
                <Text style={styles.buttonText}>Complaint</Text>
              </Pressable>
              <Pressable style={[styles.primaryButton, { marginTop: 10, backgroundColor: '#B91C1C' }]} onPress={logoutFromProfile}>
                <Text style={styles.buttonText}>Logout</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showHelpModal} animationType="slide" onRequestClose={() => setShowHelpModal(false)}>
        <View style={styles.profileScreenWrap}>
          <View style={styles.profileScreenHeader}>
            <Text style={styles.profileScreenTitle}>Help & Community</Text>
            <Pressable onPress={() => setShowHelpModal(false)}>
              <Text style={styles.profileScreenClose}>Close</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.profileScreenContent}>
            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Ask a Question</Text>
              <TextInput
                style={[styles.profileInput, { minHeight: 90, textAlignVertical: 'top' }]}
                multiline
                placeholder="Type your question"
                value={helpQuestionText}
                onChangeText={setHelpQuestionText}
              />
              <Pressable style={[styles.primaryButton, { marginTop: 10 }]} onPress={postHelpQuestion}>
                <Text style={styles.buttonText}>Send Question</Text>
              </Pressable>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>FAQs</Text>
              <Text style={styles.profileHistoryStatus}>1. How to cancel ride? Open Trip Info and select a reason.</Text>
              <Text style={styles.profileHistoryStatus}>2. How is fare calculated? Fare depends on distance and demand.</Text>
              <Text style={styles.profileHistoryStatus}>3. How to report driver issue? Use Trip Info → Driver Issues.</Text>
              <Text style={styles.profileHistoryStatus}>4. How to contact support? Use Complaint button in Profile.</Text>
            </View>

            <View style={styles.profileCard}>
              <Text style={styles.profileCardTitle}>Community Questions</Text>
              {helpQuestions.length === 0 ? (
                <Text style={styles.profileValue}>No questions yet. Be the first to ask.</Text>
              ) : helpQuestions.map((q) => (
                <View key={q.id} style={styles.profileHistoryRow}>
                  <Text style={styles.profileHistoryRoute}>{q.question}</Text>
                  <Text style={styles.profileHistoryStatus}>Asked by {q.askedByName || 'Passenger'}</Text>
                  {(q.answers || []).slice().sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0)).map((ans, idx) => (
                    <Text key={`${q.id}_ans_${idx}`} style={[styles.profileHistoryStatus, { color: '#155E75' }]}>• {ans.byName}: {ans.text}</Text>
                  ))}
                  {!!q.id && (
                    <>
                      <TextInput
                        style={[styles.profileInput, { marginTop: 8 }]}
                        placeholder="Write an answer"
                        value={helpAnswerDrafts[q.id] || ''}
                        onChangeText={(text) => setHelpAnswerDrafts((prev) => ({ ...prev, [q.id!]: text }))}
                      />
                      <Pressable style={[styles.primaryButton, { marginTop: 8, backgroundColor: '#0E7490' }]} onPress={() => postHelpAnswer(q.id!)}>
                        <Text style={styles.buttonText}>Post Answer</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={showRideStartedGameModal} animationType="slide" onRequestClose={() => {
        setShowRideStartedGameModal(false);
        setShowRideHomeButton(true);
      }}>
        <View style={styles.rideGameWrap}>
          <View style={styles.rideGameHeader}>
            <Pressable onPress={() => {
              setShowRideStartedGameModal(false);
              setShowRideHomeButton(true);
            }}>
              <Text style={styles.rideGameHeaderBtn}>Back</Text>
            </Pressable>
            <Text style={styles.rideGameTitle}>Ride Started</Text>
            <Pressable onPress={() => {
              setShowRideStartedGameModal(false);
              setShowRideHomeButton(true);
            }}>
              <Text style={styles.rideGameHeaderBtn}>Main Screen</Text>
            </Pressable>
          </View>

          <View style={styles.rideCongratsCard}>
            <Text style={styles.rideCongratsTitle}>🎉 Congratulations</Text>
            <Text style={styles.rideCongratsSub}>Your ride has started. Enjoy while you travel!</Text>
            <Text style={styles.rideSparkle}>{rideGameSparkle % 2 === 0 ? '✨🛺✨' : '💫🛺💫'}</Text>
          </View>

          <View style={styles.rideTrackCard}>
            <Text style={styles.rideTrackLabel}>Distance Progress</Text>
            <View style={styles.rideProgressBarBg}>
              <View style={[styles.rideProgressBarFill, { width: `${rideGameProgress}%` }]} />
            </View>
            <Text style={styles.rideTrackMeta}>{Math.round(rideGameProgress)}% route simulated</Text>

            <Text style={styles.rideLivesText}>Lives: {rideGameLives} • {rideGameStatus === 'running' ? 'Dodge the obstacles!' : rideGameStatus === 'crashed' ? 'You crashed!' : 'Route complete!'}</Text>
            <Text style={styles.rideGameHint}>Use steering buttons to avoid cones and barriers. Stay in the lane and keep the ride moving.</Text>
            <View style={styles.rideRoadArea}>
              <View style={styles.rideRoadStripe} />
              {rideGameObstacles.map((obs) => (
                <View key={obs.id} style={[styles.rideObstacle, { left: `${obs.x}%`, top: `${obs.y}%` }]}>
                  <Text style={styles.rideObstacleText}>🚧</Text>
                </View>
              ))}
              <Text style={[styles.rideAutoIcon, { left: `${Math.min(82, Math.max(8, 50 + rideGameSteer))}%` }]}>🛺</Text>
            </View>

            {rideGameStatus === 'crashed' && <Text style={styles.rideCrashText}>Crash detected! Tap Retry and steer away from the next obstacle.</Text>}
            {rideGameStatus === 'finished' && <Text style={styles.rideFinishedText}>Nice! You finished the route safely.</Text>}
            {rideGameStatus === 'gameover' && <Text style={styles.rideCrashText}>Game over! You have no lives left.</Text>}

            <View style={styles.rideControlRow}>
              <Pressable
                style={[styles.rideControlBtn, rideGameStatus !== 'running' && styles.disabledControlBtn]}
                onPress={() => rideGameStatus === 'running' && setRideGameSteer((prev) => Math.max(-35, prev - 10))}
              >
                <Text style={styles.rideControlText}>◀ Move Left</Text>
              </Pressable>
              <Pressable
                style={[styles.rideControlBtn, rideGameStatus !== 'running' && styles.disabledControlBtn]}
                onPress={() => rideGameStatus === 'running' && setRideGameSteer((prev) => Math.min(35, prev + 10))}
              >
                <Text style={styles.rideControlText}>Move Right ▶</Text>
              </Pressable>
            </View>

            <View style={styles.rideControlRow}>
              <Pressable
                style={[styles.rideControlBtn, { backgroundColor: '#15803D' }, rideGameStatus !== 'running' && styles.disabledControlBtn]}
                onPress={() => rideGameStatus === 'running' && setRideGameSpeed((prev) => Math.min(12, prev + 1.8))}
              >
                <Text style={styles.rideControlText}>Accelerate</Text>
              </Pressable>
              <Pressable
                style={[styles.rideControlBtn, { backgroundColor: '#B91C1C' }, rideGameStatus !== 'running' && styles.disabledControlBtn]}
                onPress={() => rideGameStatus === 'running' && setRideGameSpeed((prev) => Math.max(0, prev - 2.2))}
              >
                <Text style={styles.rideControlText}>Brake</Text>
              </Pressable>
            </View>

            {(rideGameStatus === 'crashed' || rideGameStatus === 'gameover') && (
              <Pressable
                style={[styles.primaryButton, { marginTop: 8 }]}
                onPress={() => {
                  setRideGameProgress(0);
                  setRideGameSpeed(0);
                  setRideGameSteer(0);
                  setRideGameSparkle(0);
                  setRideGameLives(3);
                  setRideGameStatus('running');
                  setRideGameObstacles([]);
                  rideGameObstacleTimerRef.current = 0;
                }}
              >
                <Text style={styles.buttonText}>{rideGameStatus === 'gameover' ? 'Restart Game' : 'Retry Game'}</Text>
              </Pressable>
            )}
            {rideGameStatus === 'finished' && (
              <Pressable
                style={[styles.primaryButton, { marginTop: 8 }]}
                onPress={() => {
                  setRideGameProgress(0);
                  setRideGameSpeed(0);
                  setRideGameSteer(0);
                  setRideGameSparkle(0);
                  setRideGameLives(3);
                  setRideGameStatus('running');
                  setRideGameObstacles([]);
                  rideGameObstacleTimerRef.current = 0;
                }}
              >
                <Text style={styles.buttonText}>Play Again</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.rideGameBottomActions}>
            <Pressable style={styles.detailsBtn} onPress={() => setShowDetails(true)}><Text style={styles.detailsBtnText}>Trip Info</Text></Pressable>
            {!!userBookedRide?.id && (
              <Pressable style={[styles.cancelButton, { marginTop: 8 }]} onPress={() => cancelRide(userBookedRide.id!, false, 'changed_plan')}>
                <Text style={styles.buttonText}>Cancel Ride</Text>
              </Pressable>
            )}
            <Pressable style={[styles.primaryButton, { marginTop: 8 }]} onPress={() => {
              setShowRideStartedGameModal(false);
              setShowRideHomeButton(true);
            }}>
              <Text style={styles.buttonText}>Back to Main Screen</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showRideBillModal}
        animationType="slide"
        onRequestClose={() => {
          setShowRideBillModal(false);
          setActiveRideBill(null);
        }}
      >
        <View style={{ flex: 1, backgroundColor: '#E8EDF4', padding: 16, paddingTop: 44, paddingBottom: 20 }}>
          <View style={{ flex: 1, backgroundColor: '#FFFDF7', borderRadius: 28, padding: 18, borderWidth: 1, borderColor: '#D8E0EA', shadowColor: '#0F172A', shadowOpacity: 0.14, shadowRadius: 24, elevation: 10 }}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={{ alignItems: 'center', marginBottom: 16 }}>
                <Text style={{ color: '#64748B', fontSize: 12, fontWeight: '800', letterSpacing: 2.4 }}>TRIP BILL</Text>
                <Text style={{ color: '#0F172A', fontSize: 30, fontWeight: '900', marginTop: 6 }}>₹{activeRideBill?.fare?.toFixed ? activeRideBill.fare.toFixed(0) : activeRideBill?.fare || 0}</Text>
                <Text style={{ color: '#475569', textAlign: 'center', marginTop: 6 }}>Saved to history and ready to share.</Text>
              </View>

              <View style={{ backgroundColor: '#F8FAFC', borderRadius: 22, padding: 16, borderWidth: 1, borderColor: '#E2E8F0' }}>
                {[
                  ['Pickup', activeRideBill?.pickupAddr || 'Pickup'],
                  ['Drop', activeRideBill?.dropAddr || 'Drop'],
                  ['Distance', typeof activeRideBill?.distance === 'number' ? `${activeRideBill.distance.toFixed(1)} km` : 'N/A'],
                  ['Total time', typeof activeRideBill?.totalTimeMinutes === 'number' ? `${activeRideBill.totalTimeMinutes} min` : 'N/A'],
                  ['Pickup time', formatBillTime(activeRideBill?.pickupTimeMs)],
                  ['Drop time', formatBillTime(activeRideBill?.dropTimeMs)],
                  ['Driver', activeRideBill?.driverName || 'Driver'],
                  ['Passenger', activeRideBill?.passengerName || 'Passenger'],
                  ['Ride type', activeRideBill?.rideType || 'Ride'],
                ].map(([label, value]) => (
                  <View key={label} style={{ borderBottomWidth: label === 'Ride type' ? 0 : 1, borderBottomColor: '#E2E8F0', paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                    <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '700' }}>{label}</Text>
                    <Text style={{ color: '#0F172A', fontSize: 13, fontWeight: label === 'Pickup' || label === 'Drop' ? '700' : '800', textAlign: 'right', flex: 1 }}>{value}</Text>
                  </View>
                ))}
              </View>

              <View style={{ marginTop: 16, backgroundColor: '#0F172A', borderRadius: 22, padding: 16 }}>
                <Text style={{ color: '#E2E8F0', fontSize: 12, fontWeight: '800', letterSpacing: 1.8 }}>BILL ID</Text>
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800', marginTop: 6 }}>{activeRideBill?.id || 'N/A'}</Text>
                <Text style={{ color: '#CBD5E1', marginTop: 8, lineHeight: 20 }}>This bill is stored in ride history for later reference and can be shared with one tap.</Text>
              </View>
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <Pressable
                style={{ flex: 1, backgroundColor: '#0F766E', borderRadius: 16, paddingVertical: 14, alignItems: 'center' }}
                onPress={shareRideBill}
              >
                <Text style={{ color: '#FFFFFF', fontWeight: '800' }}>Share Bill</Text>
              </Pressable>
              <Pressable
                style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: '#CBD5E1' }}
                onPress={() => {
                  setShowRideBillModal(false);
                  setActiveRideBill(null);
                }}
              >
                <Text style={{ color: '#0F172A', fontWeight: '800' }}>Done</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* PASSENGER RIDE HISTORY MODAL */}
      <Modal visible={showPassengerHistoryModal} transparent animationType="slide" onRequestClose={() => setShowPassengerHistoryModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Ride History</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {passengerHistory.length === 0 ? (
                <Text style={styles.emptyText}>No rides completed or cancelled yet.</Text>
              ) : passengerHistory.map((entry) => (
                <View key={entry.id} style={styles.historyCard}>
                  <Text style={styles.historyRoute}>{entry.pickupAddr || 'Unknown'} ➔ {entry.dropAddr || 'Unknown'}</Text>
                  <Text style={styles.historyMeta}>{entry.status === 'completed' ? 'Completed' : 'Cancelled'} • ₹{entry.fare}</Text>
                  {typeof entry.distance === 'number' && <Text style={styles.historyMeta}>Distance: {entry.distance.toFixed(1)} km</Text>}
                  {typeof entry.totalTimeMinutes === 'number' && <Text style={styles.historyMeta}>Time: {entry.totalTimeMinutes} min</Text>}
                  {entry.pickupTimeMs && <Text style={styles.historyMeta}>Pickup: {formatBillTime(entry.pickupTimeMs)}</Text>}
                  {entry.dropTimeMs && <Text style={styles.historyMeta}>Drop: {formatBillTime(entry.dropTimeMs)}</Text>}
                  {!!entry.driverName && <Text style={styles.historyMeta}>Driver: {entry.driverName}</Text>}
                  <Text style={styles.historyMeta}>{entry.createdAt?.toDate ? entry.createdAt.toDate().toLocaleString() : ''}</Text>
                  {!!entry.id && (
                    <Pressable style={[styles.negButton, { marginTop: 8, alignSelf: 'flex-start' }]} onPress={() => deletePassengerHistoryEntry(entry.id!)}>
                      <Text style={{ color: '#B91C1C', fontWeight: '700' }}>Delete</Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
            {passengerHistory.length > 0 && (
              <Pressable onPress={clearAllPassengerHistory} style={{marginTop: 8, alignSelf:'center'}}>
                <Text style={{color: '#B91C1C', fontWeight:'bold'}}>Delete All</Text>
              </Pressable>
            )}
            <Pressable onPress={() => setShowPassengerHistoryModal(false)} style={{marginTop: 10, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* PASSENGER NOTIFICATIONS MODAL */}
      <Modal visible={showNotificationsModal} transparent animationType="slide" onRequestClose={() => setShowNotificationsModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Notifications</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {passengerNotifications.map((note) => (
                <View key={note.id} style={styles.notificationCard}>
                  <Text style={styles.historyRoute}>{note.title}</Text>
                  <Text style={styles.historyMeta}>{note.message}</Text>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setShowNotificationsModal(false)} style={{marginTop: 10, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* PASSENGER HOME LOCATION MAP */}
      <Modal
        visible={showHomeLocationMapModal}
        animationType="slide"
        onRequestClose={() => {
          setShowHomeLocationMapModal(false);
          setPendingHomeLocation(homeLocation);
        }}
      >
        <View style={styles.driverMapModalWrap}>
          <OSMMapView
            style={styles.driverMapModalMap}
            initialRegion={
              pendingHomeLocation
                ? {
                    ...pendingHomeLocation,
                    latitudeDelta: 0.04,
                    longitudeDelta: 0.04,
                  }
                : location
                  ? { ...location, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                  : DEFAULT_MAP_REGION
            }
            onPress={(event) => {
              const coord = event.nativeEvent.coordinate;
              if (!isWithinHyderabadService(coord)) {
                Alert.alert('Out of service area', `Please select a point within Hyderabad service area (${HYDERABAD_SERVICE_RADIUS_KM} km).`);
                return;
              }
              setPendingHomeLocation(coord);
            }}
            markers={pendingHomeLocation ? [{ coordinate: pendingHomeLocation, title: 'Home', color: '#0F8A47', label: 'H' }] : []}
          />

          <View style={styles.driverMapModalControls}>
            <Text style={styles.driverMapModalTitle}>Pin your home location</Text>
            <Text style={styles.driverMapModalHint}>Tap on map to place marker. You can edit this anytime from Profile.</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.negButton, { marginRight: 8 }]}
                onPress={() => {
                  setShowHomeLocationMapModal(false);
                  setPendingHomeLocation(homeLocation);
                }}
              >
                <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.accButton, !pendingHomeLocation && styles.disabledConfirmBtn]}
                disabled={!pendingHomeLocation}
                onPress={async () => {
                  if (!pendingHomeLocation) return;
                  const savedHomeLabel = await savePassengerHomeLocation(pendingHomeLocation);
                  setShowHomeLocationMapModal(false);
                  if (location) {
                    setPickupCoords(location);
                    const pickupLabel = await getAreaLabelFromCoord(location, getNearestPopularArea(location));
                    setPickupInput(pickupLabel);
                  }
                  setDestCoords(pendingHomeLocation);
                  setDestination(savedHomeLabel || 'Home');
                  setShowGoHomeVehicleModal(true);
                  animatePassengerCard(true);
                }}
              >
                <Text style={styles.accText}>Save Home</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* GO HOME VEHICLE PAGE */}
      <Modal
        visible={showGoHomeVehicleModal}
        animationType="slide"
        onRequestClose={() => setShowGoHomeVehicleModal(false)}
      >
        <View style={styles.goHomeVehiclePageWrap}>
          <View style={styles.goHomeVehicleHeader}>
            <Text style={styles.goHomeVehicleTitle}>Go Home</Text>
            <Pressable onPress={() => setShowGoHomeVehicleModal(false)}>
              <Text style={styles.goHomeVehicleClose}>Close</Text>
            </Pressable>
          </View>

          <View style={styles.goHomeVehicleBody}>
            <Text style={styles.goHomeVehicleSub}>Select your transport mode</Text>
            <Text style={styles.goHomeVehicleRoute}>{pickupInput || 'Current Location'} ➔ {destination || 'Home'}</Text>

            <View style={styles.goHomeVehicleGrid}>
              {(['Bike', 'Auto', 'Cab'] as const).map((type) => (
                <Pressable
                  key={type}
                  style={styles.goHomeVehicleCard}
                  onPress={async () => {
                    setShowGoHomeVehicleModal(false);
                    setSelectedRide(type);
                    await bookRide(type);
                    animatePassengerCard(false);
                  }}
                >
                  <Text style={styles.goHomeVehicleIcon}>{icons[type]}</Text>
                  <Text style={styles.goHomeVehicleName}>{type}</Text>
                  <Text style={styles.goHomeVehicleFare}>₹{fares[type]}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>

      {/* TIP MODAL */}
      <Modal visible={showTipModal} transparent animationType="slide">
        <View style={styles.modalOverlay}><View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>No drivers nearby!</Text>
            <Text style={{textAlign:'center', marginBottom: 15}}>Add a tip to attract drivers from further away.</Text>
            <View style={styles.grid}>{[10, 20, 30, 50].map(amt => (
              <TouchableOpacity key={amt} style={styles.tipOption} onPress={() => handleTip(amt)}><Text style={styles.tipText}>+ ₹{amt}</Text></TouchableOpacity>
            ))}</View>
            <Pressable style={styles.cancelButton} onPress={() => { setShowTipModal(false); cancelRide(userBookedRide?.id!, false); }}><Text style={styles.buttonText}>Cancel Request</Text></Pressable>
        </View></View>
      </Modal>

      {/* PARCEL TERMS */}
      <Modal visible={showParcelTerms} transparent animationType="slide" onRequestClose={() => setShowParcelTerms(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Parcel Delivery</Text>
            <View style={styles.parcelTermsCard}>
              <Text style={styles.parcelTermsHeading}>Please read before sending</Text>
              <Text style={styles.termsPoint}>This is for small parcels only, something you can carry by hand.</Text>
              <Text style={styles.termsPoint}>Bike drivers will see this as a parcel delivery request, not a ride.</Text>
              <Text style={[styles.termsPoint, { color: '#A43412', fontWeight: '900' }]}>Alcoholic compounds, drugs, valuable things (gold ornaments), etc are strictly prohibited, driver checks it before taking, please cooperate us.</Text>
            </View>
            <Pressable style={styles.primaryButton} onPress={async () => { setShowParcelTerms(false); await bookRide('Parcel'); }}>
              <Text style={styles.buttonText}>Agree and Continue</Text>
            </Pressable>
            <Pressable onPress={() => setShowParcelTerms(false)} style={{marginTop: 12, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showEarnPage} animationType="slide" onRequestClose={() => setShowEarnPage(false)}>
        <View style={styles.earnPageWrap}>
          <View style={styles.earnPageHeader}>
            <Pressable onPress={() => setShowEarnPage(false)}>
              <Text style={styles.earnPageBack}>Back</Text>
            </Pressable>
            <Text style={styles.earnPageTitle}>Earn</Text>
            <View style={{ width: 42 }} />
          </View>

          <ScrollView contentContainerStyle={styles.earnPageContent} showsVerticalScrollIndicator={false}>
            <View style={styles.earnSummaryCard}>
              <Text style={styles.earnSummaryLabel}>Earned Amount</Text>
              <Text style={styles.earnSummaryValue}>₹{profileEarnWallet}</Text>
              <Text style={styles.earnSummaryHint}>Every eligible completed Earn booking adds ₹{EARN_REWARD_AMOUNT} to your wallet.</Text>
            </View>

            <View style={styles.earnWithdrawCard}>
              <View style={styles.earnWithdrawTopRow}>
                <View>
                  <Text style={styles.earnWithdrawEyebrow}>Razorpay payout</Text>
                  <Text style={styles.earnWithdrawTitle}>Get my money</Text>
                </View>
                <View style={styles.earnWithdrawBadge}>
                  <Text style={styles.earnWithdrawBadgeText}>Min ₹30</Text>
                </View>
              </View>
              <Text style={styles.earnWithdrawText}>
                Add the mobile number linked to your UPI. Friday night withdrawal is automatic when your balance reaches ₹30.
              </Text>
              <TextInput
                style={styles.earnWithdrawInput}
                placeholder="UPI linked mobile number"
                value={earnWithdrawMobile}
                onChangeText={(v) => setEarnWithdrawMobile(v.replace(/\D/g, '').slice(0, 10))}
                keyboardType="phone-pad"
                maxLength={10}
              />
              <Pressable
                style={[styles.earnMoneyButton, earnWithdrawSaving && { opacity: 0.7 }]}
                onPress={saveEarnWithdrawMobile}
                disabled={earnWithdrawSaving}
              >
                <Text style={styles.earnMoneyButtonText}>{earnWithdrawSaving ? 'Saving...' : 'Get my money'}</Text>
              </Pressable>
              <Pressable
                style={[styles.earnEmergencyButton, (earnEmergencySaving || profileEarnWallet <= 20) && { opacity: 0.55 }]}
                onPress={requestEmergencyEarnWithdraw}
                disabled={earnEmergencySaving || profileEarnWallet <= 20}
              >
                <Text style={styles.earnEmergencyButtonText}>
                  {earnEmergencySaving ? 'Requesting...' : `Emergency withdraw now - fee ₹20, receive ₹${Math.max(0, profileEarnWallet - 20)}`}
                </Text>
              </Pressable>
            </View>

            <View style={styles.earnTermsCard}>
              <Text style={styles.earnTermsTitle}>Terms and conditions</Text>
              <Text style={styles.earnTermsPoint}>• Ride fare must be above ₹120 to earn ₹{EARN_REWARD_AMOUNT}.</Text>
              <Text style={styles.earnTermsPoint}>• Reward is added only after the ride is completed.</Text>
              <Text style={styles.earnTermsPoint}>• Friday night withdrawal is automatic through Razorpay when the wallet has minimum ₹30.</Text>
              <Text style={styles.earnTermsPoint}>• Emergency withdrawal sends the full wallet immediately after deducting ₹20 service fee.</Text>
              <Text style={styles.earnTermsPoint}>• The mobile number must be linked with the UPI account where you want to receive money.</Text>
            </View>

            <Text style={styles.earnSectionTitle}>Passenger Data</Text>
            <TextInput
              style={styles.input}
              placeholder="Passenger Name"
              value={earnPassengerName}
              onChangeText={setEarnPassengerName}
            />
            <TextInput
              style={styles.input}
              placeholder="Passenger Mobile Number"
              value={earnPassengerPhone}
              onChangeText={(v) => setEarnPassengerPhone(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              maxLength={10}
            />
            <TextInput
              style={styles.input}
              placeholder="Passenger Email"
              value={earnPassengerEmail}
              onChangeText={setEarnPassengerEmail}
              autoCapitalize="none"
            />

            <Text style={styles.earnSectionTitle}>Select Ride Type</Text>
            <View style={styles.rideChoiceGrid}>
              {(['Bike', 'Auto', 'Cab'] as const).map((type) => (
                <Pressable
                  key={type}
                  style={[styles.rideSelectCard, earnRideType === type && styles.selected]}
                  onPress={() => setEarnRideType(type)}
                >
                  <Text style={{fontSize: 24}}>{icons[type]}</Text>
                  <Text style={{fontWeight:'bold'}}>₹{fares[type]}</Text>
                  <Text style={{fontSize: 10}}>{type}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>

          <View style={styles.earnFooter}>
            <Pressable style={styles.primaryButton} onPress={bookEarnRide}>
              <Text style={styles.buttonText}>Book</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* SHARE AUTO TERMS */}
      <Modal visible={showShareAutoIntro} transparent animationType="slide" onRequestClose={() => setShowShareAutoIntro(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>What is ShareAuto?</Text>
            <View style={styles.yellowTermsCard}>
              <Text style={styles.termsPoint}>ShareAuto lets you share the auto with other passengers going in a similar direction.</Text>
              <Text style={styles.termsPoint}>It helps save money by splitting the ride with 2 or 3 members.</Text>
              <Text style={styles.termsPoint}>The app first looks for the best route-based group, then confirms your share ride.</Text>
            </View>
            <Pressable
              style={styles.primaryButton}
              onPress={async () => {
                await AsyncStorage.setItem('shareauto_intro_seen', '1');
                setShowShareAutoIntro(false);
                setShowShareAutoTerms(true);
              }}
            >
              <Text style={styles.buttonText}>Continue</Text>
            </Pressable>
            <Pressable onPress={() => setShowShareAutoIntro(false)} style={{marginTop: 12, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>Close</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* SHARE AUTO TERMS */}
      <Modal visible={showShareAutoTerms} transparent animationType="slide" onRequestClose={() => setShowShareAutoTerms(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>ShareAuto Terms & Conditions</Text>
            <View style={styles.yellowTermsCard}>
              <Text style={styles.termsHeading}>Please read before booking</Text>
              <Text style={styles.termsPoint}>a) Passenger cannot insist pickup inside narrow roads.</Text>
              <Text style={styles.termsPoint}>b) Share auto pickup and drop happen in wide/accessible areas.</Text>
              <Text style={styles.termsPoint}>c) You are responsible for your belongings.</Text>
            </View>
            <Pressable style={styles.primaryButton} onPress={async () => { setShowShareAutoTerms(false); await bookRide('ShareAuto'); }}>
              <Text style={styles.buttonText}>Agree and Continue</Text>
            </Pressable>
            <Pressable onPress={() => setShowShareAutoTerms(false)} style={{marginTop: 12, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* SHARE AUTO FALLBACK */}
      <Modal visible={showShareAutoFallback} transparent animationType="slide" onRequestClose={() => setShowShareAutoFallback(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Sorry, we could not find other passengers</Text>
            <Text style={{textAlign:'center', marginBottom: 12}}>{shareAutoFallbackReason}</Text>
            <Text style={{textAlign:'center', marginBottom: 15}}>Do you want to book Bike for the same pickup and drop location?</Text>
            <TouchableOpacity style={styles.reasonBtn} onPress={async () => { setShowShareAutoFallback(false); await bookRide('Bike'); }}>
              <Text>OK, book Bike</Text>
            </TouchableOpacity>
            <Pressable onPress={() => {
              setShowShareAutoFallback(false);
              setSelectedRide(null);
              setDestination('');
              setDestCoords(null);
              Alert.alert('Sorry', 'Sorry, no passengers found. Returning to home screen.');
            }} style={{marginTop: 15, alignSelf:'center'}}>
              <Text style={{color: '#007AFF', fontWeight:'bold'}}>No, go home</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* SHARE AUTO SEARCH SCREEN */}
      <Modal visible={shareAutoSearchActive} animationType="slide" onRequestClose={cancelShareAutoSearch}>
        <View style={styles.shareAutoScreen}>
          <View style={styles.shareAutoTopGlow} />
          <Text style={styles.shareAutoBadge}>ShareAuto Search</Text>
          <Animated.View style={[styles.shareAutoOrb, { transform: [{ scale: shareAutoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.12] }) }] }]}>
            <Text style={styles.shareAutoOrbIcon}>👥</Text>
          </Animated.View>
          <Text style={styles.shareAutoTitle}>Looking for passengers heading the same way</Text>
          <Text style={styles.shareAutoSubtitle}>We confirm a group as soon as 3 passengers are found, otherwise keep searching up to 3 minutes.</Text>

          <View style={styles.shareAutoTimerCard}>
            <Text style={styles.shareAutoTimerLabel}>Searching time</Text>
            <Text style={styles.shareAutoTimerValue}>{shareAutoElapsed}s</Text>
            <Text style={styles.shareAutoTimerHint}>Up to 3 passengers only</Text>
            {!shareAutoPoolId && <Text style={styles.shareAutoSetupHint}>Initializing secure matching...</Text>}
            {shareAutoPoolId && (
              <Text style={styles.shareAutoFoundHint}>
                {shareAutoFoundMembers >= 3
                  ? 'Congratulations! All passengers found.'
                  : shareAutoFoundMembers === 2
                    ? '2 passengers found'
                    : 'Searching for members...'}
              </Text>
            )}
            {shareAutoElapsed >= 120 && shareAutoFoundMembers === 0 && (
              <Text style={styles.shareAutoSorryText}>Sorry for not getting other persons.</Text>
            )}
          </View>

          <View style={styles.shareAutoDotsRow}>
            <Animated.View style={[styles.shareAutoDot, { opacity: shareAutoPulse }]} />
            <Animated.View style={[styles.shareAutoDot, { opacity: shareAutoPulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) }]} />
            <Animated.View style={[styles.shareAutoDot, { opacity: shareAutoPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }) }]} />
          </View>

          <Pressable style={styles.shareAutoGameBtn} onPress={() => { void playGameSound('ui'); setShowShareAutoGame(true); }}>
            <Text style={styles.shareAutoGameBtnText}>Play Mini Game</Text>
          </Pressable>

          <Pressable style={styles.shareAutoCancelBtn} onPress={cancelShareAutoSearch}>
            <Text style={styles.shareAutoCancelText}>Cancel search</Text>
          </Pressable>
        </View>
      </Modal>

      {/* SHARE AUTO MINI GAME */}
      <Modal visible={showShareAutoGame} animationType="slide" onRequestClose={() => setShowShareAutoGame(false)}>
        <View style={styles.gameWrap}>
          <View style={styles.gameHeader}>
            <Text style={styles.gameTitle}>{gameMode === 'bird' ? 'Bird Hunter' : 'Zombie Shooter'}</Text>
            <Pressable onPress={() => { void playGameSound('ui'); setShowShareAutoGame(false); }}><Text style={styles.gameClose}>Close</Text></Pressable>
          </View>
          {gameMode === 'bird' ? (
            <>
              <Text style={styles.gameMeta}>Bird hits: {birdHits} / 60 • Time left: {gameTimeLeft}s</Text>
              <Text style={styles.gameHint}>Hit the bird as it appears at random places. Reach 60 hits in 45 seconds.</Text>
            </>
          ) : (
            <>
              <Text style={styles.gameMeta}>Zombies shot: {zombieHits}</Text>
              <Text style={styles.gameHint}>Shoot the zombies to secure yourself.</Text>
            </>
          )}
          {shareAutoGamePausedByRide && (
            <Text style={styles.gamePauseHint}>Ride matched. Game paused briefly for your OTP page. You can continue anytime.</Text>
          )}
          {gameMode === 'bird' && gameTimeLeft === 0 && !zombieUnlocked && (
            <Pressable style={styles.reasonBtn} onPress={restartBirdGame}>
              <Text>Retry Bird Hunter</Text>
            </Pressable>
          )}
          {gameMode === 'bird' && zombieUnlocked && (
            <Pressable style={styles.reasonBtn} onPress={startZombieGame}>
              <Text>Play Zombie Shooter</Text>
            </Pressable>
          )}
          {gameMode === 'zombie' && (
            <Pressable style={styles.reasonBtn} onPress={() => { void playGameSound('ui'); setGameMode('bird'); }}>
              <Text>Back to Bird Hunter</Text>
            </Pressable>
          )}
          <View style={styles.gameArena}>
            {gameMode === 'bird' ? (
              <Pressable
                style={[styles.gameFloatingTarget, { left: `${birdTarget.x}%`, top: `${birdTarget.y}%` }]}
                onPress={hitBird}
              >
                <Text style={styles.gameTargetText}>🐦</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.gameFloatingTarget, styles.gameZombieTarget, { left: `${zombieTarget.x}%`, top: `${zombieTarget.y}%` }]}
                onPress={hitZombie}
              >
                <Text style={styles.gameTargetText}>🧟</Text>
              </Pressable>
            )}
          </View>
        </View>
      </Modal>

      {/* CHAT PAGE */}
      <Modal visible={chatOpen} animationType="slide" onRequestClose={() => setChatOpen(false)}>
        <View style={styles.chatWrap}>
          <View style={styles.chatHeader}>
            <Text style={styles.chatTitle}>Ride Chat</Text>
            <Pressable onPress={() => setChatOpen(false)}><Text style={styles.chatClose}>Close</Text></Pressable>
          </View>
          {mode === 'DRIVER' && activeRide?.type === 'ShareAuto' && !!activeRide.shareAutoPassengerIds?.length && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chatTargetsRow}>
              <Pressable
                style={[styles.chatTargetBtn, chatTargetPassengerId === 'ALL' && styles.chatTargetBtnActive]}
                onPress={() => setChatTargetPassengerId('ALL')}
              >
                <Text style={[styles.chatTargetText, chatTargetPassengerId === 'ALL' && styles.chatTargetTextActive]}>All</Text>
              </Pressable>
              {(activeRide.shareAutoPassengerIds || []).map((passengerId, index) => (
                <Pressable
                  key={passengerId}
                  style={[styles.chatTargetBtn, chatTargetPassengerId === passengerId && styles.chatTargetBtnActive]}
                  onPress={() => setChatTargetPassengerId(passengerId)}
                >
                  <Text style={[styles.chatTargetText, chatTargetPassengerId === passengerId && styles.chatTargetTextActive]}>
                    {activeRide.shareAutoPassengerNames?.[index] || `Passenger ${index + 1}`}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
          <FlatList
            data={chatMessages}
            keyExtractor={(_, i) => i.toString()}
            contentContainerStyle={{ padding: 12 }}
            renderItem={({ item }) => (
              <View style={[
                styles.chatBubble,
                item.senderRole === mode ? styles.chatMine : styles.chatTheirs
              ]}>
                <Text style={styles.chatName}>{item.senderName || (item.senderRole === 'DRIVER' ? 'Driver' : 'Passenger')}</Text>
                <Text style={styles.chatText}>{item.text}</Text>
                {!!item.targetPassengerName && (
                  <Text style={styles.chatTargetTag}>To: {item.targetPassengerName}</Text>
                )}
              </View>
            )}
          />
          <View style={styles.chatComposer}>
            <TextInput
              style={styles.chatInput}
              placeholder="Type a message"
              value={chatText}
              onChangeText={setChatText}
            />
            <Pressable style={styles.chatSend} onPress={sendChatMessage}>
              <Text style={{ color: 'white', fontWeight: '700' }}>Send</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* DRIVER HISTORY */}
      <Modal visible={showHistory} transparent animationType="slide" onRequestClose={() => setShowHistory(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Driver Ride History</Text>
            <FlatList
              data={driverHistory}
              keyExtractor={(item, i) => item.id || i.toString()}
              style={{ maxHeight: 420 }}
              ListEmptyComponent={<Text style={styles.emptyText}>No completed or cancelled rides yet.</Text>}
              renderItem={({ item }) => (
                <View style={styles.historyCard}>
                  <Text style={styles.historyRoute}>{item.pickupAddr || 'Pickup'} → {item.dropAddr || 'Drop'}</Text>
                  <Text style={styles.historyMeta}>Type: {item.rideType}</Text>
                  <Text style={styles.historyMeta}>Fare: ₹{item.fare}</Text>
                  <Text style={[styles.historyMeta, { color: item.status === 'completed' ? '#2E7D32' : '#C62828' }]}>
                    {item.status === 'completed' ? 'Completed' : `Cancelled${item.cancelledBy ? ` by ${item.cancelledBy}` : ''}`}
                  </Text>
                </View>
              )}
            />
            <Pressable onPress={() => setShowHistory(false)} style={{marginTop: 15, alignSelf:'center'}}><Text style={{color: '#007AFF', fontWeight:'bold'}}>CLOSE</Text></Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showDriverDestinationMap}
        animationType="slide"
        onRequestClose={() => {
          setShowDriverDestinationMap(false);
          setPendingDriverDestinationMarker(driverDestinationMarker);
        }}
      >
            {/* 28-DAY EARNINGS PAGE */}
            <Modal visible={showEarningsPage} transparent animationType="slide" onRequestClose={() => setShowEarningsPage(false)}>
              <View style={styles.modalOverlay}>
                <View style={styles.detailsModal}>
                  <Text style={styles.modalTitle}>28-Day Earnings Breakdown</Text>
                  <ScrollView style={{ maxHeight: 420 }}>
                    {Object.entries(driverEarningsLast28Days).length === 0 ? (
                      <Text style={styles.emptyText}>No earnings data for last 28 days.</Text>
                    ) : (
                      Object.entries(driverEarningsLast28Days)
                        .sort((a, b) => {
                          const [dayA, dateA] = a[0].split('/').map(Number);
                          const [dayB, dateB] = b[0].split('/').map(Number);
                          return dateA - dateB;
                        })
                        .map(([date, amount]) => (
                          <View key={date} style={styles.earningsCard}>
                            <View style={{ flex: 1 }}>
                              <Text style={styles.earningsDate}>{date}</Text>
                            </View>
                            <Text style={styles.earningsAmount}>₹{Math.round(amount)}</Text>
                          </View>
                        ))
                    )}
                  </ScrollView>
                  {Object.entries(driverEarningsLast28Days).length > 0 && (
                    <View style={styles.totalEarningsCard}>
                      <Text style={styles.totalEarningsLabel}>Total (28 Days)</Text>
                      <Text style={styles.totalEarningsAmount}>₹{Math.round(Object.values(driverEarningsLast28Days).reduce((sum, x) => sum + x, 0))}</Text>
                    </View>
                  )}
                  <Pressable onPress={() => setShowEarningsPage(false)} style={{marginTop: 10, alignSelf:'center'}}><Text style={{color: '#007AFF', fontWeight:'bold'}}>CLOSE</Text></Pressable>
                </View>
              </View>
            </Modal>
        <View style={styles.driverMapModalWrap}>
            {/* RATING MODAL - FOR PASSENGERS TO RATE DRIVER */}
            <Modal visible={showRatingModal} transparent animationType="fade" onRequestClose={() => { setShowRatingModal(false); setSelectedRating(0); }}>
              <View style={[styles.modalOverlay, { backgroundColor: 'rgba(0,0,0,0.6)' }]}>
                <View style={[styles.detailsModal, { maxHeight: 350 }]}>
                  <Text style={styles.modalTitle}>Rate Your Driver</Text>
                  <Text style={styles.ratingSubtitle}>How was your experience?</Text>
                  <View style={styles.starsContainer}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Pressable key={star} onPress={() => setSelectedRating(star)} style={styles.starButton}>
                        <Text style={[styles.star, { fontSize: selectedRating >= star ? 40 : 36, color: selectedRating >= star ? '#FFB800' : '#D1D5DB' }]}>★</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.ratingHint}>{selectedRating > 0 ? `You rated ${selectedRating}/5` : 'Tap to rate'}</Text>
                  <View style={styles.ratingButtonRow}>
                    <Pressable style={[styles.ratingButton, { backgroundColor: '#EF4444' }]} onPress={() => { setShowRatingModal(false); setSelectedRating(0); }}>
                      <Text style={styles.ratingButtonText}>Skip</Text>
                    </Pressable>
                    <Pressable style={[styles.ratingButton, { backgroundColor: '#16A34A' }]} onPress={() => { submitDriverRating(pendingRideForRating?.id || '', pendingRideForRating?.driverId || '', selectedRating || 4.8); }}>
                      <Text style={styles.ratingButtonText}>Submit</Text>
                    </Pressable>
                  </View>
                </View>
              </View>
            </Modal>
          <OSMMapView
            style={styles.driverMapModalMap}
            initialRegion={
              pendingDriverDestinationMarker
                ? { ...pendingDriverDestinationMarker, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                : location
                  ? { ...location, latitudeDelta: 0.05, longitudeDelta: 0.05 }
                  : DEFAULT_MAP_REGION
            }
            onPress={(e) => {
              const point = e.nativeEvent.coordinate;
              setPendingDriverDestinationMarker(point);
              void playMarkerSound(400);
            }}
            markers={pendingDriverDestinationMarker ? [{
              coordinate: pendingDriverDestinationMarker,
              title: 'Destination filter marker',
              color: '#16A34A',
              label: 'D',
            }] : []}
          />

          <View style={styles.driverMapModalControls}>
            <Text style={styles.driverMapModalTitle}>Tap map to set destination marker</Text>
            <Text style={styles.driverMapModalHint}>You will receive ride notifications only when destination is within {DRIVER_DESTINATION_MARKER_RADIUS_KM} km.</Text>
            <View style={styles.row}>
              <Pressable
                style={[styles.negButton, { marginRight: 8 }]}
                onPress={() => {
                  setShowDriverDestinationMap(false);
                  setPendingDriverDestinationMarker(driverDestinationMarker);
                }}
              >
                <Text style={{ color: '#475569', fontWeight: '700' }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.accButton, !pendingDriverDestinationMarker && styles.disabledConfirmBtn]}
                disabled={!pendingDriverDestinationMarker}
                onPress={async () => {
                  if (!pendingDriverDestinationMarker) return;
                  const today = getLocalDateKey();
                  const usedToday = driverDestinationToggleUsageDate === today ? driverDestinationToggleUsageCount : 0;
                  if (usedToday >= DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT) {
                    Alert.alert('Daily limit reached', `You can use this toggle only ${DRIVER_DESTINATION_TOGGLE_DAILY_LIMIT} times in a day.`);
                    setShowDriverDestinationMap(false);
                    return;
                  }

                  await persistDriverDestinationToggleUsage(today, usedToday + 1);
                  setDriverDestinationMarker(pendingDriverDestinationMarker);
                  setDriverDestinationFilterEnabled(true);
                  setShowDriverDestinationMap(false);
                }}
              >
                <Text style={styles.accText}>Confirm</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <RideAppScreen />
    </AppErrorBoundary>
  );
}

