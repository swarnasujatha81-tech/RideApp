import * as Location from 'expo-location';
import { FIVE_MIN_MS, HYDERABAD_CENTER, HYDERABAD_POPULAR_AREA_POINTS, HYDERABAD_SERVICE_RADIUS_KM } from './constants';
import type { Coord, Ride } from './types';

export const isValidMobileFn = (val: string) => /^[6-9]\d{9}$/.test(val);
export const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
export const isValidVehiclePlate = (val: string) => /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(val.toUpperCase());

export const getPrimaryAreaName = (address: string | undefined, fallback: string) => {
  if (!address?.trim()) return fallback;

  const firstSegment = address
    .split(',')
    .map((segment) => segment.trim())
    .find((segment) => segment.length > 0);

  if (!firstSegment) return fallback;

  const cleanedSegment = firstSegment
    .replace(/\b\d{1,6}\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleanedSegment || fallback;
};

export const getMandalName = (address: string | undefined, fallback: string) => {
  if (!address?.trim()) return fallback;

  const parts = address
    .split(',')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!parts.length) return fallback;

  const mandalPart = parts.find((segment) => /\bmandal\b/i.test(segment));
  if (mandalPart) return mandalPart;

  const secondPart = parts[1];
  if (secondPart) return secondPart;

  return fallback;
};

export const getNearestPopularArea = (coord: Coord) => {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const distanceKm = (a: Coord, b: Coord) => {
    const R = 6371;
    const dLat = toRad(b.latitude - a.latitude);
    const dLon = toRad(b.longitude - a.longitude);
    const val =
      (Math.sin(dLat / 2) ** 2) +
      (Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * (Math.sin(dLon / 2) ** 2));
    return R * 2 * Math.atan2(Math.sqrt(val), Math.sqrt(1 - val));
  };

  let nearest = HYDERABAD_POPULAR_AREA_POINTS[0];
  let nearestDistance = Number.POSITIVE_INFINITY;

  HYDERABAD_POPULAR_AREA_POINTS.forEach((point) => {
    const currentDistance = distanceKm(coord, point.coord);
    if (currentDistance < nearestDistance) {
      nearest = point;
      nearestDistance = currentDistance;
    }
  });

  return nearest?.name || 'Hyderabad';
};

export const getAreaLabelFromCoord = async (coord: Coord, fallbackLabel: string) => {
  try {
    const places = await Location.reverseGeocodeAsync(coord);
    const place = places[0];
    if (!place) return fallbackLabel;

    return (
      place.name ||
      place.district ||
      place.subregion ||
      place.city ||
      place.region ||
      fallbackLabel
    );
  } catch {
    return fallbackLabel;
  }
};

export const getRideCreatedAtMs = (createdAt: any): number => {
  if (!createdAt) return 0;
  if (typeof createdAt?.toMillis === 'function') return createdAt.toMillis();
  if (typeof createdAt?.toDate === 'function') return createdAt.toDate().getTime();
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'number') return createdAt;
  return 0;
};

export const isFreshWaitingRide = (ride: Ride) => {
  const createdAtMs = getRideCreatedAtMs(ride.createdAt);
  if (!createdAtMs) return false;
  return ride.status === 'waiting' && (Date.now() - createdAtMs) <= FIVE_MIN_MS;
};

export function calcDist(a: Coord, b: Coord) {
  const R = 6371;
  const dLat = (b.latitude - a.latitude) * Math.PI / 180;
  const dLon = (b.longitude - a.longitude) * Math.PI / 180;
  const val = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * Math.PI / 180) * Math.cos(b.latitude * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(val), Math.sqrt(1 - val));
}

export const isWithinHyderabadService = (coord: Coord) => {
  return calcDist(HYDERABAD_CENTER, coord) <= HYDERABAD_SERVICE_RADIUS_KM;
};

