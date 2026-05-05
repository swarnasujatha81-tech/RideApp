import { calcDist } from './geo';
import type { Coord, PoolPassenger, ShareAutoMatchResult, ShareAutoPool } from './types';

export const getClusterRadiusKm = (points: Coord[]) => {
  if (!points.length) return Number.POSITIVE_INFINITY;
  const center = {
    latitude: points.reduce((sum, p) => sum + p.latitude, 0) / points.length,
    longitude: points.reduce((sum, p) => sum + p.longitude, 0) / points.length,
  };
  return Math.max(...points.map((p) => calcDist(center, p)));
};

export const toLocalPointKm = (origin: Coord, point: Coord) => {
  const kLat = 111;
  const kLon = 111 * Math.cos((origin.latitude * Math.PI) / 180);
  return {
    x: (point.longitude - origin.longitude) * kLon,
    y: (point.latitude - origin.latitude) * kLat,
  };
};

export const pointToSegmentDistanceKm = (point: Coord, start: Coord, end: Coord) => {
  const origin = start;
  const p = toLocalPointKm(origin, point);
  const a = toLocalPointKm(origin, start);
  const b = toLocalPointKm(origin, end);
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const apx = p.x - a.x;
  const apy = p.y - a.y;
  const ab2 = abx * abx + aby * aby;
  if (ab2 === 0) return Math.hypot(apx, apy);
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2));
  const projX = a.x + t * abx;
  const projY = a.y + t * aby;
  return Math.hypot(p.x - projX, p.y - projY);
};

export const toPoolPassenger = (pool: ShareAutoPool): PoolPassenger => ({
  id: pool.passengerId,
  name: pool.passengerName,
  phone: pool.passengerPhone,
  pickup: pool.pickup,
  drop: pool.drop,
  pickupAddr: pool.pickupAddr,
  dropAddr: pool.dropAddr,
});

export const calcSegmentEtaMinutes = (km: number) => Math.max(2, Math.round((km / 22) * 60));

export const isAWayGroup = (allPassengers: PoolPassenger[]) => {
  const pickupRadius = getClusterRadiusKm(allPassengers.map((p) => p.pickup));
  const dropRadius = getClusterRadiusKm(allPassengers.map((p) => p.drop));
  return pickupRadius <= 2 && dropRadius <= 4;
};

export const getLongestTripPassenger = (allPassengers: PoolPassenger[]) => {
  return allPassengers.reduce((best, current) => {
    const bestDist = calcDist(best.pickup, best.drop);
    const currDist = calcDist(current.pickup, current.drop);
    return currDist > bestDist ? current : best;
  }, allPassengers[0]);
};

export const isBWayGroup = (allPassengers: PoolPassenger[]) => {
  if (allPassengers.length < 2) return false;
  const longest = getLongestTripPassenger(allPassengers);
  const others = allPassengers.filter((p) => p.id !== longest.id);

  const allWithinDeviation = others.every((p) => {
    const pickupDeviation = pointToSegmentDistanceKm(p.pickup, longest.pickup, longest.drop);
    const dropDeviation = pointToSegmentDistanceKm(p.drop, longest.pickup, longest.drop);
    return pickupDeviation <= 2 && dropDeviation <= 3;
  });

  if (!allWithinDeviation) return false;

  const etaCandidates = others.map((p) => calcSegmentEtaMinutes(calcDist(longest.pickup, p.pickup)));
  const maxEta = Math.max(...etaCandidates);
  return maxEta <= 30;
};

export const getBWayScore = (allPassengers: PoolPassenger[]) => {
  const longest = getLongestTripPassenger(allPassengers);
  const others = allPassengers.filter((p) => p.id !== longest.id);
  return others.reduce((sum, p) => {
    const pickupDeviation = pointToSegmentDistanceKm(p.pickup, longest.pickup, longest.drop);
    const dropDeviation = pointToSegmentDistanceKm(p.drop, longest.pickup, longest.drop);
    const etaPenalty = calcSegmentEtaMinutes(calcDist(longest.pickup, p.pickup)) > 15 ? 3 : 0;
    return sum + pickupDeviation + dropDeviation + etaPenalty;
  }, 0);
};

export const findShareAutoMatch = (selfPassenger: PoolPassenger, candidates: PoolPassenger[]): ShareAutoMatchResult | null => {
  const getBestMatchForWay = (way: 'A' | 'B'): ShareAutoMatchResult | null => {
    const fullMatches: ShareAutoMatchResult[] = [];

    for (let i = 0; i < candidates.length; i += 1) {
      for (let j = i + 1; j < candidates.length; j += 1) {
        const group = [selfPassenger, candidates[i], candidates[j]];
        if (way === 'A' && isAWayGroup(group)) {
          const score = getClusterRadiusKm(group.map((p) => p.pickup)) + getClusterRadiusKm(group.map((p) => p.drop));
          fullMatches.push({ way: 'A', passengers: [candidates[i], candidates[j]], score });
        }
        if (way === 'B' && isBWayGroup(group)) {
          fullMatches.push({ way: 'B', passengers: [candidates[i], candidates[j]], score: getBWayScore(group) });
        }
      }
    }

    if (fullMatches.length > 0) {
      return fullMatches.sort((x, y) => x.score - y.score)[0];
    }

    if (way === 'A') {
      const aCandidates = candidates
        .filter((passenger) => isAWayGroup([selfPassenger, passenger]))
        .sort((x, y) => calcDist(selfPassenger.pickup, x.pickup) - calcDist(selfPassenger.pickup, y.pickup));

      if (aCandidates.length > 0) {
        return { way: 'A', passengers: [aCandidates[0]], score: calcDist(selfPassenger.pickup, aCandidates[0].pickup) };
      }
    } else {
      const bCandidates = candidates
        .filter((passenger) => isBWayGroup([selfPassenger, passenger]))
        .sort((x, y) => {
          const xEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, x.pickup));
          const yEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, y.pickup));
          return xEta - yEta;
        });

      if (bCandidates.length > 0) {
        return { way: 'B', passengers: [bCandidates[0]], score: calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, bCandidates[0].pickup)) };
      }
    }

    return null;
  };

  const chooseBetterMatch = (current: ShareAutoMatchResult | null, next: ShareAutoMatchResult | null) => {
    if (!current) return next;
    if (!next) return current;

    const currentCount = current.passengers.length;
    const nextCount = next.passengers.length;

    if (currentCount !== nextCount) {
      return nextCount > currentCount ? next : current;
    }

    if (current.way !== next.way) {
      return current.way === 'A' ? current : next;
    }

    return next.score < current.score ? next : current;
  };

  return chooseBetterMatch(getBestMatchForWay('A'), getBestMatchForWay('B'));
};

export const findPartialShareAuto = (selfPassenger: PoolPassenger, candidates: PoolPassenger[]) => {
  const aCandidates = candidates
    .filter((passenger) => isAWayGroup([selfPassenger, passenger]))
    .sort((x, y) => calcDist(selfPassenger.pickup, x.pickup) - calcDist(selfPassenger.pickup, y.pickup));

  if (aCandidates.length > 0) return { way: 'A' as const, passenger: aCandidates[0] };

  const bCandidates = candidates
    .filter((passenger) => isBWayGroup([selfPassenger, passenger]))
    .sort((x, y) => {
      const xEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, x.pickup));
      const yEta = calcSegmentEtaMinutes(calcDist(selfPassenger.pickup, y.pickup));
      return xEta - yEta;
    });

  if (bCandidates.length > 0) return { way: 'B' as const, passenger: bCandidates[0] };
  return null;
};

