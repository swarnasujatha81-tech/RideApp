import AsyncStorage from '@react-native-async-storage/async-storage';

export type LocationSuggestion = {
  displayName: string;
  title: string;
  subtitle: string;
  latitude: number;
  longitude: number;
  placeId: string;
  placeType?: string;
};

type NominatimResult = {
  display_name?: unknown;
  lat?: unknown;
  lon?: unknown;
  place_id?: unknown;
  class?: unknown;
  type?: unknown;
};

type SearchCacheEntry = {
  results: LocationSuggestion[];
  savedAt: number;
};

export type SearchResponse = {
  results: LocationSuggestion[];
  query: string;
  source: 'cache' | 'network';
  error?: 'empty' | 'network';
};

const NOMINATIM_TIMEOUT_MS = 7000;
const SEARCH_CACHE_LIMIT = 20;
const SEARCH_CACHE_STORAGE_KEY = '@rideapp:nominatim_recent_search_cache_v1';
const HYDERABAD_VIEWBOX = '78.2100,17.6500,78.6700,17.1800';
const inFlightSearches = new Map<string, Promise<SearchResponse>>();
const memorySearchCache = new Map<string, SearchCacheEntry>();
let persistedSearchCache: Record<string, SearchCacheEntry> | null = null;
let cacheLoadPromise: Promise<void> | null = null;
const HYDERABAD_HINTS = ['hyderabad', 'secunderabad', 'cyberabad', 'telangana'];
const MAX_DISPLAY_NAME_LENGTH = 240;

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = NOMINATIM_TIMEOUT_MS) => {
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadSearchCache = async () => {
  if (persistedSearchCache) return;
  if (!cacheLoadPromise) {
    cacheLoadPromise = (async () => {
      try {
        const stored = await AsyncStorage.getItem(SEARCH_CACHE_STORAGE_KEY);
        if (!stored) {
          persistedSearchCache = {};
          return;
        }

        const parsed = JSON.parse(stored) as Record<string, SearchCacheEntry> | null;
        persistedSearchCache = parsed && typeof parsed === 'object' ? parsed : {};

        Object.entries(persistedSearchCache).forEach(([key, entry]) => {
          if (entry?.results?.length) memorySearchCache.set(key, entry);
        });
      } catch {
        persistedSearchCache = {};
      }
    })();
  }

  await cacheLoadPromise;
};

const persistSearchCache = async () => {
  if (!persistedSearchCache) return;
  try {
    await AsyncStorage.setItem(SEARCH_CACHE_STORAGE_KEY, JSON.stringify(persistedSearchCache));
  } catch {
    // Cache failures should not affect search behavior.
  }
};

const setCachedSearchResults = async (key: string, results: LocationSuggestion[]) => {
  const entry: SearchCacheEntry = { results, savedAt: Date.now() };
  memorySearchCache.set(key, entry);

  if (!persistedSearchCache) persistedSearchCache = {};
  persistedSearchCache[key] = entry;

  const orderedEntries = Object.entries(persistedSearchCache)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, SEARCH_CACHE_LIMIT);

  persistedSearchCache = Object.fromEntries(orderedEntries);
  memorySearchCache.clear();
  orderedEntries.forEach(([cacheKey, cacheEntry]) => {
    memorySearchCache.set(cacheKey, cacheEntry);
  });

  void persistSearchCache();
};

const getCachedSearchResults = async (key: string) => {
  if (memorySearchCache.has(key)) return memorySearchCache.get(key)?.results || null;

  await loadSearchCache();
  return memorySearchCache.get(key)?.results || null;
};

const normalizeQuery = (value: string) => value.replace(/\s+/g, ' ').trim();
const buildFallbackQueries = (input: string) => {
  const normalized = normalizeQuery(input);
  const candidates = [
    `${normalized} Hyderabad`,
    `${normalized}, Telangana`,
    normalized,
  ];

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const lowered = candidate.toLowerCase();
    if (seen.has(lowered)) return false;
    seen.add(lowered);
    return true;
  });
};

