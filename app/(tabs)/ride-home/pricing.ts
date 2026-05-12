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

export const calculateRideFare = (
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

  // Car fares follow the requested direct distance rules.
  if (rideType === 'car') {
    const d = safeDistance;
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

  // Auto fares follow the requested direct distance rules.
  if (rideType === 'auto') {
    const d = safeDistance;
    const fareForDistance = d <= 1
      ? (demandLevel === 'low' ? 45 : demandLevel === 'normal' ? 45 : 50)
      : (demandLevel === 'low' ? 20 + d * 9 : demandLevel === 'normal' ? 18 + d * 14 : 25 + d * 13);

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
  
  // Bike fares: use the new simple formulas provided by product requirements.
  if (rideType === 'bike') {
    const d = safeDistance;
    const fareForDistance = d <= 1
      ? (demandLevel === 'low' ? 19 : demandLevel === 'normal' ? 20 : 23)
      : (demandLevel === 'low' ? 13 + d * 6.9 : demandLevel === 'normal' ? 14 + d * 8.5 : 15 + d * 9.7);

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

