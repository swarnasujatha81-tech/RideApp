import AsyncStorage from '@react-native-async-storage/async-storage';
import { decode, encode } from 'base-64';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  addDoc, collection,
  deleteDoc,
  doc, getDoc, getDocs, getFirestore, onSnapshot, query, setDoc, Timestamp, updateDoc, where
} from 'firebase/firestore';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Dimensions,
  FlatList,
  Linking, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import {
  FARE_ADJUSTMENTS,
  PricingDemandLevel,
  PricingRideType,
  SHARE_AUTO_FARE_SETTINGS,
  SURGE_SETTINGS,
  VEHICLE_DISTANCE_SLABS,
  VEHICLE_FARE_SETTINGS,
} from '../fare-settings';

/* ================= FIREBASE CONFIG ================= */
const firebaseConfig = {
  apiKey: "AIzaSyDPcG1HOj5c4_HSgapAjzAu5tXPMHXekTg",
  authDomain: "share-it-9a030.firebaseapp.com",
  projectId: "share-it-9a030",
  storageBucket: "share-it-9a030.firebasestorage.app",
  messagingSenderId: "100914160826",
  appId: "1:100914160826:web:e1ab817586378e67e9ce83",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const CURRENT_LOC_FAB_RISE = Math.round(Dimensions.get('window').height * 0.1);

type RideType = 'Bike' | 'Auto' | 'Cab' | 'ShareAuto';
type Coord = { latitude: number; longitude: number };

interface Ride {
  id?: string; type: RideType;
  fare: number; baseFare: number; tip: number; 
  distance: number; pickup: Coord; drop: Coord; encryptedOTP: string;
  pickupAddr?: string; dropAddr?: string;
  passengerId?: string;
  passengerName?: string;
  passengerPhone?: string;
  status: 'waiting' | 'accepted' | 'started';
  driverId?: string | null;
  driverPhone?: string;
  driverName?: string;
  vehiclePlate?: string;
  driverLocation?: Coord;
  createdAt?: any;
  shareAutoPassengerIds?: string[];
  shareAutoPassengerNames?: string[];
  shareAutoPassengerPhones?: string[];
  shareAutoPassengerPickups?: Coord[];
  shareAutoPassengerDrops?: Coord[];
  shareAutoPassengerPickupAddrs?: string[];
  shareAutoPassengerDropAddrs?: string[];
  shareAutoPassengerDistances?: number[];
  shareAutoPassengerFares?: number[];
  shareAutoPassengerEncryptedOTPs?: string[];
  shareAutoPickupCompletedIds?: string[];
  shareAutoDropCompletedIds?: string[];
  shareAutoSeats?: number;
  shareAutoMatchWay?: 'A' | 'B';
  shareAutoRouteNote?: string;
}

interface ShareAutoPool {
  id?: string;
  passengerId: string;
  passengerName: string;
  passengerPhone: string;
  pickup: Coord;
  drop: Coord;
  pickupAddr?: string;
  dropAddr?: string;
  createdAt?: any;
  status: 'searching' | 'matched' | 'expired';
}

interface RideHistory {
  id?: string;
  rideId: string;
  rideType: RideType;
  pickupAddr?: string;
  dropAddr?: string;
  fare: number;
  status: 'completed' | 'cancelled';
  cancelledBy?: 'DRIVER' | 'PASSENGER';
  driverId?: string;
  driverName?: string;
  passengerId?: string;
  passengerName?: string;
  createdAt?: any;
}

interface ChatMessage {
  text: string;
  senderId: string;
  senderRole: 'USER' | 'DRIVER';
  senderName?: string;
  targetPassengerId?: string;
  targetPassengerName?: string;
  createdAt: number;
}

interface PoolPassenger {
  id: string;
  name: string;
  phone: string;
  pickup: Coord;
  drop: Coord;
  pickupAddr?: string;
  dropAddr?: string;
}

interface ShareAutoMatchResult {
  way: 'A' | 'B';
  passengers: PoolPassenger[];
  score: number;
}

const icons = { Bike: '🏍️', Auto: '🛺', Cab: '🚕', ShareAuto: '👥' };
const SECRET_KEY = 'SHARE_IT_SECURE_2026';
const FIVE_MIN_MS = 5 * 60 * 1000;
const HYDERABAD_CENTER: Coord = { latitude: 17.385, longitude: 78.4867 };
const HYDERABAD_SERVICE_RADIUS_KM = 40;
const DRIVER_ALERT_SOUND_URL = 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg';
const CHAT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const VEHICLE_SELECT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const PRIMARY_ACTION_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const GAME_BIRD_HIT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/pop.ogg';
const GAME_ZOMBIE_HIT_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/wood_plank_flicks.ogg';
const GAME_UNLOCK_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg';
const MARKER_PLACE_SOUND_URL = 'https://actions.google.com/sounds/v1/cartoon/bell_ding.ogg';
const encryptOTP = (otp: string) => encode(otp.split('').reverse().join('') + SECRET_KEY);
const decryptOTP = (val: string) => decode(val).replace(SECRET_KEY, '').split('').reverse().join('');
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

export default function App() {
  const [loggedIn, setLoggedIn] = useState(false);
  const mapRef = useRef<MapView | null>(null);
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [mode, setMode] = useState<'USER' | 'DRIVER'>('USER');
  const [driverName, setDriverName] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [isIdentitySet, setIsIdentitySet] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');

  // INDIVIDUAL DRIVER STATS [cite: 165]
  const [driverStats, setDriverStats] = useState({ 
    completed: 0, 
    earnings: 0, 
    cancelled: 0, 
    rating: 0,
    cancelHistory: [] as number[], 
    reportHistory: [] as number[], 
    isPermanentlySuspended: false
  });

  const [crewUnlockCode, setCrewUnlockCode] = useState('');
  const [location, setLocation] = useState<Coord | null>(null);
  const [pickupInput, setPickupInput] = useState('Current Location');
  const [pickupCoords, setPickupCoords] = useState<Coord | null>(null);
  const [destination, setDestination] = useState('');
  const [destCoords, setDestCoords] = useState<Coord | null>(null);
  const [selectedRide, setSelectedRide] = useState<RideType | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [ignoredRides, setIgnoredRides] = useState<string[]>([]);
  const [userBookedRide, setUserBookedRide] = useState<Ride | null>(null);
  const [currentRide, setCurrentRide] = useState<Ride | null>(null);
  const [driverVehicle, setDriverVehicle] = useState<RideType | null>(null);
  const [fares, setFares] = useState({ Bike: 0, Auto: 0, Cab: 0, ShareAuto: 0 });
  const [otpInput, setOtpInput] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const [showTipModal, setShowTipModal] = useState(false);

  const [searchTimer, setSearchTimer] = useState(0);
  const [searchRadius, setSearchRadius] = useState(1.0);
  const searchAnim = useRef(new Animated.Value(1)).current;

  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [hasUnreadChat, setHasUnreadChat] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [driverHistory, setDriverHistory] = useState<RideHistory[]>([]);
  const alertPlayingRef = useRef(false);
  const alertedRideIdsRef = useRef<Set<string>>(new Set());
  const chatLastMessageAtRef = useRef(0);
  const chatListenerHydratedRef = useRef(false);
  const [shareAutoSearchActive, setShareAutoSearchActive] = useState(false);
  const [shareAutoSearchStartedAt, setShareAutoSearchStartedAt] = useState(0);
  const [shareAutoPoolId, setShareAutoPoolId] = useState('');
  const [showShareAutoFallback, setShowShareAutoFallback] = useState(false);
  const [shareAutoFallbackReason, setShareAutoFallbackReason] = useState('');
  const shareAutoTimersRef = useRef<{ search?: ReturnType<typeof setTimeout>; fallback?: ReturnType<typeof setTimeout> }>({});
  const shareAutoPulse = useRef(new Animated.Value(0)).current;
  const [shareAutoElapsed, setShareAutoElapsed] = useState(0);
  const [showShareAutoTerms, setShowShareAutoTerms] = useState(false);
  const [showShareAutoIntro, setShowShareAutoIntro] = useState(false);
  const [chatTargetPassengerId, setChatTargetPassengerId] = useState<string>('ALL');
  const arrivalAutoPulse = useRef(new Animated.Value(0)).current;
  const [shareAutoFoundMembers, setShareAutoFoundMembers] = useState(0);
  const autoCancelInProgressRef = useRef(false);
  const [showShareAutoGame, setShowShareAutoGame] = useState(false);
  const [shareAutoGamePausedByRide, setShareAutoGamePausedByRide] = useState(false);
  const [gameMode, setGameMode] = useState<'bird' | 'zombie'>('bird');
  const [gameTimeLeft, setGameTimeLeft] = useState(45);
  const [birdHits, setBirdHits] = useState(0);
  const [zombieHits, setZombieHits] = useState(0);
  const [zombieUnlocked, setZombieUnlocked] = useState(false);
  const [birdTarget, setBirdTarget] = useState({ x: 48, y: 48 });
  const [zombieTarget, setZombieTarget] = useState({ x: 30, y: 40 });
  const [selectedSharePassengerId, setSelectedSharePassengerId] = useState('');

  const currentUserId = auth.currentUser?.uid || '';
  const activeRide = mode === 'USER' ? userBookedRide : currentRide;

  const isValidMobile = (val: string) => /^[6-9]\d{9}$/.test(val);

  const getRideCreatedAtMs = (createdAt: any): number => {
    if (!createdAt) return 0;
    if (typeof createdAt?.toMillis === 'function') return createdAt.toMillis();
    if (typeof createdAt?.toDate === 'function') return createdAt.toDate().getTime();
    if (createdAt instanceof Date) return createdAt.getTime();
    if (typeof createdAt === 'number') return createdAt;
    return 0;
  };

  const isFreshWaitingRide = (ride: Ride) => {
    const createdAtMs = getRideCreatedAtMs(ride.createdAt);
    if (!createdAtMs) return false;
    return ride.status === 'waiting' && (Date.now() - createdAtMs) <= FIVE_MIN_MS;
  };

  const getDistanceFromDriver = (ride: Ride) => {
    if (!location) return Number.POSITIVE_INFINITY;
    return calcDist(location, ride.pickup);
  };

  const isShareAutoCandidate = (ride: Ride, pickup: Coord, drop: Coord) => {
    if (ride.type !== 'ShareAuto') return false;
    if (!ride.drop) return false;
    return calcDist(ride.drop, drop) <= 3;
  };

  const getClusterRadiusKm = (points: Coord[]) => {
    if (!points.length) return Number.POSITIVE_INFINITY;
    const center = {
      latitude: points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
      longitude: points.reduce((sum, p) => sum + p.longitude, 0) / points.length,
    };
    return Math.max(...points.map((p) => calcDist(center, p)));
  };

  const toLocalPointKm = (origin: Coord, point: Coord) => {
    const kLat = 111;
    const kLon = 111 * Math.cos((origin.latitude * Math.PI) / 180);
    return {
      x: (point.longitude - origin.longitude) * kLon,
      y: (point.latitude - origin.latitude) * kLat,
    };
  };

  const pointToSegmentDistanceKm = (point: Coord, start: Coord, end: Coord) => {
    const origin = start;
    const p = toLocalPointKm(origin, point);
    const a = toLocalPointKm(origin, start);
    const b = toLocalPointKm(origin, end);
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return Math.hypot(apx, apy);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
    const projX = a.x + t * abx;
    const projY = a.y + t * aby;
    return Math.hypot(p.x - projX, p.y - projY);
  };

  const toPoolPassenger = (pool: ShareAutoPool): PoolPassenger => ({
    id: pool.passengerId,
    name: pool.passengerName,
    phone: pool.passengerPhone,
    pickup: pool.pickup,
    drop: pool.drop,
    pickupAddr: pool.pickupAddr,
    dropAddr: pool.dropAddr,
  });

  const calcSegmentEtaMinutes = (km: number) => Math.max(2, Math.round((km / 22) * 60));

  const isAWayGroup = (allPassengers: PoolPassenger[]) => {
    const pickupRadius = getClusterRadiusKm(allPassengers.map((p) => p.pickup));
    const dropRadius = getClusterRadiusKm(allPassengers.map((p) => p.drop));
    return pickupRadius <= 2 && dropRadius <= 4;
  };

  const getLongestTripPassenger = (allPassengers: PoolPassenger[]) => {
    return allPassengers.reduce((best, current) => {
      const bestDist = calcDist(best.pickup, best.drop);
      const currDist = calcDist(current.pickup, current.drop);
      return currDist > bestDist ? current : best;
    }, allPassengers[0]);
  };

  const isBWayGroup = (allPassengers: PoolPassenger[]) => {
    if (allPassengers.length < 2) return false;
    const longest = getLongestTripPassenger(allPassengers);
    const others = allPassengers.filter((p) => p.id !== longest.id);

    const allWithinDeviation = others.every((p) => {
      const pickupDeviation = pointToSegmentDistanceKm(p.pickup, longest.pickup, longest.drop);
      const dropDeviation = pointToSegmentDistanceKm(p.drop, longest.pickup, longest.drop);
      return pickupDeviation <= 2 && dropDeviation <= 3;
    });

    if (!allWithinDeviation) return false;

    const etaCandidates = others.map((p) => calcSegmentEtaMinutes(calcDist(longest.pickup, p.pickup)));
    const maxEta = Math.max(...etaCandidates);
    return maxEta <= 30;
  };

  const getBWayScore = (allPassengers: PoolPassenger[]) => {
    const longest = getLongestTripPassenger(allPassengers);
    const others = allPassengers.filter((p) => p.id !== longest.id);
    return others.reduce((sum, p) => {
      const pickupDeviation = pointToSegmentDistanceKm(p.pickup, longest.pickup, longest.drop);
      const dropDeviation = pointToSegmentDistanceKm(p.drop, longest.pickup, longest.drop);
      const etaPenalty = calcSegmentEtaMinutes(calcDist(longest.pickup, p.pickup)) > 15 ? 3 : 0;
      return sum + pickupDeviation + dropDeviation + etaPenalty;
    }, 0);
  };

  const findShareAutoMatch = (selfPassenger: PoolPassenger, candidates: PoolPassenger[]): ShareAutoMatchResult | null => {
    const aMatches: ShareAutoMatchResult[] = [];
    const bMatches: ShareAutoMatchResult[] = [];

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const group = [selfPassenger, candidates[i], candidates[j]];
        if (isAWayGroup(group)) {
          const score = getClusterRadiusKm(group.map((p) => p.pickup)) + getClusterRadiusKm(group.map((p) => p.drop));
          aMatches.push({ way: 'A', passengers: [candidates[i], candidates[j]], score });
        }
        if (isBWayGroup(group)) {
          bMatches.push({ way: 'B', passengers: [candidates[i], candidates[j]], score: getBWayScore(group) });
        }
      }
    }

    if (aMatches.length > 0) {
      return aMatches.sort((x, y) => x.score - y.score)[0];
    }
    if (bMatches.length > 0) {
      return bMatches.sort((x, y) => x.score - y.score)[0];
    }

    return null;
  };

  const findPartialShareAuto = (selfPassenger: PoolPassenger, candidates: PoolPassenger[]) => {
    const aCandidates = candidates
      .filter((passenger) => isAWayGroup([selfPassenger, passenger]))
      .sort((x, y) => calcDist(selfPassenger.pickup, x.pickup) - calcDist(selfPassenger.pickup, y.pickup));

    if (aCandidates.length > 0) return { way: 'A' as const, passenger: aCandidates[0] };

    const bCandidates = candidates
      .filter((passenger) => isBWayGroup([selfPassenger, passenger]))
      .sort((x, y) => {
        const xEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, x.pickup));
        const yEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, y.pickup));
        return xEta - yEta;
      });

    if (bCandidates.length > 0) return { way: 'B' as const, passenger: bCandidates[0] };
    return null;
  };

  const isPeakHour = () => {
    const hour = new Date().getHours();
    return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 21);
  };

  type RidePricingType = PricingRideType;
  type DemandLevel = PricingDemandLevel;

  interface RideFareBreakdown {
    distanceFare: number;
    timeFare: number;
    pickupFare: number;
    surge: number;
    fees: number;
    nightCharge: number;
    randomAdjustment: number;
    minimumFare: number;
    surgeMultiplier: number;
    finalDiscountRate?: number;
    extraReductionRate?: number;
  }

  interface RideFareQuote {
    finalFare: number;
    breakdown: RideFareBreakdown;
  }

  const getDemandLevel = (): DemandLevel => {
    const demandFactor = getDemandFactor();
    if (demandFactor < 0.2) return 'low';
    if (demandFactor < 0.45) return 'normal';
    if (demandFactor < 0.75) return 'high';
    return 'peak';
  };

  const getSurgeMultiplier = (demandLevel: DemandLevel, timeOfDay: number) => {
    const rushHour = (timeOfDay >= 8 && timeOfDay < 11) || (timeOfDay >= 17 && timeOfDay < 21);
    const setting = SURGE_SETTINGS[demandLevel];
    return rushHour ? setting.rush : setting.normal;
  };

  const isNightChargeApplicable = (timeOfDay: number) => timeOfDay >= 23 || timeOfDay < 5;

  const getRandomAdjustment = () => {
    const min = FARE_ADJUSTMENTS.randomAdjustmentMin;
    const max = FARE_ADJUSTMENTS.randomAdjustmentMax;
    return Math.floor(Math.random() * (max - min + 1)) + min;
  };

  const smartRoundFare = (value: number) => {
    const rounded = Math.round(value);
    if (rounded % 10 === 0) return rounded + 2;
    if (rounded % 5 === 0) return rounded + 1;
    if (rounded % 2 === 0) return rounded + 1;
    return rounded;
  };

  const getRideFinalDiscountRate = (demandLevel: DemandLevel) => {
    return FARE_ADJUSTMENTS.finalDiscountByDemand[demandLevel];
  };

  const calculateSlabDistanceFare = (rideType: RidePricingType, distanceKm: number) => {
    const distance = Math.max(0, distanceKm);

    const slabSetting = VEHICLE_DISTANCE_SLABS[rideType];
    if (distance <= slabSetting.flatTillKm) return slabSetting.flatFare;

    let fare = slabSetting.flatFare;
    slabSetting.segments.forEach((segment) => {
      if (distance > segment.startKm) {
        const segmentEnd = segment.endKm ?? distance;
        const travelledInSegment = Math.max(0, Math.min(distance, segmentEnd) - segment.startKm);
        fare += travelledInSegment * segment.ratePerKm;
      }
    });

    return fare;
  };

  const calculateRideFare = (
    rideType: RidePricingType,
    distanceKm: number,
    durationMinutes: number,
    pickupDistanceKm: number,
    demandLevel: DemandLevel,
    timeOfDay: number
  ): RideFareQuote => {
    const config = VEHICLE_FARE_SETTINGS[rideType];
    const safeDistance = Math.max(0, distanceKm);
    const safeDuration = Math.max(0, durationMinutes);
    const safePickupDistance = Math.max(0, pickupDistanceKm);

    const distanceFare = calculateSlabDistanceFare(rideType, safeDistance);
    const timeFare = safeDuration * config.timeRate;
    const pickupFare = safePickupDistance > 1.5
      ? (safePickupDistance - 1.5) * config.pickupRate
      : 0;

    const subtotal = distanceFare + pickupFare + timeFare;
    const surgeMultiplier = getSurgeMultiplier(demandLevel, timeOfDay);
    const surgedSubtotal = subtotal * surgeMultiplier;
    const surge = surgedSubtotal - subtotal;

    const fees = config.platformFee;
    const nightCharge = isNightChargeApplicable(timeOfDay)
      ? (surgedSubtotal + fees) * FARE_ADJUSTMENTS.nightChargeRate
      : 0;
    const randomAdjustment = getRandomAdjustment();
    const preRoundTotal = surgedSubtotal + fees + nightCharge + randomAdjustment;
    const smartRounded = smartRoundFare(preRoundTotal);
    const finalDiscountRate = getRideFinalDiscountRate(demandLevel);
    const discountedFare = Math.round(smartRounded * (1 - finalDiscountRate));
    const extraReductionRate = FARE_ADJUSTMENTS.extraReductionRate;
    const extraDiscountedFare = Math.round(discountedFare * (1 - extraReductionRate));
    const finalFare = Math.max(config.minimumFare, extraDiscountedFare);

    return {
      finalFare: Math.round(finalFare),
      breakdown: {
        distanceFare: Math.round(distanceFare),
        timeFare: Math.round(timeFare),
        pickupFare: Math.round(pickupFare),
        surge: Math.round(surge),
        fees: Math.round(fees),
        nightCharge: Math.round(nightCharge),
        randomAdjustment,
        minimumFare: config.minimumFare,
        surgeMultiplier,
        finalDiscountRate,
        extraReductionRate,
      },
    };
  };

  const getDemandFactor = () => {
    const activeDemand = rides.filter((r) => r.status === 'waiting').length;
    return Math.min(1, activeDemand / 12);
  };

  const getAppUserFactor = () => {
    // Proxy for active app users based on live ride documents.
    const activeUsers = rides.length;
    return Math.min(1, activeUsers / 30);
  };

  const roundToNearestFive = (value: number) => Math.round(value / 5) * 5;
  const roundToNearestFour = (value: number) => Math.round(value / 4) * 4;
  const applyBikeExtraDiscount = (value: number) => Math.max(0, Math.round(value * 0.96));
  const getFinalDiscountRate = () => {
    const demandFactor = getDemandFactor();
    const appUserFactor = getAppUserFactor();
    const activityFactor = (demandFactor + appUserFactor) / 2;
    // Inverse relation: higher activity/users => lower discount (closer to 12.5%).
    return 0.16 - (0.035 * activityFactor); // 16% down to 12.5%
  };
  const applyFinalDiscount = (value: number) => {
    const discountRate = getFinalDiscountRate();
    return Math.max(0, Math.round(value * (1 - discountRate)));
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

  const getDynamicBikeFare = (distanceKm: number) => {
    const demandLevel = getDemandLevel();
    const estimatedTimeMinutes = Math.max(1, (distanceKm / FARE_ADJUSTMENTS.estimatedSpeedKmh.bike) * 60);
    return calculateRideFare('bike', distanceKm, estimatedTimeMinutes, 0, demandLevel, new Date().getHours()).finalFare;
  };

  const getDynamicAutoFare = (distanceKm: number) => {
    const demandLevel = getDemandLevel();
    const estimatedTimeMinutes = Math.max(1, (distanceKm / FARE_ADJUSTMENTS.estimatedSpeedKmh.auto) * 60);
    return calculateRideFare('auto', distanceKm, estimatedTimeMinutes, 0, demandLevel, new Date().getHours()).finalFare;
  };

  const isCabPeakHour = () => {
    const hour = new Date().getHours();
    return (hour >= 8 && hour < 11) || (hour >= 17 && hour < 22);
  };

  const isRainyTime = () => {
    const month = new Date().getMonth() + 1;
    return month >= 6 && month <= 9;
  };

  const getDynamicCabFare = (distanceKm: number) => {
    const demandLevel = getDemandLevel();
    const estimatedTimeMinutes = Math.max(1, (distanceKm / FARE_ADJUSTMENTS.estimatedSpeedKmh.car) * 60);
    return calculateRideFare('car', distanceKm, estimatedTimeMinutes, 0, demandLevel, new Date().getHours()).finalFare;
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

  const startShareAutoFallback = (reason: string) => {
    setShareAutoFallbackReason(reason);
    setShowShareAutoFallback(true);
    resetShareAutoSearch();
  };

  const handleGameTap = (cellIndex: number) => {
    // Deprecated: old mini-game tap handler retained for compatibility.
    void cellIndex;
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
      const partial = !matched ? findPartialShareAuto(selfPassenger, candidates) : null;
      if (matched) {
        setShareAutoFoundMembers(2);
      } else if (partial) {
        setShareAutoFoundMembers(1);
      } else {
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

  const visibleDriverRides = rides
    .filter((ride) => ride.type === driverVehicle && !ignoredRides.includes(ride.id!) && isFreshWaitingRide(ride))
    .filter((ride) => ride.type !== 'ShareAuto' || !location || getDistanceFromDriver(ride) <= 3)
    .sort((a, b) => {
      const stageDiff = getDriverNotificationStage(a) - getDriverNotificationStage(b);
      if (stageDiff !== 0) return stageDiff;
      if (a.type === 'ShareAuto' && b.type === 'ShareAuto') return getDistanceFromDriver(a) - getDistanceFromDriver(b);
      return (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0);
    });

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
    const twoHrsAgo = now - (2 * 60 * 60 * 1000);
    const threeHrsAgo = now - (3 * 60 * 60 * 1000);
    const sixHrsAgo = now - (6 * 60 * 60 * 1000);
    const fifteenHrsAgo = now - (15 * 60 * 60 * 1000);
    const thirtyHrsAgo = now - (30 * 60 * 60 * 1000);

    const cancelsLast15 = driverStats.cancelHistory.filter(t => t > fifteenHrsAgo).length;
    const cancelsLast30 = driverStats.cancelHistory.filter(t => t > thirtyHrsAgo).length;
    const reportsLast2 = driverStats.reportHistory.filter(t => t > twoHrsAgo).length;
    const reportsLast3 = driverStats.reportHistory.filter(t => t > threeHrsAgo).length;
    const reportsLast6 = driverStats.reportHistory.filter(t => t > sixHrsAgo).length;

    if (driverStats.isPermanentlySuspended) return "PERMANENT";
    if (reportsLast6 >= 8) return "SUSPENDED_36_HOURS";
    if (reportsLast3 >= 7) return "SUSPENDED_2_HOURS";
    if (reportsLast2 >= 2) return "BEHAVIOR_WARNING";
    if (cancelsLast30 >= 20) return "SUSPENDED_2_DAYS";
    if (cancelsLast15 >= 13) return "BLOCKED_5_HOURS";
    if (cancelsLast15 >= 10) return "WARNING";
    
    return "CLEAR";
  };

  const penalty = getPenaltyStatus();

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

  useEffect(() => {
    const cleanup = setInterval(async () => {
      const fiveMinsAgo = new Date(Date.now() - FIVE_MIN_MS);
      const q = query(collection(db, 'rides'), where('status', '==', 'waiting'));
      const snapshot = await getDocs(q);
      snapshot.forEach((d) => {
        if (d.data().createdAt?.toDate() < fiveMinsAgo) deleteDoc(doc(db, 'rides', d.id));
      });
    }, 30000);
    return () => clearInterval(cleanup);
  }, []);

  useEffect(() => {
    const init = async () => {
      onAuthStateChanged(auth, async (user) => {
        setLoggedIn(!!user);
        if (!user) {
          setProfileName('');
          setProfilePhone('');
          return;
        }
        const userSnap = await getDoc(doc(db, 'users', user.uid));
        if (userSnap.exists()) {
          const userData = userSnap.data() as { name?: string; phone?: string };
          setProfileName(userData.name || '');
          setProfilePhone(userData.phone || '');
        }
      });
      const savedVehicle = await AsyncStorage.getItem('driver_vehicle');
      if (savedVehicle) setDriverVehicle(savedVehicle as RideType);

      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const initial = await Location.getCurrentPositionAsync({});
        const pos = { latitude: initial.coords.latitude, longitude: initial.coords.longitude };
        setLocation(pos);
        setPickupCoords(pos);
        Location.watchPositionAsync({ distanceInterval: 10 }, (loc) => {
          setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        });
      }
    };
    init();
  }, []);

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

    const unsub = onSnapshot(collection(db, 'rides', activeRide.id, 'messages'), (snapshot) => {
      const fullList = snapshot.docs
        .map(d => d.data() as ChatMessage)
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
    });

    return unsub;
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
    updateDoc(doc(db, 'rides', currentRide.id), { driverLocation: location });
  }, [mode, currentRide?.id, location]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !currentUserId) return;
    const q = query(collection(db, 'rideHistory'), where('driverId', '==', currentUserId));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RideHistory));
      list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      setDriverHistory(list);
    });
    return unsub;
  }, [mode, currentUserId]);

  useEffect(() => {
    if (mode !== 'DRIVER' || !driverVehicle || !isIdentitySet || !!currentRide) return;

    const freshRideIds = rides
      .filter(r => r.type === driverVehicle && !ignoredRides.includes(r.id || '') && isFreshWaitingRide(r))
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
  }, [mode, driverVehicle, isIdentitySet, currentRide, rides, ignoredRides]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'rides'), (snapshot) => {
      const list = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Ride));
      setRides(list);
      if (userBookedRide?.id) {
        setUserBookedRide(list.find(r => r.id === userBookedRide.id) || null);
      } else if (currentUserId) {
        setUserBookedRide(
          list.find(r =>
            r.passengerId === currentUserId ||
            r.shareAutoPassengerIds?.includes(currentUserId)
          ) || null
        );
      }
      if (currentRide?.id) setCurrentRide(list.find(r => r.id === currentRide.id) || null);
    });
    return unsub;
  }, [userBookedRide?.id, currentRide?.id, currentUserId]);

  useEffect(() => {
    if (!shareAutoSearchActive || !shareAutoPoolId) return;

    const finalizeShareAuto = async (isFinalAttempt: boolean) => {
      if (!pickupCoords || !destCoords || !profileName || !profilePhone) return;

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
      const partial = !matched ? findPartialShareAuto(selfPassenger, candidates) : null;

      if (matched || (isFinalAttempt && partial)) {
        setShowShareAutoGame(false);
        setShareAutoGamePausedByRide(true);

        const selectedPassengers = matched
          ? [selfPassenger, ...matched.passengers]
          : [selfPassenger, partial!.passenger];

        const passengerDistances = selectedPassengers.map((p) => calcDist(p.pickup, p.drop));
        const passengerCount = selectedPassengers.length;
        const baseDistance = passengerDistances.reduce((sum, x) => sum + x, 0) / passengerCount;
        const baseFare = getShareAutoFare(baseDistance, passengerCount);

        const passengerFares = passengerDistances.map((distance) => {
          const ratio = Math.max(0.85, Math.min(1.2, distance / Math.max(baseDistance, 0.5)));
          return Math.round(baseFare * ratio);
        });
        const passengerEncryptedOtps = selectedPassengers.map(() => encryptOTP(generateOTP()));

        const rideData: Ride = {
          type: 'ShareAuto',
          fare: passengerFares[0],
          baseFare: passengerFares[0],
          tip: 0,
          distance: passengerDistances[0],
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
          shareAutoMatchWay: matched?.way || partial?.way || 'A',
          shareAutoRouteNote: matched
            ? `${matched.way}-Way group formed. A-Way is always prioritized when available.`
            : `${partial?.way}-Way partial group formed with 2 passengers.`,
          status: 'waiting',
          createdAt: Timestamp.now()
        };

        const ref = await addDoc(collection(db, 'rides'), rideData);
        const selectedPassengerIds = new Set(selectedPassengers.map((p) => p.id));
        const docsToDelete = allPools.filter((pool) => selectedPassengerIds.has(pool.passengerId));
        await Promise.all(docsToDelete.map((docSnap) => deleteDoc(doc(db, 'shareAutoPools', docSnap.id!)).catch(() => undefined)));
        setUserBookedRide({ ...rideData, id: ref.id });
        resetShareAutoSearch();
        return;
      }

      if (isFinalAttempt) {
        await deleteDoc(doc(db, 'shareAutoPools', shareAutoPoolId)).catch(() => undefined);
        startShareAutoFallback('No matching ShareAuto passengers were found within 3 minutes. Bike, Auto, or Cab is recommended for a faster trip.');
      }
    };

    shareAutoTimersRef.current.search = setTimeout(() => {
      finalizeShareAuto(false);
    }, 2 * 60 * 1000);

    shareAutoTimersRef.current.fallback = setTimeout(() => {
      finalizeShareAuto(true);
    }, 3 * 60 * 1000);

    return () => clearShareAutoTimers();
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
    if (pickupCoords && destCoords) {
        const dist = calcDist(pickupCoords, destCoords);
        const demandLevel = getDemandLevel();
        const currentHour = new Date().getHours();
        const bikePricing = calculateRideFare('bike', dist, Math.max(1, (dist / FARE_ADJUSTMENTS.estimatedSpeedKmh.bike) * 60), 0, demandLevel, currentHour);
        const autoPricing = calculateRideFare('auto', dist, Math.max(1, (dist / FARE_ADJUSTMENTS.estimatedSpeedKmh.auto) * 60), 0, demandLevel, currentHour);
        const carPricing = calculateRideFare('car', dist, Math.max(1, (dist / FARE_ADJUSTMENTS.estimatedSpeedKmh.car) * 60), 0, demandLevel, currentHour);
        setFares({
          Bike: bikePricing.finalFare,
          Auto: autoPricing.finalFare,
          Cab: carPricing.finalFare,
          ShareAuto: getShareAutoFare(dist, 3),
        });
    }
  }, [destCoords, pickupCoords, rides]);

  const calcDist = (a: Coord, b: Coord) => {
    const R = 6371;
    const dLat = (b.latitude - a.latitude) * Math.PI / 180;
    const dLon = (b.longitude - a.longitude) * Math.PI / 180;
    const val = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(val), Math.sqrt(1 - val));
  };

  const isWithinHyderabadService = (coord: Coord) => {
    return calcDist(HYDERABAD_CENTER, coord) <= HYDERABAD_SERVICE_RADIUS_KM;
  };

  const handleTip = async (amt: number) => {
    if (!userBookedRide?.id) return;
    const newFare = userBookedRide.baseFare + amt;
    await updateDoc(doc(db, 'rides', userBookedRide.id), { fare: newFare, tip: amt });
    setSearchRadius(6.0); 
    setShowTipModal(false);
  };

  const handleSearch = async (type: 'pickup' | 'drop') => {
    const queryStr = type === 'pickup' ? pickupInput : destination;
    if (!queryStr || queryStr === 'Current Location') return;
    const res = await Location.geocodeAsync(queryStr);
    if (res.length > 0) {
      const coord = { latitude: res[0].latitude, longitude: res[0].longitude };
      if (!isWithinHyderabadService(coord)) {
        Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
        return;
      }
      void playMarkerSound(400);
      type === 'pickup' ? setPickupCoords(coord) : setDestCoords(coord);
    }
  };

  const bookRide = async (rideType?: RideType) => {
    const rideChoice = rideType ?? selectedRide;
    if (!rideChoice || !pickupCoords || !destCoords) return;
    if (!isWithinHyderabadService(pickupCoords) || !isWithinHyderabadService(destCoords)) {
      Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
      return;
    }
    const tripDistanceKm = calcDist(pickupCoords, destCoords);
    if (!profileName || !profilePhone) {
      Alert.alert('Profile missing', 'Please login with a valid passenger profile.');
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

    const bFare = fares[rideChoice];
    const rideData: Ride = {
      type: rideChoice, fare: bFare, baseFare: bFare, tip: 0,
      distance: tripDistanceKm, pickup: pickupCoords, drop: destCoords,
      pickupAddr: pickupInput, dropAddr: destination, encryptedOTP: encryptOTP(generateOTP()),
      passengerId: currentUserId,
      passengerName: profileName,
      passengerPhone: profilePhone,
      status: 'waiting', createdAt: Timestamp.now()
    };
    const ref = await addDoc(collection(db, 'rides'), rideData);
    setUserBookedRide({ ...rideData, id: ref.id });
  };

  const requestRide = async () => {
    if (selectedRide === 'ShareAuto') {
      const introSeen = await AsyncStorage.getItem('shareauto_intro_seen');
      if (introSeen === '1') {
        setShowShareAutoTerms(true);
      } else {
        setShowShareAutoIntro(true);
      }
      return;
    }
    await bookRide();
  };

  const sendChatMessage = async () => {
    if (!activeRide?.id || !chatText.trim()) return;

    const targetPassengerName =
      mode === 'DRIVER' &&
      activeRide.type === 'ShareAuto' &&
      chatTargetPassengerId !== 'ALL'
        ? activeRide.shareAutoPassengerNames?.[activeRide.shareAutoPassengerIds?.findIndex((id) => id === chatTargetPassengerId) || 0]
        : undefined;

    await addDoc(collection(db, 'rides', activeRide.id, 'messages'), {
      text: chatText.trim(),
      senderId: currentUserId,
      senderRole: mode,
      senderName: mode === 'DRIVER' ? driverName : profileName,
      targetPassengerId: mode === 'DRIVER' && activeRide.type === 'ShareAuto' && chatTargetPassengerId !== 'ALL' ? chatTargetPassengerId : undefined,
      targetPassengerName,
      createdAt: Date.now()
    });

    playChatSound();
    setChatText('');
  };

  const sendDriverReachingMessage = async (passengerId: string, passengerName: string) => {
    if (!activeRide?.id || mode !== 'DRIVER') return;
    await addDoc(collection(db, 'rides', activeRide.id, 'messages'), {
      text: `Reaching ${passengerName}. Please be ready at pickup point.`,
      senderId: currentUserId,
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
    cancelledBy?: 'DRIVER' | 'PASSENGER'
  ) => {
    await addDoc(collection(db, 'rideHistory'), {
      rideId: ride.id,
      rideType: ride.type,
      pickupAddr: ride.pickupAddr,
      dropAddr: ride.dropAddr,
      fare: ride.fare,
      status,
      cancelledBy,
      driverId: ride.driverId,
      driverName: ride.driverName,
      passengerId: ride.passengerId,
      passengerName: ride.passengerName,
      createdAt: Timestamp.now()
    });
  };

  const acceptRide = async (ride: Ride) => {
    const pStatus = getPenaltyStatus();
    if (pStatus === "BLOCKED_5_HOURS" || pStatus === "SUSPENDED_2_DAYS" || pStatus === "PERMANENT" || pStatus === "SUSPENDED_2_HOURS" || pStatus === "SUSPENDED_36_HOURS") {
      return Alert.alert("Access Denied", "Your account is currently restricted.");
    }
    if (!driverPhone || !vehiclePlate) return setIsIdentitySet(false);
    await updateDoc(doc(db, 'rides', ride.id!), {
      status: 'accepted', driverId: auth.currentUser?.uid,
      driverPhone: driverPhone, driverName: driverName, vehiclePlate: vehiclePlate,
      ...(ride.type === 'ShareAuto'
        ? { shareAutoPickupCompletedIds: [], shareAutoDropCompletedIds: [] }
        : {})
    });
    setCurrentRide(ride);
  };

  const cancelRide = async (id: string, isDriver: boolean, reason?: string) => {
    if (isDriver) {
        Alert.alert(
            "Warning", 
            "Cancelling after accepting hurts our community.",
            [
                { text: "Go Back", style: "cancel" },
                { text: "Confirm Cancel", style: "destructive", onPress: async () => {
                  const rideRef = doc(db, 'rides', id);
                  const rideSnap = await getDoc(rideRef);
                  if (rideSnap.exists()) {
                    const rideData = { id: rideSnap.id, ...rideSnap.data() } as Ride;
                    await addRideHistoryEntry(rideData, 'cancelled', 'DRIVER');
                  }
                    await updateDoc(doc(db, 'rides', id), { status: 'waiting', driverId: null, driverPhone: '', vehiclePlate: '' });
                    setCurrentRide(null);
                    const newHistory = [...driverStats.cancelHistory, Date.now()];
                    let isPerm = driverStats.isPermanentlySuspended;
                    if (driverStats.cancelHistory.filter(t => t > (Date.now() - 48*60*60*1000)).length > 25) {
                        isPerm = true;
                    }
                    setDriverStats(prev => ({ ...prev, cancelled: prev.cancelled + 1, cancelHistory: newHistory, isPermanentlySuspended: isPerm }));
                    setShowDetails(false);
                }}
            ]
        );
    } else {
        try {
          if (reason === 'extra_money' || reason === 'bad_behavior') {
              Alert.alert("Reported", "Driver behavior reported. We will take action.");
          }
          const rideRef = doc(db, 'rides', id);
          const rideSnap = await getDoc(rideRef);
          if (rideSnap.exists()) {
            const rideData = { id: rideSnap.id, ...rideSnap.data() } as Ride;
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
        } catch {
          Alert.alert('Cancel failed', 'Could not cancel this ride. Please try again.');
        }
    }
  };

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const shouldAutoCancel =
        mode === 'USER' &&
        !!userBookedRide?.id &&
        (userBookedRide.status === 'waiting' || userBookedRide.status === 'accepted') &&
        nextState !== 'active';

      if (!shouldAutoCancel || autoCancelInProgressRef.current) return;

      autoCancelInProgressRef.current = true;
      cancelRide(userBookedRide!.id!, false, 'left_screen')
        .finally(() => {
          autoCancelInProgressRef.current = false;
        });
    });

    return () => subscription.remove();
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

  const getCurrentUserRideOtp = (ride: Ride | null) => {
    if (!ride) return '';
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
    await updateDoc(doc(db, 'rides', currentRide.id), { shareAutoPickupCompletedIds: Array.from(done) });
    setOtpInput('');
    setSelectedSharePassengerId('');
  };

  const handleShareDropComplete = async () => {
    if (!currentRide?.id || !selectedSharePassengerId) return;
    const done = new Set(currentRide.shareAutoDropCompletedIds || []);
    done.add(selectedSharePassengerId);
    const allPassengerCount = currentRide.shareAutoPassengerIds?.length || 0;
    const completedDrops = Array.from(done);

    if (completedDrops.length >= allPassengerCount && allPassengerCount > 0) {
      const totalShareFare = (currentRide.shareAutoPassengerFares || []).reduce((sum, x) => sum + x, 0) || currentRide.fare;
      await addRideHistoryEntry(currentRide, 'completed');
      setDriverStats(prev => ({ ...prev, completed: prev.completed + 1, earnings: prev.earnings + totalShareFare }));
      await deleteDoc(doc(db, 'rides', currentRide.id));
      setCurrentRide(null);
      setSelectedSharePassengerId('');
      return;
    }

    await updateDoc(doc(db, 'rides', currentRide.id), { shareAutoDropCompletedIds: completedDrops });
    setSelectedSharePassengerId('');
  };

  const handleAuth = async () => {
    if (!isSignup) {
      await signInWithEmailAndPassword(auth, email, password);
      return;
    }

    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name.');
      return;
    }
    if (!isValidMobile(mobileNumber)) {
      Alert.alert('Invalid mobile', 'Enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.');
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await setDoc(doc(db, 'users', cred.user.uid), {
      name: fullName.trim(),
      phone: mobileNumber,
      email: email.trim(),
      createdAt: Timestamp.now()
    });
    setProfileName(fullName.trim());
    setProfilePhone(mobileNumber);
  };

  if (!loggedIn) {
    return (
      <View style={styles.loginContainer}>
        <Text style={styles.title}>{isSignup ? 'Join Share It' : 'Welcome'}</Text>
        {isSignup && <TextInput style={styles.input} placeholder="Full Name" value={fullName} onChangeText={setFullName} />}
        {isSignup && <TextInput style={styles.input} placeholder="10-digit Mobile Number" value={mobileNumber} onChangeText={(v) => setMobileNumber(v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={10} />}
        <TextInput style={styles.input} placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
        <TextInput style={styles.input} placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
        <Pressable style={styles.primaryButton} onPress={handleAuth}>
          <Text style={styles.buttonText}>{isSignup ? 'Sign Up' : 'Login'}</Text>
        </Pressable>
        <Pressable onPress={() => setIsSignup(!isSignup)}><Text style={styles.switchAuth}>Switch to {isSignup ? 'Login' : 'Signup'}</Text></Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {mode === 'USER' ? (
          !userBookedRide ? (
            <MapView 
              ref={mapRef}
              style={styles.map} provider={PROVIDER_GOOGLE} 
              onPress={(e) => {
                const point = e.nativeEvent.coordinate;
                if (!isWithinHyderabadService(point)) {
                  Alert.alert('Sorry service unavailable', `Service available only in Hyderabad and surroundings up to ${HYDERABAD_SERVICE_RADIUS_KM} km.`);
                  return;
                }
                void playMarkerSound(400);
                setDestCoords(point);
                setDestination("Dropped Pin");
              }}
              initialRegion={location ? {...location, latitudeDelta: 0.05, longitudeDelta: 0.05} : undefined}
            >
              {pickupCoords && <Marker coordinate={pickupCoords} title="Pickup" pinColor="blue" />}
              {destCoords && <Marker coordinate={destCoords} title="Drop" />}
            </MapView>
          ) : (
            userBookedRide.status === 'accepted' ? (
              <MapView
                ref={mapRef}
                style={styles.map}
                provider={PROVIDER_GOOGLE}
                initialRegion={location ? {...location, latitudeDelta: 0.05, longitudeDelta: 0.05} : undefined}
              >
                <Marker coordinate={userBookedRide.pickup} title="Pickup" pinColor="blue" />
                <Marker coordinate={userBookedRide.drop} title="Drop" />
                {userBookedRide.driverLocation && (
                  <Marker coordinate={userBookedRide.driverLocation} title="Driver" description={userBookedRide.driverName || 'Driver'}>
                    <Text style={{fontSize: 28}}>{icons[userBookedRide.type]}</Text>
                  </Marker>
                )}
              </MapView>
            ) : (
              <View style={styles.loyaltyBackground}>
                  <Animated.Text style={[styles.loyaltyIcon, { transform: [{ scale: searchAnim }] }]}>🔍</Animated.Text>
                 <Text style={styles.loyaltyTitle}>Finding your {userBookedRide.type}...</Text>
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
             <ScrollView contentContainerStyle={{alignItems: 'center', paddingTop: 80}}>
               <View style={styles.brandingContainer}>
                  <Text style={styles.brandName}>Share-It</Text>
                  <Text style={styles.slogan}>Where the driver is the king 👑</Text>

                  {(penalty === "WARNING" || penalty === "BEHAVIOR_WARNING") && (
                      <View style={styles.warningBox}>
                          <Text style={styles.warningTitle}>⚠️ {penalty === "BEHAVIOR_WARNING" ? "BEHAVIOR WARNING" : "STRONG WARNING"}</Text>
                          <Text style={styles.warningDesc}>
                            {penalty === "BEHAVIOR_WARNING" 
                                ? "Multiple passengers reported issues with your service. Further reports will lead to suspension."
                                : "You have cancelled many rides. If you reach 13, you will be blocked for 5 hours."}
                          </Text>
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
                  </View>
                  <Pressable style={styles.historyBtn} onPress={() => setShowHistory(true)}>
                    <Text style={styles.historyBtnText}>View Ride History</Text>
                  </Pressable>
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
            </ScrollView>
          </View>
      )}
      
      {mode === 'USER' && !!location && (
        <Pressable style={styles.currentLocFab} onPress={focusOnCurrentLocation}>
          <Text style={styles.currentLocFabText}>⌖</Text>
        </Pressable>
      )}

      {/* HEADER */}
      <View style={styles.header}>
        <Pressable style={styles.badge} onPress={() => setMode(mode === 'USER' ? 'DRIVER' : 'USER')}>
          <Text style={{fontWeight:'700'}}>{mode === 'USER' ? '👤 Passenger' : `🚗 Pro Driver`}</Text>
        </Pressable>
        {!userBookedRide && <Pressable style={styles.logout} onPress={() => signOut(auth)}><Text style={{color:'white'}}>X</Text></Pressable>}
      </View>

      {/* FIXED BOTTOM ACTION CARD - Replaced <div> with <View>  */}
      <View style={styles.bottomCard}>
        {mode === 'USER' ? (
          <>
            {!userBookedRide ? (
              <>
                <TextInput style={styles.input} placeholder="Pickup Area" value={pickupInput} onChangeText={setPickupInput} onSubmitEditing={() => handleSearch('pickup')} />
                <TextInput style={styles.input} placeholder="Drop Area" value={destination} onChangeText={setDestination} onSubmitEditing={() => handleSearch('drop')} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10}}>
                  {(['Bike', 'Auto', 'Cab', 'ShareAuto'] as RideType[]).map(r => (
                    <Pressable
                      key={r}
                      style={[styles.rideCard, r === 'ShareAuto' && styles.shareRideCard, selectedRide === r && styles.selected]}
                      onPress={() => {
                        playUiTapSound('vehicle');
                        setSelectedRide(r);
                      }}
                    >
                      {r === 'ShareAuto' && <Text style={styles.shareAttractLabel}>SAVE MONEY</Text>}
                      <Text style={{fontSize: 24}}>{icons[r]}</Text>
                      <Text style={{fontWeight:'bold'}}>₹{fares[r]}</Text>
                      <Text style={{fontSize: 10}}>{r}</Text>
                    </Pressable>
                  ))}
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
            ) : (
              <View style={{alignItems: 'center'}}>
                {userBookedRide.status === 'accepted' ? (
                  <View style={styles.driverArrivingCard}>
                    <Text style={styles.driverNameText}>{userBookedRide.driverName} is coming</Text>
                    <Text style={{color:'#8E8E93', marginBottom:10}}>{userBookedRide.vehiclePlate}</Text>
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
                  <View style={styles.driverArrivingCard}>
                    <Text style={[styles.searchingText, {color: '#34C759'}]}>🚀 Trip Started!</Text>
                    <Pressable style={styles.navButton} onPress={() => openGoogleMaps(userBookedRide.drop.latitude, userBookedRide.drop.longitude, "Drop")}>
                        <Text style={styles.navButtonText}>Navigate Route</Text>
                    </Pressable>
                  </View>
                ) : (userBookedRide.type === 'ShareAuto' && (userBookedRide.shareAutoSeats || 0) >= 3) ? (
                  <View style={styles.driverArrivingCard}>
                    <Text style={[styles.searchingText, {color: '#6B4E00'}]}>Passengers matched. Your OTP is ready.</Text>
                    <View style={styles.otpClearBox}>
                        <Text style={styles.otpLabel}>SHARE OTP TO START</Text>
                      <Text style={styles.otpValue}>{getCurrentUserRideOtp(userBookedRide)}</Text>
                    </View>
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
                        {(['Bike', 'Auto', 'Cab', 'ShareAuto'] as RideType[]).map(v => (
                            <Pressable
                              key={v}
                              style={styles.rideCard}
                              onPress={async () => {
                                playUiTapSound('vehicle');
                                setDriverVehicle(v);
                                await AsyncStorage.setItem('driver_vehicle', v);
                              }}
                            >
                                <Text style={{fontSize: 30}}>{icons[v]}</Text><Text>{v}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : !isIdentitySet ? (
                <View style={{padding: 10}}>
                    <Text style={styles.sectionTitle}>Identity Setup</Text>
                    <TextInput style={styles.input} placeholder="Full Name" value={driverName} onChangeText={setDriverName} />
                    <TextInput style={styles.input} placeholder="Phone" value={driverPhone} onChangeText={setDriverPhone} keyboardType="phone-pad" />
                    <TextInput style={styles.input} placeholder="Plate Number" value={vehiclePlate} onChangeText={setVehiclePlate} />
                    <Pressable style={styles.primaryButton} onPress={() => (driverPhone && vehiclePlate && driverName) ? setIsIdentitySet(true) : Alert.alert("Required", "Fill all details")}><Text style={styles.buttonText}>Go Online</Text></Pressable>
                </View>
            ) : currentRide ? (
              <View>
                <Text style={styles.sectionTitle}>{currentRide.status === 'started' ? "Trip On" : "New Job"}</Text>
                {currentRide.status === 'accepted' ? (
                  <>
                    {currentRide.type === 'ShareAuto' && (currentRide.shareAutoPassengerIds?.length || 0) > 1 ? (() => {
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
                    {!(currentRide.type === 'ShareAuto' && (currentRide.shareAutoPassengerIds?.length || 0) > 1) && (
                      <>
                        <Pressable style={styles.navButton} onPress={() => openGoogleMaps(currentRide.pickup.latitude, currentRide.pickup.longitude, "Pickup")}><Text style={styles.navButtonText}>📍 Go to Pickup</Text></Pressable>
                        <TextInput style={styles.input} placeholder="Enter OTP" value={otpInput} onChangeText={setOtpInput} keyboardType="number-pad" />
                        <Pressable style={styles.primaryButton} onPress={async () => {
                             if(decryptOTP(currentRide.encryptedOTP) === otpInput) {
                                await updateDoc(doc(db, 'rides', currentRide.id!), { status: 'started' });
                                setOtpInput('');
                             } else Alert.alert("Error", "Invalid OTP");
                        }}><Text style={styles.buttonText}>Start Trip</Text></Pressable>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    <Pressable style={[styles.navButton, {backgroundColor: '#34C759'}]} onPress={() => openGoogleMaps(currentRide.drop.latitude, currentRide.drop.longitude, "Dropoff")}><Text style={styles.navButtonText}>🏁 Go to Destination</Text></Pressable>
                    <Pressable style={styles.cancelButton} onPress={async () => {
                        if (calcDist(location!, currentRide.drop) < 0.5) {
                            await addRideHistoryEntry(currentRide, 'completed');
                            setDriverStats(prev => ({...prev, completed: prev.completed + 1, earnings: prev.earnings + currentRide.fare}));
                            await deleteDoc(doc(db, 'rides', currentRide.id!));
                            setCurrentRide(null);
                        } else Alert.alert("Notice", "Arrive first");
                    }}><Text style={styles.buttonText}>Complete</Text></Pressable>
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
                    <TouchableOpacity onPress={() => setIsIdentitySet(false)}><Text style={{color:'#007AFF'}}>Profile</Text></TouchableOpacity>
                </View>
                {(visibleDriverRides.length === 0 || (penalty !== "CLEAR" && penalty !== "WARNING" && penalty !== "BEHAVIOR_WARNING")) ? (
                  <Text style={styles.emptyText}>
                      {(penalty !== "CLEAR" && penalty !== "WARNING" && penalty !== "BEHAVIOR_WARNING") 
                      ? "❌ Access Restricted." 
                      : "Waiting for requests..."}
                  </Text>
                ) : 
                  visibleDriverRides.map(r => (
                    <View key={r.id} style={styles.notificationCard}>
                      <View style={styles.notifHeader}>
                        <Text style={{fontSize: 28}}>{icons[r.type]}</Text>
                        <View style={{flex: 1, marginLeft: 10}}>
                          <Text style={styles.highlightPrice}>₹{r.fare} {r.tip > 0 && `(+₹${r.tip})`}</Text>
                          <Text style={{color:'#8E8E93', fontSize: 12}}>{r.distance.toFixed(1)} km ride</Text>
                          <Text style={styles.routeText}>{r.pickupAddr || 'Pickup'} ➔ {r.dropAddr || 'Drop'}</Text>
                          {r.type === 'ShareAuto' && (
                            <>
                              {(() => {
                                const summary = getShareNotificationSummary(r);
                                return (
                                  <View style={styles.shareSingleNotifCard}>
                                    <Text style={styles.shareSingleNotifTitle}>Share Ride • {r.shareAutoSeats || 0} passengers</Text>
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
                      <View style={styles.row}>
                        <Pressable style={styles.negButton} onPress={() => setIgnoredRides([...ignoredRides, r.id!])}><Text style={{color: '#8E8E93'}}>Skip</Text></Pressable>
                        <Pressable style={styles.accButton} onPress={() => acceptRide(r)}><Text style={styles.accText}>ACCEPT</Text></Pressable>
                      </View>
                    </View>
                  ))}
                <TouchableOpacity onPress={() => { AsyncStorage.removeItem('driver_vehicle'); setDriverVehicle(null); setIsIdentitySet(false); }} style={{marginTop: 15}}><Text style={{color: '#8E8E93', textAlign:'center'}}>Change Vehicle</Text></TouchableOpacity>
              </View>
            )}
          </ScrollView>
        )}
      </View>

      {/* TRIP INFO MODAL */}
      <Modal visible={showDetails} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.detailsModal}>
            <Text style={styles.modalTitle}>Trip Information</Text>
            <ScrollView style={{maxHeight: 500}}>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>From:</Text>
                    <Text style={styles.valText}>{(mode === 'USER' ? userBookedRide?.pickupAddr : currentRide?.pickupAddr) || 'N/A'}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>To:</Text>
                    <Text style={styles.valText}>{(mode === 'USER' ? userBookedRide?.dropAddr : currentRide?.dropAddr) || 'N/A'}</Text>
                </View>
                <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Final Fare:</Text>
                    <Text style={[styles.valText, {color:'#34C759', fontWeight:'bold'}]}>₹{mode === 'USER' ? userBookedRide?.fare : currentRide?.fare}</Text>
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
          <Text style={styles.shareAutoSubtitle}>We search for up to 2 minutes, then confirm a group or suggest a faster option after 3 minutes.</Text>

          <View style={styles.shareAutoTimerCard}>
            <Text style={styles.shareAutoTimerLabel}>Searching time</Text>
            <Text style={styles.shareAutoTimerValue}>{shareAutoElapsed}s</Text>
            <Text style={styles.shareAutoTimerHint}>Up to 3 passengers only</Text>
            {!shareAutoPoolId && <Text style={styles.shareAutoSetupHint}>Initializing secure matching...</Text>}
            {shareAutoPoolId && (
              <Text style={styles.shareAutoFoundHint}>
                {shareAutoFoundMembers === 2 ? '2 members found' : 'Searching for members...'}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  map: { flex: 1 },
  loyaltyBackground: { flex: 1, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', padding: 30 },
  loyaltyIcon: { fontSize: 80, marginBottom: 20 },
  loyaltyTitle: { fontSize: 22, fontWeight: '900', color: '#1C1C1E', marginBottom: 20, textAlign: 'center' },
  loyaltyCard: { backgroundColor: '#F8F9FB', padding: 20, borderRadius: 20, width: '100%', marginBottom: 30 },
  loyaltyText: { fontSize: 16, color: '#3A3A3C', marginBottom: 15, lineHeight: 22 },
  loyaltySlogan: { fontSize: 14, color: '#007AFF', fontWeight: 'bold' },
  proBackground: { flex: 1, backgroundColor: '#F8F9FB' },
  brandingContainer: { padding: 30, alignItems: 'center', width: '100%' },
  brandName: { fontSize: 42, fontWeight: '900', color: '#007AFF', marginBottom: 10 },
  slogan: { fontSize: 18, fontWeight: '700', color: '#1C1C1E', textAlign: 'center', marginBottom: 20 },
  dashboard: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'white', padding: 20, borderRadius: 25, elevation: 4, width: '100%', justifyContent:'space-between' },
  historyBtn: { marginTop: 12, backgroundColor: '#0A8F48', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12 },
  historyBtnText: { color: 'white', fontWeight: '700' },
  dashItem: { width: '45%', alignItems: 'center', marginBottom: 15 },
  dashVal: { fontSize: 22, fontWeight: '900', color: '#1C1C1E' },
  dashLab: { fontSize: 12, color: '#8E8E93', fontWeight: 'bold' },
  header: { position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  currentLocFab: { position: 'absolute', right: 18, bottom: 235 + CURRENT_LOC_FAB_RISE, width: 24, height: 24, borderRadius: 12, backgroundColor: '#007AFF', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#111827', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, zIndex: 12, borderWidth: 1, borderColor: '#005FCC' },
  currentLocFabText: { fontSize: 12, color: '#FFFFFF', fontWeight: '900' },
  badge: { backgroundColor: 'white', padding: 12, borderRadius: 25, elevation: 5 },
  logout: { backgroundColor: '#FF3B30', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  bottomCard: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'white', padding: 20, borderTopLeftRadius: 30, borderTopRightRadius: 30, elevation: 20 },
  input: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, marginBottom: 10 },
  primaryButton: { backgroundColor: '#007AFF', padding: 16, borderRadius: 15, alignItems: 'center' },
  cancelButton: { backgroundColor: '#FF3B30', padding: 12, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  buttonText: { color: 'white', fontWeight: 'bold' },
  rideCard: { width: 85, padding: 10, backgroundColor: '#fff', marginRight: 10, borderRadius: 15, alignItems: 'center', borderWidth: 1, borderColor: '#E5E5EA' },
  shareRideCard: { borderColor: '#D9A600', backgroundColor: '#FFF1B8', borderWidth: 2, shadowColor: '#B88900', shadowOpacity: 0.24, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  shareAttractLabel: { position: 'absolute', top: -8, backgroundColor: '#E8B400', color: '#3F2C00', fontSize: 9, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#9A7400' },
  selected: { borderColor: '#007AFF', backgroundColor: '#F2F7FF', borderWidth: 2 },
  searchingText: { fontSize: 14, fontWeight: '700', color: '#007AFF', textAlign: 'center' },
  highlightPrice: { fontSize: 20, fontWeight: '900', color: '#34C759' },
  routeText: { fontSize: 14, fontWeight: '700', color: '#1C1C1E', marginTop: 2 },
  otpClearBox: { backgroundColor: '#F2F7FF', padding: 15, borderRadius: 15, borderWidth: 1, borderColor: '#007AFF', alignItems: 'center', width: '100%' },
  otpValue: { fontSize: 32, fontWeight: '900' },
  otpLabel: { fontSize: 10, color: '#007AFF', fontWeight: 'bold' },
  detailsBtn: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 12, width: '100%', alignItems: 'center', marginTop: 10 },
  detailsBtnText: { fontWeight: '700' },
  chatButton: { backgroundColor: '#127A40', padding: 12, borderRadius: 12, width: '100%', alignItems: 'center', marginTop: 10, position: 'relative' },
  chatButtonText: { color: 'white', fontWeight: '700' },
  unreadDot: { position: 'absolute', right: 12, top: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: '#D62828' },
  callBtn: { marginTop: 8, backgroundColor: '#E8F5E9', borderWidth: 1, borderColor: '#1B5E20', borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14 },
  callBtnText: { color: '#1B5E20', fontWeight: '700' },
  smallCallBtn: { backgroundColor: '#E8F5E9', borderColor: '#1B5E20', borderWidth: 1, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6 },
  smallCallBtnText: { color: '#1B5E20', fontWeight: '700', fontSize: 12 },
  smallNavBtn: { backgroundColor: '#111827', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6 },
  smallNavBtnText: { color: 'white', fontWeight: '700', fontSize: 12 },
  reachingBtn: { backgroundColor: '#FFF4CC', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 6, borderColor: '#E1B500', borderWidth: 1 },
  reachingBtnText: { color: '#6B4E00', fontWeight: '800', fontSize: 12 },
  contactCard: { backgroundColor: '#F4FBF6', borderColor: '#CFE8D5', borderWidth: 1, borderRadius: 12, padding: 10, marginBottom: 10 },
  contactTitle: { fontWeight: '800', marginBottom: 4, color: '#1B5E20' },
  contactText: { color: '#1F2937' },
  sharePassengerRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  sharePassengerMeta: { color: '#4B5563', fontSize: 12 },
  shareDriverFlowCard: { backgroundColor: '#FFF6CC', borderColor: '#E8C549', borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 10, width: '100%' },
  shareDriverFlowTitle: { color: '#6B4E00', fontWeight: '900', fontSize: 15, marginBottom: 2 },
  shareDriverFlowSub: { color: '#7A5C00', fontWeight: '700', marginBottom: 8 },
  shareDriverTaskCard: { width: 170, backgroundColor: '#FFF0A6', borderColor: '#D8B03D', borderWidth: 1, borderRadius: 12, padding: 10, marginRight: 8 },
  shareDriverTaskCardSelected: { backgroundColor: '#FFD84D', borderColor: '#9F7600' },
  shareDriverTaskTitle: { color: '#4B3B00', fontWeight: '900', marginBottom: 4 },
  shareDriverTaskMeta: { color: '#6B5A14', fontSize: 12, marginBottom: 2 },
  shareDriverActionCard: { backgroundColor: '#FFFBE8', borderColor: '#E8C549', borderWidth: 1, borderRadius: 12, padding: 10 },
  shareSingleNotifCard: { backgroundColor: '#FFF6CC', borderColor: '#E8C549', borderWidth: 1, borderRadius: 10, padding: 8, marginTop: 6 },
  shareSingleNotifTitle: { color: '#6B4E00', fontWeight: '900', marginBottom: 3 },
  shareSingleNotifMeta: { color: '#6B5A14', fontSize: 12 },
  notificationCard: { backgroundColor: '#fff', borderRadius: 15, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: '#007AFF' },
  notifHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  accButton: { flex: 2, backgroundColor: '#34C759', padding: 12, borderRadius: 10, alignItems: 'center' },
  accText: { color: 'white', fontWeight: 'bold' },
  negButton: { flex: 1, backgroundColor: '#F2F2F7', padding: 12, borderRadius: 10, alignItems: 'center', marginRight: 10 },
  navButton: { backgroundColor: '#000', padding: 14, borderRadius: 12, marginBottom: 10, alignItems: 'center', width: '100%' },
  navButtonText: { color: 'white', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  detailsModal: { backgroundColor: 'white', padding: 25, borderRadius: 25, width: '90%' },
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 15, textAlign:'center' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  detailLabel: { color: '#8E8E93' },
  valText: { flex: 1, textAlign: 'right', fontWeight: '600' },
  loginContainer: { flex: 1, justifyContent: 'center', padding: 30 },
  title: { fontSize: 28, fontWeight: 'bold', marginBottom: 20, textAlign: 'center' },
  switchAuth: { textAlign: 'center', marginTop: 20, color: '#007AFF' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  emptyText: { textAlign: 'center', color: '#8E8E93', marginVertical: 20 },
  driverNameText: { fontSize: 18, fontWeight: 'bold' },
  driverArrivingCard: { width: '100%', alignItems: 'center' },
  tipOption: { backgroundColor: '#E8F2FF', padding: 12, borderRadius: 10, width: '45%', alignItems: 'center', marginBottom: 5 },
  tipText: { color: '#007AFF', fontWeight: 'bold' },
  warningBox: { backgroundColor: '#FFFBE6', borderLeftWidth: 5, borderColor: '#FAAD14', padding: 15, borderRadius: 10, marginBottom: 20, width: '100%' },
  warningTitle: { fontWeight: '900', color: '#FAAD14', marginBottom: 5 },
  warningDesc: { fontSize: 13, color: '#595959' },
  suspensionOverlay: { backgroundColor: 'white', padding: 30, borderRadius: 20, alignItems: 'center', marginTop: 20, width: '90%', elevation: 10 },
  suspensionEmoji: { fontSize: 60, marginBottom: 10 },
  suspensionTitle: { fontSize: 22, fontWeight: '900', color: '#FF3B30', textAlign: 'center' },
  suspensionText: { textAlign: 'center', color: '#3A3A3C', marginVertical: 15 },
  crewBox: { backgroundColor: '#F2F2F7', padding: 15, borderRadius: 15, width: '100%', borderStyle: 'dashed', borderWidth: 2, borderColor: '#8E8E93' },
  crewLabel: { fontSize: 10, fontWeight: '900', color: '#8E8E93', textAlign: 'center', marginBottom: 5 },
  crewInput: { backgroundColor: 'white', padding: 10, borderRadius: 10, textAlign: 'center', marginBottom: 10 },
  crewBtn: { backgroundColor: '#1C1C1E', padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelTitle: { fontWeight: 'bold', color: '#FF3B30', marginBottom: 10 },
  reasonBtn: { backgroundColor: '#F2F2F7', padding: 12, borderRadius: 10, marginBottom: 5 },
  historyCard: { backgroundColor: '#F8F9FB', borderRadius: 12, padding: 10, marginBottom: 8 },
  historyRoute: { fontWeight: '700', color: '#111827' },
  historyMeta: { marginTop: 2, color: '#374151' },
  shareMatchText: { marginTop: 4, color: '#7A5C00', fontWeight: '700', fontSize: 12 },
  shareNotifLine: { color: '#374151', fontSize: 12, marginTop: 2 },
  etaCard: { marginTop: 10, width: '100%', backgroundColor: '#FFF8D6', borderColor: '#E7C956', borderWidth: 1, borderRadius: 12, padding: 10, alignItems: 'center' },
  etaAuto: { fontSize: 24, marginBottom: 4 },
  etaText: { color: '#6B4E00', fontWeight: '700' },
  chatWrap: { flex: 1, backgroundColor: '#EAF8EE' },
  chatHeader: { paddingTop: 56, paddingBottom: 16, paddingHorizontal: 16, backgroundColor: '#0F8A47', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  chatClose: { color: 'white', fontWeight: '700' },
  chatTargetsRow: { maxHeight: 50, backgroundColor: '#F7FCF8', borderBottomWidth: 1, borderBottomColor: '#D5EBDD', paddingHorizontal: 8, paddingVertical: 8 },
  chatTargetBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: '#EAF5EE', marginRight: 8 },
  chatTargetBtnActive: { backgroundColor: '#0F8A47' },
  chatTargetText: { color: '#0F8A47', fontWeight: '700' },
  chatTargetTextActive: { color: 'white' },
  chatBubble: { maxWidth: '80%', borderRadius: 12, padding: 10, marginBottom: 8 },
  chatMine: { alignSelf: 'flex-end', backgroundColor: '#CFF2D6' },
  chatTheirs: { alignSelf: 'flex-start', backgroundColor: 'white' },
  chatName: { fontSize: 11, color: '#0F8A47', marginBottom: 2, fontWeight: '700' },
  chatText: { color: '#111827' },
  chatTargetTag: { marginTop: 4, fontSize: 11, color: '#7A5C00', fontWeight: '700' },
  chatComposer: { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: 'white', borderTopWidth: 1, borderTopColor: '#D1D5DB' },
  chatInput: { flex: 1, backgroundColor: '#F3F4F6', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
  chatSend: { backgroundColor: '#0F8A47', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 18 }
  ,yellowTermsCard: { backgroundColor: '#FFF6CC', borderWidth: 1, borderColor: '#E8C549', borderRadius: 14, padding: 12, marginBottom: 14 },
  termsHeading: { color: '#6B4E00', fontWeight: '900', marginBottom: 8 },
  termsPoint: { color: '#5B4A17', marginBottom: 5, lineHeight: 18 }
  ,shareAutoScreen: { flex: 1, backgroundColor: '#FFF6CC', alignItems: 'center', justifyContent: 'center', padding: 24 },
  shareAutoTopGlow: { position: 'absolute', top: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: 'rgba(255, 220, 77, 0.35)' },
  shareAutoBadge: { backgroundColor: '#FFF0A6', color: '#7A5C00', fontWeight: '800', paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, marginBottom: 18, overflow: 'hidden' },
  shareAutoOrb: { width: 150, height: 150, borderRadius: 75, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#B38F00', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, marginBottom: 22 },
  shareAutoOrbIcon: { fontSize: 56 },
  shareAutoTitle: { fontSize: 24, fontWeight: '900', color: '#4B3B00', textAlign: 'center', marginBottom: 10 },
  shareAutoSubtitle: { fontSize: 15, color: '#6B5A14', textAlign: 'center', lineHeight: 22, marginBottom: 18 },
  shareAutoTimerCard: { width: '100%', backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 22, padding: 18, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#F2D35E' },
  shareAutoTimerLabel: { color: '#8A6A00', fontWeight: '700', marginBottom: 4 },
  shareAutoTimerValue: { fontSize: 42, fontWeight: '900', color: '#D89B00' },
  shareAutoTimerHint: { color: '#7A5C00', marginTop: 6, fontWeight: '600' },
  shareAutoSetupHint: { color: '#8A6A00', marginTop: 8, fontSize: 12, fontWeight: '700' },
  shareAutoFoundHint: { color: '#6B4E00', marginTop: 8, fontSize: 13, fontWeight: '900' },
  shareAutoSorryText: { color: '#A43412', marginTop: 8, fontSize: 13, fontWeight: '800' },
  shareAutoDotsRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  shareAutoDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#D89B00', marginHorizontal: 6 },
  shareAutoGameBtn: { backgroundColor: '#0F8A47', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 14, marginBottom: 10 },
  shareAutoGameBtnText: { color: 'white', fontWeight: '800' },
  shareAutoCancelBtn: { backgroundColor: '#1F2937', paddingVertical: 14, paddingHorizontal: 22, borderRadius: 16 },
  shareAutoCancelText: { color: '#FFF', fontWeight: '800' }
  ,gameWrap: { flex: 1, backgroundColor: '#FEF8E7', padding: 18 },
  gameHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 40, marginBottom: 10 },
  gameTitle: { fontSize: 24, fontWeight: '900', color: '#4B3B00' },
  gameClose: { color: '#0F8A47', fontWeight: '800' },
  gameMeta: { color: '#6B4E00', fontWeight: '800', marginBottom: 8 },
  gameHint: { color: '#7A5C00', marginBottom: 10 },
  gamePauseHint: { color: '#A43412', marginBottom: 10, fontWeight: '700' },
  gameArena: { flex: 1, backgroundColor: '#FFF3C4', borderWidth: 1, borderColor: '#E8C549', borderRadius: 18, marginTop: 12, position: 'relative', overflow: 'hidden' },
  gameFloatingTarget: { position: 'absolute', transform: [{ translateX: -18 }, { translateY: -18 }], width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFD84D', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#B88900' },
  gameZombieTarget: { backgroundColor: '#FFD6D6', borderColor: '#A43412' },
  gameTargetText: { fontSize: 28 }
});