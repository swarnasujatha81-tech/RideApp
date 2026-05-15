import AsyncStorage from '@react-native-async-storage/async-storage';

const ROUTE_CACHE_PREFIX = 'route_distance:';
const DEFAULT_ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type RouteCacheValue = {
  distanceKm: number;
  durationSeconds: number;
};

type StoredCacheValue<T> = {
  value: T;
  savedAt: number;
};

export const getRouteCacheKey = (
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
) => `${originLat},${originLng}-${destLat},${destLng}`;

export const getCachedRoute = async (
  cacheKey: string,
  ttlMs = DEFAULT_ROUTE_CACHE_TTL_MS
): Promise<RouteCacheValue | null> => {
  try {
    const raw = await AsyncStorage.getItem(`${ROUTE_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as StoredCacheValue<RouteCacheValue>;
    if (!parsed?.value || Date.now() - parsed.savedAt > ttlMs) {
      await AsyncStorage.removeItem(`${ROUTE_CACHE_PREFIX}${cacheKey}`);
      return null;
    }

    return parsed.value;
  } catch {
    return null;
  }
};

export const saveCachedRoute = async (
  cacheKey: string,
  value: RouteCacheValue
) => {
  try {
    const payload: StoredCacheValue<RouteCacheValue> = {
      value,
      savedAt: Date.now(),
    };
    await AsyncStorage.setItem(`${ROUTE_CACHE_PREFIX}${cacheKey}`, JSON.stringify(payload));
  } catch {
    // Cache failures should never block fare calculation.
  }
};