const buildSearchUrl = (query: string) => {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    addressdetails: '1',
    limit: '8',
    countrycodes: 'in',
    bounded: '1',
    viewbox: HYDERABAD_VIEWBOX,
  });

  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
};

const fetchJsonWithRetry = async (url: string, options: RequestInit) => {
  try {
    const response = await fetchWithTimeout(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } catch (error) {
    await delay(1000);
    const retryResponse = await fetchWithTimeout(url, options);
    if (!retryResponse.ok) throw new Error(`HTTP ${retryResponse.status}`);
    return retryResponse;
  }
};

const normalizeText = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

const splitDisplayName = (displayName: string) => displayName
  .split(',')
  .map((segment) => segment.replace(/\s{2,}/g, ' ').trim())
  .filter(Boolean)
  .filter((segment) => !/^\d{1,6}$/.test(segment))
  .filter((segment) => !/^\d{1,3}(?:\.\d+)?\s*,\s*\d{1,3}(?:\.\d+)?$/.test(segment));

const looksLikeCoordinates = (value: string) => (
  /\b-?\d{1,3}(?:\.\d+)?\s*,\s*-?\d{1,3}(?:\.\d+)?\b/.test(value)
  || /\b\d{1,3}\.\d+\s*[NS]\b/i.test(value)
  || /\b\d{1,3}\.\d+\s*[EW]\b/i.test(value)
);

const cleanTitle = (part: string) => part
  .replace(/\b\d{1,6}\b/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();

const buildSubtitle = (parts: string[], title: string) => {
  const candidate = parts.slice(1).find((segment) => {
    const lowered = segment.toLowerCase();
    return !looksLikeCoordinates(segment)
      && lowered !== title.toLowerCase()
      && !/^\d{1,6}(?:\s*[-/\s]\s*\d{1,6})?$/.test(segment)
      && !/\b(pin code|pincode|postal code|india|district|state)\b/i.test(segment);
  }) || '';

  const cleanedCandidate = cleanTitle(candidate);
  if (!cleanedCandidate) return 'Hyderabad';

  return /hyderabad/i.test(cleanedCandidate)
    ? cleanedCandidate.replace(/\bhyderabad\b/i, 'Hyderabad')
    : `${cleanedCandidate}, Hyderabad`;
};

const getPlacePriority = (className: string, typeName: string, title: string) => {
  const classType = `${className.toLowerCase()}:${typeName.toLowerCase()}`;
  const titleLower = title.toLowerCase();

  if (/metro|railway_station|train_station|subway_entrance|station/.test(classType)) return 0;
  if (/suburb|neighbourhood|neighborhood|quarter|city_district|locality/.test(classType)) return 1;
  if (/road|street|pedestrian|route|highway|junction|roundabout|avenue/.test(classType)) return 2;
  if (/attraction|tourism|park|monument|landmark|museum|mall|market/.test(classType)) return 3;
  if (/amenity|place:town|place:village|place:hamlet/.test(classType)) return 4;
  if (/shop|office|building/.test(classType)) return 6;
  if (/house|yes/.test(typeName.toLowerCase())) return 7;

  if (/\bmetro\b|\bstation\b|\bjunction\b|\bcircle\b|\broad\b|\bcolony\b|\bnagar\b|\blayout\b|\bphase\b|\bmarket\b|\bpark\b|\bmall\b/.test(titleLower)) {
    return 1.5;
  }

  return 5;
};

const normalizeSuggestion = (item: NominatimResult): LocationSuggestion | null => {
  const latitude = Number(item.lat);
  const longitude = Number(item.lon);
  const rawDisplayName = normalizeText(item.display_name);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !rawDisplayName) return null;
  if (rawDisplayName.length > MAX_DISPLAY_NAME_LENGTH || looksLikeCoordinates(rawDisplayName)) return null;

  const parts = splitDisplayName(rawDisplayName);
  if (!parts.length) return null;

  const title = cleanTitle(parts[0]);
  if (!title || title.length < 2 || looksLikeCoordinates(title)) return null;

  const subtitle = buildSubtitle(parts, title);
  const displayName = `${title}${subtitle ? `, ${subtitle}` : ''}`;
  const className = normalizeText(item.class) || 'unknown';
  const typeName = normalizeText(item.type) || 'unknown';

  return {
    displayName,
    title,
    subtitle,
    latitude,
    longitude,
    placeId: String(item.place_id || `${latitude},${longitude}`),
    placeType: `${className}:${typeName}`,
  };
};

const rankSuggestion = (suggestion: LocationSuggestion) => {
  const [className = 'unknown', typeName = 'unknown'] = (suggestion.placeType || 'unknown:unknown').split(':');
  const titleLower = suggestion.title.toLowerCase();
  const classType = `${className.toLowerCase()}:${typeName.toLowerCase()}`;

  if (/metro|railway_station|train_station|subway_entrance|station/.test(classType) || /\bmetro\b|\bstation\b/.test(titleLower)) return 0;
  if (/landmark|monument|tourism|attraction|museum|mall|market|park/.test(classType) || /\blandmark\b|\bmall\b|\bmarket\b|\bpark\b/.test(titleLower)) return 1;
  if (/suburb|neighbourhood|neighborhood|quarter|city_district|locality/.test(classType) || /\bcolony\b|\bnagar\b|\blayout\b|\bphase\b/.test(titleLower)) return 2;
  if (/road|street|pedestrian|route|highway|junction|roundabout|avenue/.test(classType) || /\broad\b|\bstreet\b|\bjunction\b|\bcircle\b/.test(titleLower)) return 3;
  if (/amenity|place:town|place:village|place:hamlet/.test(classType)) return 4;
  if (/shop|office|building/.test(classType)) return 6;
  if (/house|yes/.test(typeName.toLowerCase())) return 7;
  return 5;
};

const normalizeAndRankResults = (items: NominatimResult[]) => items
  .map((item): LocationSuggestion | null => normalizeSuggestion(item))
  .filter((item): item is LocationSuggestion => !!item)
  .sort((a, b) => {
    const aPriority = rankSuggestion(a);
    const bPriority = rankSuggestion(b);

    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.title.length !== b.title.length) return a.title.length - b.title.length;
    return a.displayName.localeCompare(b.displayName);
  });

