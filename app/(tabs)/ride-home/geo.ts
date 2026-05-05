import * as Location from 'expo-location';
import { FIVE_MIN_MS, HYDERABAD_CENTER, HYDERABAD_POPULAR_AREA_POINTS, HYDERABAD_POPULAR_AREAS, HYDERABAD_SERVICE_RADIUS_KM } from './constants';
import type { Coord, Ride } from './types';

export const isValidMobileFn = (val: string) => /^[6-9]\d{9}$/.test(val);
export const isValidEmail = (val: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
export const isValidVehiclePlate = (val: string) => /^[A-Z]{2}\d{2}[A-Z]{1,2}\d{4}$/.test(val.toUpperCase());

export const normalizeSearchString = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s\-()\[\]\/_,]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();

export const getLevenshteinDistance = (a: string, b: string) => {
  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
};

export const getClosestPopularAreaMatch = (query: string) => {
  const normalizedQuery = normalizeSearchString(query);
  if (!normalizedQuery) return null;

  const candidates = HYDERABAD_POPULAR_AREAS.map((area) => ({
    area,
    normalizedArea: normalizeSearchString(area),
  }));

  const exactMatch = candidates
    .filter(
      (candidate) =>
        normalizedQuery.includes(candidate.normalizedArea) ||
        candidate.normalizedArea.includes(normalizedQuery)
    )
    .sort((a, b) => b.normalizedArea.length - a.normalizedArea.length)[0];
  if (exactMatch) return exactMatch.area;

  const bestMatch = candidates.reduce<{ area: string; score: number } | null>((current, { area, normalizedArea }) => {
    const score = getLevenshteinDistance(normalizedQuery, normalizedArea);
    if (!current || score < current.score) {
      return { area, score };
    }
    return current;
  }, null);

  if (!bestMatch) return null;

  const threshold = Math.max(2, Math.floor(normalizedQuery.length * 0.25));
  return bestMatch.score <= threshold ? bestMatch.area : null;
};

export const getSearchSuggestions = (query: string) => {
  const normalizedQuery = normalizeSearchString(query);
  if (!normalizedQuery || normalizedQuery === 'current location') return [];

  const queryTerms = normalizedQuery.split(' ').filter(Boolean);
  if (!queryTerms.length) return [];

  return HYDERABAD_POPULAR_AREAS
    .map((area) => {
      const normalizedArea = normalizeSearchString(area);
      const termScore = queryTerms.reduce((score, term) => score + (normalizedArea.includes(term) ? term.length : 0), 0);
      const exactScore = normalizedArea.startsWith(normalizedQuery) ? 100 : 0;
      return { area, score: exactScore + termScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.area);
};

export const getPrimaryAreaName = (address: string | undefined, fallback: string) => {
  if (!address?.trim()) return fallback;

  const lowerAddress = address.toLowerCase();
  const matchedPopularArea = HYDERABAD_POPULAR_AREAS.find((area) => lowerAddress.includes(area.toLowerCase()));
  if (matchedPopularArea) return matchedPopularArea;

  const fuzzyArea = getClosestPopularAreaMatch(address);
  if (fuzzyArea) return fuzzyArea;

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

