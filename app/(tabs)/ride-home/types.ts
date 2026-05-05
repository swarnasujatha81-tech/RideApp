export type RideType = 'Bike' | 'Auto' | 'Cab' | 'ShareAuto' | 'Parcel';
export type DriverVehicleType = 'Bike' | 'Cycle' | 'Auto' | 'Cab';
export type Coord = { latitude: number; longitude: number };
export interface Ride {
  id?: string; type: RideType;
  fare: number; baseFare: number; tip: number; 
  distance: number; pickup: Coord; drop: Coord; encryptedOTP: string;
  acceptedAtMs?: number;
  pickupReachMinutes?: number;
  pickupAddr?: string; dropAddr?: string;
  passengerId?: string;
  passengerName?: string;
  passengerPhone?: string;
  status: 'waiting' | 'accepted' | 'started';
  driverId?: string | null;
  driverPhone?: string;
  driverName?: string;
  driverPhotoUrl?: string;
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
  shareAutoCancelledPassengerIds?: string[];
  shareAutoFareRebalance?: {
    active: boolean;
    cancelledPassengerId: string;
    cancelledPassengerName?: string;
    chargedFare: number;
    remainingFare: number;
    remainingPassengerIds: string[];
    extraFares: number[];
    newFares: number[];
    totalNewFare: number;
    requestedAtMs: number;
    driverApproved?: boolean;
    passengerApprovedIds?: string[];
    passengerDeclinedIds?: string[];
  };
  shareAutoSeats?: number;
  shareAutoGroupKey?: string;
  shareAutoMatchWay?: 'A' | 'B';
  shareAutoRouteNote?: string;
  comboMode?: 'PARCEL_PLUS_BIKE';
  comboParcelSenderId?: string;
  comboParcelSenderName?: string;
  comboParcelSenderPhone?: string;
  comboParcelPickup?: Coord;
  comboParcelDrop?: Coord;
  comboParcelPickupAddr?: string;
  comboParcelDropAddr?: string;
  comboParcelDistance?: number;
  comboParcelFare?: number;
  comboParcelEncryptedOTP?: string;
  comboTotalFare?: number;
  comboTotalDistance?: number;
  comboStage?: 'parcel_pickup' | 'passenger_pickup' | 'passenger_drop' | 'parcel_drop';
  earnBookedByUserId?: string;
  earnBookedByName?: string;
  earnBookedByEmail?: string;
  earnPassengerName?: string;
  earnPassengerPhone?: string;
  earnPassengerEmail?: string;
}

export interface ShareAutoPool {
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

export interface RideHistory {
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
  appFeeToApp?: number;
  driverPayout?: number;
  hiddenEarnSurcharge?: number;
  pickupReachMinutes?: number;
  createdAt?: any;
}

export interface ChatMessage {
  text: string;
  senderId: string;
  senderRole: 'USER' | 'DRIVER';
  senderName?: string;
  targetPassengerId?: string;
  targetPassengerName?: string;
  createdAt: number;
}

export interface HelpAnswer {
  text: string;
  byName: string;
  byPhone?: string;
  byEmail?: string;
  createdAtMs: number;
}

export interface HelpQuestion {
  id?: string;
  question: string;
  askedByName: string;
  askedByPhone?: string;
  askedByEmail?: string;
  createdAtMs: number;
  answers?: HelpAnswer[];
}

export interface PoolPassenger {
  id: string;
  name: string;
  phone: string;
  pickup: Coord;
  drop: Coord;
  pickupAddr?: string;
  dropAddr?: string;
}

export const isActiveRideStatus = (status: Ride['status'] | 'cancelled') =>
  status === 'waiting' || status === 'accepted' || status === 'started';

export interface ShareAutoMatchResult {
  way: 'A' | 'B';
  passengers: PoolPassenger[];
  score: number;
}

