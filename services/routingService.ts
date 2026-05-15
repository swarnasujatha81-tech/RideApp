import Constants from 'expo-constants';
import { getCachedRoute, getRouteCacheKey, saveCachedRoute, type RouteCacheValue } from './cacheService';

export type RoutingCoord = {
  latitude: number;
  longitude: number;
};

export type RouteDistanceResult = RouteCacheValue & {
  provider: 'cache' | 'osrm' | 'ors';
};

const ROUTE_TIMEOUT_MS = 8000;
const inFlightRoutes = new Map<string, Promise<RouteDistanceResult>>();

const getOpenRouteServiceApiKey = () => {
  const extra = Constants.expoConfig?.extra || (Constants as any).manifest2?.extra || {};
  const env = (globalThis as any)?.process?.env || {};
  return (
    extra.openRouteServiceApiKey ||
    extra.orsApiKey ||
    env.EXPO_PUBLIC_ORS_API_KEY ||
    env.ORS_API_KEY ||
    ''
  );
};

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = ROUTE_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const parseRoute = (distanceMeters: unknown, durationSeconds: unknown): RouteCacheValue | null => {
  if (typeof distanceMeters !== 'number' || typeof durationSeconds !== 'number') return null;
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds)) return null;
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;

  return {
    distanceKm: distanceMeters / 1000,
    durationSeconds,
  };
};

const getOsrmRoute = async (origin: RoutingCoord, destination: RoutingCoord): Promise<RouteCacheValue> => {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}?overview=false`;

  const response = await fetchWithTimeout(url);
  if (!response.ok) throw new Error(`OSRM route failed: ${response.status}`);

  const json = await response.json();
  const route = json?.routes?.[0];
  const parsed = parseRoute(route?.distance, route?.duration);
  if (!parsed) throw new Error('OSRM route returned invalid data');

  return parsed;
};

const getOrsRoute = async (origin: RoutingCoord, destination: RoutingCoord): Promise<RouteCacheValue> => {
  const apiKey = getOpenRouteServiceApiKey();
  if (!apiKey) throw new Error('OpenRouteService API key is not configured');

  const params = new URLSearchParams({
    start: `${origin.longitude},${origin.latitude}`,
    end: `${destination.longitude},${destination.latitude}`,
  });
  const url = `https://api.openrouteservice.org/v2/directions/driving-car?${params.toString()}`;

  const response = await fetchWithTimeout(url, {
    headers: {
      Authorization: apiKey,
      Accept: 'application/json',
    },
  });
  if (!response.ok) throw new Error(`OpenRouteService route failed: ${response.status}`);

  const json = await response.json();
  const summary = json?.features?.[0]?.properties?.summary;
  const parsed = parseRoute(summary?.distance, summary?.duration);
  if (!parsed) throw new Error('OpenRouteService route returned invalid data');

  return parsed;
};

export const getRouteDistance = async (
  origin: RoutingCoord,
  destination: RoutingCoord
): Promise<RouteDistanceResult> => {
  const cacheKey = getRouteCacheKey(
    origin.latitude,
    origin.longitude,
    destination.latitude,
    destination.longitude
  );

  const cached = await getCachedRoute(cacheKey);
  if (cached) return { ...cached, provider: 'cache' };

  const existingRequest = inFlightRoutes.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    try {
      let route: RouteCacheValue;
      let provider: RouteDistanceResult['provider'] = 'osrm';

      try {
        route = await getOsrmRoute(origin, destination);
      } catch {
        route = await getOrsRoute(origin, destination);
        provider = 'ors';
      }

      await saveCachedRoute(cacheKey, route);
      return { ...route, provider };
    } finally {
      inFlightRoutes.delete(cacheKey);
    }
  })();

  inFlightRoutes.set(cacheKey, request);
  return request;
};
