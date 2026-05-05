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
  if (demandFactor < 0.2) return 'low';
  if (demandFactor < 0.45) return 'normal';
  if (demandFactor < 0.75) return 'high';
  return 'peak';
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

