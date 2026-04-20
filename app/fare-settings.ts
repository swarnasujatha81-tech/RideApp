export type PricingRideType = 'bike' | 'auto' | 'car';
export type PricingDemandLevel = 'low' | 'normal' | 'high' | 'peak';

export interface VehicleFareSetting {
  baseFare: number;
  minimumFare: number;
  platformFee: number;
  timeRate: number;
  pickupRate: number;
}

export interface SlabSegment {
  startKm: number;
  endKm: number | null;
  ratePerKm: number;
}

export interface VehicleDistanceSlabSetting {
  flatTillKm: number;
  flatFare: number;
  segments: SlabSegment[];
}

export interface SurgeSetting {
  normal: number;
  rush: number;
}

export const VEHICLE_FARE_SETTINGS: Record<PricingRideType, VehicleFareSetting> = {
  bike: { baseFare: 25, minimumFare: 31, platformFee: 0, timeRate: 0.8, pickupRate: 3 },
  auto: { baseFare: 35, minimumFare: 50, platformFee: 1, timeRate: 1.2, pickupRate: 5 },
  car: { baseFare: 60, minimumFare: 80, platformFee: 5, timeRate: 1.5, pickupRate: 5 },
};

export const VEHICLE_DISTANCE_SLABS: Record<PricingRideType, VehicleDistanceSlabSetting> = {
  bike: {
    flatTillKm: 2,
    flatFare: 35,
    segments: [
      { startKm: 2, endKm: 4, ratePerKm: 8 },
      { startKm: 4, endKm: 8, ratePerKm: 6 },
      { startKm: 8, endKm: null, ratePerKm: 5 },
    ],
  },
  auto: {
    flatTillKm: 1.5,
    flatFare: 50,
    segments: [
      { startKm: 1.5, endKm: 5, ratePerKm: 12 },
      { startKm: 5, endKm: 10, ratePerKm: 10 },
      { startKm: 10, endKm: null, ratePerKm: 9 },
    ],
  },
  car: {
    flatTillKm: 2,
    flatFare: 80,
    segments: [
      { startKm: 2, endKm: 6, ratePerKm: 15 },
      { startKm: 6, endKm: 12, ratePerKm: 12 },
      { startKm: 12, endKm: null, ratePerKm: 10 },
    ],
  },
};

export const SURGE_SETTINGS: Record<PricingDemandLevel, SurgeSetting> = {
  low: { normal: 1.0, rush: 1.0 },
  normal: { normal: 1.1, rush: 1.2 },
  high: { normal: 1.3, rush: 1.5 },
  peak: { normal: 1.6, rush: 2.2 },
};

export const FARE_ADJUSTMENTS = {
  nightChargeRate: 0.1,
  randomAdjustmentMin: -2,
  randomAdjustmentMax: 3,
  finalDiscountByDemand: {
    low: 0.15,
    normal: 0.13,
    high: 0.115,
    peak: 0.1,
  } as Record<PricingDemandLevel, number>,
  extraReductionRate: 0.05,
  estimatedSpeedKmh: {
    bike: 28,
    auto: 24,
    car: 20,
  } as Record<PricingRideType, number>,
};

export const SHARE_AUTO_FARE_SETTINGS = {
  minimumTripDistanceKm: 1.2,
  threePassenger: {
    baseFare: 16,
    perKmRate: 6,
  },
  twoPassenger: {
    under2Km: {
      baseM: 8,
      maxIncrease: 0.5,
      increasePerKm: 0.2,
    },
    over2Km: {
      baseM: 7.5,
      maxIncrease: 0.5,
      increasePerKmAfter2: 0.08,
    },
    kFactor: {
      base: 2,
      perKm: 1.2,
      roundStep: 0.5,
    },
  },
};