const fetchSearchResultsForQuery = async (query: string) => {
  const response = await fetchJsonWithRetry(buildSearchUrl(query), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Share-It-RideApp/1.0 (Hyderabad ride booking app)',
    },
  });

  const json = await response.json();
  if (!Array.isArray(json)) return [];
  return json as NominatimResult[];
};

export const searchHyderabadLocationsDetailed = async (input: string): Promise<SearchResponse> => {
  const trimmed = normalizeQuery(input);
  if (trimmed.length < 2 || trimmed.toLowerCase() === 'current location') {
    return { results: [], source: 'network', error: 'empty', query: trimmed };
  }

  const cacheKey = trimmed.toLowerCase();
  const cachedResults = await getCachedSearchResults(cacheKey);
  if (cachedResults?.length) {
    return { results: cachedResults, source: 'cache', query: trimmed };
  }

  const existingRequest = inFlightSearches.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = (async () => {
    let sawNetworkFailure = false;
    const fallbackQueries = buildFallbackQueries(trimmed);

    for (const query of fallbackQueries) {
      try {
        const rawResults = await fetchSearchResultsForQuery(query);
        const rankedResults = normalizeAndRankResults(rawResults).slice(0, 5);

        if (rankedResults.length) {
          await setCachedSearchResults(cacheKey, rankedResults);
          return { results: rankedResults, source: 'network', query, error: undefined };
        }
      } catch {
        sawNetworkFailure = true;
      }
    }

    return {
      results: [],
      source: 'network',
      query: trimmed,
      error: sawNetworkFailure ? 'network' : 'empty',
    };
  })();

  inFlightSearches.set(cacheKey, request);

  try {
    return await request;
  } finally {
    inFlightSearches.delete(cacheKey);
  }
};

export const searchHyderabadLocations = async (input: string): Promise<LocationSuggestion[]> => {
  const result = await searchHyderabadLocationsDetailed(input);
  return result.results;
};
