import type { PricingDemandLevel, PricingRideType } from '../../../lib/fare-settings';
import { FARE_ADJUSTMENTS, SURGE_SETTINGS, VEHICLE_DISTANCE_SLABS, VEHICLE_FARE_SETTINGS } from '../../../lib/fare-settings';

export type RidePricingType = PricingRideType;
export type DemandLevel = PricingDemandLevel;

export interface RideFareBreakdown {
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

export interface RideFareQuote {
  finalFare: number;
  breakdown: RideFareBreakdown;
}

const FIRST_KM_FARE_TOLERANCE_KM = 0.1;

const normalizeFareDistanceKm = (distanceKm: number): number => {
  const safeDistance = Math.max(0, distanceKm);
  return Number(safeDistance.toFixed(2));
};

export const getPricingDemandLevel = (getDemandFactor: () => number): DemandLevel => {
  const demandFactor = getDemandFactor();

  // Passenger-per-driver ratio within 1.8km radius.
  if (!Number.isFinite(demandFactor) || demandFactor <= 9) return 'low';
  if (demandFactor > 9 && demandFactor < 16) return 'normal';
  return 'high';
};

export const getSurgeMultiplier = (demandLevel: DemandLevel, timeOfDay: number) => {
  const rushHour = (timeOfDay >= 8 && timeOfDay < 11) || (timeOfDay >= 17 && timeOfDay < 21);
  const setting = SURGE_SETTINGS[demandLevel];
  return rushHour ? setting.rush : setting.normal;
};

export const isNightChargeApplicable = (timeOfDay: number) => timeOfDay >= 23 || timeOfDay < 5;

export const getRandomAdjustment = () => {
  const min = FARE_ADJUSTMENTS.randomAdjustmentMin;
  const max = FARE_ADJUSTMENTS.randomAdjustmentMax;
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const smartRoundFare = (value: number) => {
  const rounded = Math.round(value);
  if (rounded % 10 === 0) return rounded + 2;
  if (rounded % 5 === 0) return rounded + 1;
  if (rounded % 2 === 0) return rounded + 1;
  return rounded;
};

export const getRideFinalDiscountRate = (demandLevel: DemandLevel) => {
  return FARE_ADJUSTMENTS.finalDiscountByDemand[demandLevel];
};

export const calculateSlabDistanceFare = (rideType: RidePricingType, distanceKm: number) => {
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

const interpolate = (value: number, minValue: number, maxValue: number, minResult: number, maxResult: number) => {
  if (maxValue <= minValue) return minResult;
  const ratio = Math.max(0, Math.min(1, (value - minValue) / (maxValue - minValue)));
  return minResult + ((maxResult - minResult) * ratio);
};

export const getPassengerDemandMultiplier = (passengerCountIn4km?: number) => {
  const count = Math.max(0, passengerCountIn4km ?? 0);
  let multiplier = 1;

  if (count < 7) multiplier = interpolate(count, 0, 6, 0.85, 0.95);
  else if (count <= 50) multiplier = interpolate(count, 7, 50, 0.95, 1.0);
  else if (count <= 150) multiplier = interpolate(count, 51, 150, 1.0, 1.1);
  else if (count <= 220) multiplier = interpolate(count, 151, 220, 1.1, 1.2);
  else if (count <= 340) multiplier = interpolate(count, 221, 340, 1.2, 1.4);
  else if (count <= 550) multiplier = interpolate(count, 341, 550, 1.4, 1.8);
  else multiplier = 2.0;

  return Math.min(2.5, Math.max(0.85, multiplier));
};

const getBikeBaseFare = (distanceKm: number) => {
  const d = Math.max(0, distanceKm);
  if (d < 1) return 19;
  if (d < 2) return 14 + d * 7;
  if (d < 3) return 17 + d * 9;
  if (d < 4) return 20 + d * 10;
  if (d < 5) return 30 + d * 11;
  if (d < 8) return 35 + d * 9;
  if (d < 10) return 50 + d * 8.5;
  if (d < 13) return 60 + d * 8.1;
  return 80 + d * 7.3;
};

const getAutoBaseFare = (distanceKm: number) => {
  const d = Math.max(0, distanceKm);
  if (d < 1) return 35;
  if (d < 2) return 25 + d * 10;
  if (d < 3) return 30 + d * 12;
  if (d < 4) return 35 + d * 13;
  if (d < 5) return 45 + d * 14;
  if (d < 8) return 55 + d * 12;
  if (d < 10) return 70 + d * 11;
  if (d < 13) return 85 + d * 10;
  return 100 + d * 9;
};

export const calculateRideFare = (
  rideType: RidePricingType,
  distanceKm: number,
  durationMinutes: number,
  pickupDistanceKm: number,
  demandLevel: DemandLevel,
  timeOfDay: number,
  passengerCountIn4km?: number
): RideFareQuote => {
  const config = VEHICLE_FARE_SETTINGS[rideType];
  const safeDistance = normalizeFareDistanceKm(distanceKm);
  const safeDuration = Math.max(0, durationMinutes);
  const safePickupDistance = Math.max(0, pickupDistanceKm);

  // Car fares follow the requested direct distance rules.
  if (rideType === 'car') {
    const d = safeDistance <= 1 + FIRST_KM_FARE_TOLERANCE_KM ? 1 : safeDistance;
    const fareForDistance = d <= 1
      ? (demandLevel === 'low' ? 86 : demandLevel === 'normal' ? 89 : 93)
      : (demandLevel === 'low' ? 70 + d * 12.4 : demandLevel === 'normal' ? 70 + d * 11.4 : 75 + d * 15);

    return {
      finalFare: Math.round(fareForDistance),
      breakdown: {
        distanceFare: Math.round(fareForDistance),
        timeFare: 0,
        pickupFare: 0,
        surge: 0,
        fees: 0,
        nightCharge: 0,
        randomAdjustment: 0,
        minimumFare: 0,
        surgeMultiplier: 1,
      },
    };
  }

  // Auto fares follow the requested direct distance rules and passenger demand multiplier.
  if (rideType === 'auto') {
    const distanceFare = getAutoBaseFare(safeDistance);
    const surgeMultiplier = getPassengerDemandMultiplier(passengerCountIn4km);
    const fareForDistance = distanceFare * surgeMultiplier;

    return {
      finalFare: Math.round(fareForDistance),
      breakdown: {
        distanceFare: Math.round(distanceFare),
        timeFare: 0,
        pickupFare: 0,
        surge: 0,
        fees: 0,
        nightCharge: 0,
        randomAdjustment: 0,
        minimumFare: 0,
        surgeMultiplier,
      },
    };
  }
  
  // Bike fares follow the requested direct distance rules and passenger demand multiplier.
  if (rideType === 'bike') {
    const distanceFare = getBikeBaseFare(safeDistance);
    const surgeMultiplier = getPassengerDemandMultiplier(passengerCountIn4km);
    const fareForDistance = distanceFare * surgeMultiplier;

    return {
      finalFare: Math.round(fareForDistance),
      breakdown: {
        distanceFare: Math.round(distanceFare),
        timeFare: 0,
        pickupFare: 0,
        surge: 0,
        fees: 0,
        nightCharge: 0,
        randomAdjustment: 0,
        minimumFare: 0,
        surgeMultiplier,
      },
    };
  }

  
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
  const { extraReductionRate } = FARE_ADJUSTMENTS;
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

