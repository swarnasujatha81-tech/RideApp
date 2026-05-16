# Scalable Firestore Architecture

This design keeps operational data separated by purpose so admin screens can query small, indexed collections instead of scanning large mixed documents.

## 1. Firestore Schema

### `drivers/{driverId}`

Driver profile and live admin status.

```ts
{
  name: string,
  mobile: string,
  email: string,
  vehicleType: 'bike' | 'auto' | 'car',
  vehicleNumber: string,
  profilePhoto: string,
  rcDocument: string,
  licenseDocument: string,
  isOnline: boolean,
  status: 'pending' | 'approved' | 'rejected' | 'blocked' | 'inactive',
  rating: number,
  totalRides: number,
  earningsToday: number,
  earningsTotal: number,
  createdAt: Timestamp,
  lastActiveAt: Timestamp,
  location: GeoPoint
}
```

### `driverApplications/{applicationId}`

Only for onboarding review.

```ts
{
  driverId: string,
  submittedData: {
    name: string,
    mobile: string,
    email: string,
    vehicleType: 'bike' | 'auto' | 'car',
    vehicleNumber: string,
    profilePhoto: string,
    rcDocument: string,
    licenseDocument: string
  },
  status: 'pending' | 'approved' | 'rejected',
  reviewNotes: string,
  submittedAt: Timestamp,
  reviewedAt: Timestamp | null
}
```

Approval flow: admin updates `driverApplications/{id}.status = approved`, then updates `drivers/{driverId}.status = approved`.

### `rides/{rideId}`

```ts
{
  passengerId: string,
  driverId: string | null,
  pickupLocation: GeoPoint,
  dropLocation: GeoPoint,
  distanceKm: number,
  fare: number,
  status: 'requested' | 'accepted' | 'ongoing' | 'completed' | 'cancelled',
  createdAt: Timestamp,
  startedAt: Timestamp | null,
  completedAt: Timestamp | null,
  paymentStatus: 'pending' | 'paid' | 'failed' | 'refunded',
  vehicleType: 'bike' | 'auto' | 'car' | 'shareAuto' | 'parcel'
}
```

### `driverReports/{reportId}`

```ts
{
  reportId: string,
  driverId: string,
  passengerId: string | null,
  rideId: string | null,
  reason: 'rude_driver' | 'overcharge' | 'unsafe' | 'fake_trip' | 'other',
  description: string,
  evidenceImages: string[],
  status: 'open' | 'investigating' | 'resolved' | 'rejected',
  createdAt: Timestamp,
  resolvedAt: Timestamp | null,
  adminNotes: string
}
```

### `blockedDrivers/{blockId}`

Audit log. Never delete these records.

```ts
{
  driverId: string,
  reason: string,
  blockedBy: string,
  blockedAt: Timestamp,
  unblockAt: Timestamp | null,
  status: 'active_block' | 'lifted'
}
```

### `analytics/dailyStats_{yyyyMMdd}`

```ts
{
  totalRides: number,
  activeDrivers: number,
  activePassengers: number,
  totalRevenue: number,
  cancellations: number,
  date: string
}
```

## 2. Suggested Indexes

Single-field indexes should stay enabled for:

- `drivers.status`
- `drivers.isOnline`
- `drivers.lastActiveAt`
- `drivers.createdAt`
- `driverApplications.status`
- `driverApplications.submittedAt`
- `rides.status`
- `rides.driverId`
- `rides.passengerId`
- `rides.createdAt`
- `driverReports.driverId`
- `driverReports.status`
- `driverReports.createdAt`
- `blockedDrivers.driverId`
- `blockedDrivers.status`
- `blockedDrivers.blockedAt`

Compound indexes:

```txt
drivers: status ASC, createdAt DESC
drivers: status ASC, lastActiveAt DESC
drivers: isOnline ASC, lastActiveAt DESC
driverApplications: status ASC, submittedAt DESC
rides: status ASC, createdAt DESC
rides: passengerId ASC, createdAt DESC
rides: driverId ASC, createdAt DESC
rides: driverId ASC, status ASC, createdAt DESC
driverReports: status ASC, createdAt DESC
driverReports: driverId ASC, createdAt DESC
blockedDrivers: driverId ASC, blockedAt DESC
```

## 3. Admin Query Examples

Use pagination everywhere:

```ts
const pageSize = 25;

const pendingApplicationsQuery = query(
  collection(db, 'driverApplications'),
  where('status', '==', 'pending'),
  orderBy('submittedAt', 'desc'),
  limit(pageSize)
);

const activeDriversQuery = query(
  collection(db, 'drivers'),
  where('status', '==', 'approved'),
  orderBy('lastActiveAt', 'desc'),
  limit(pageSize)
);

const blockedDriversQuery = query(
  collection(db, 'drivers'),
  where('status', '==', 'blocked'),
  orderBy('lastActiveAt', 'desc'),
  limit(pageSize)
);

const offlineDriversQuery = query(
  collection(db, 'drivers'),
  where('isOnline', '==', false),
  orderBy('lastActiveAt', 'desc'),
  limit(pageSize)
);

const openReportsQuery = query(
  collection(db, 'driverReports'),
  where('status', '==', 'open'),
  orderBy('createdAt', 'desc'),
  limit(pageSize)
);
```

Counters should use Firestore aggregation queries or precomputed `adminStats/current`:

```ts
const pendingDriversCount = await getCountFromServer(query(
  collection(db, 'driverApplications'),
  where('status', '==', 'pending')
));
```

## 4. Sample Security Rules

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() {
      return request.auth != null;
    }

    function isAdmin() {
      return signedIn() &&
        get(/databases/$(database)/documents/admins/$(request.auth.uid)).data.role == 'admin';
    }

    match /drivers/{driverId} {
      allow read: if isAdmin() || (signedIn() && request.auth.uid == driverId);
      allow create: if signedIn() && request.auth.uid == driverId;
      allow update: if isAdmin() ||
        (
          signedIn() &&
          request.auth.uid == driverId &&
          !('status' in request.resource.data.diff(resource.data).changedKeys()) &&
          !('earningsTotal' in request.resource.data.diff(resource.data).changedKeys()) &&
          !('rating' in request.resource.data.diff(resource.data).changedKeys())
        );
      allow delete: if false;
    }

    match /driverApplications/{applicationId} {
      allow read: if isAdmin() || (signedIn() && resource.data.driverId == request.auth.uid);
      allow create: if signedIn() && request.resource.data.driverId == request.auth.uid;
      allow update: if isAdmin();
      allow delete: if false;
    }

    match /rides/{rideId} {
      allow read: if isAdmin() ||
        (signedIn() && resource.data.passengerId == request.auth.uid) ||
        (signedIn() && resource.data.driverId == request.auth.uid);
      allow create: if signedIn() && request.resource.data.passengerId == request.auth.uid;
      allow update: if isAdmin() ||
        (signedIn() && resource.data.passengerId == request.auth.uid) ||
        (signedIn() && resource.data.driverId == request.auth.uid);
      allow delete: if false;
    }

    match /driverReports/{reportId} {
      allow read: if isAdmin() || (signedIn() && resource.data.passengerId == request.auth.uid);
      allow create: if signedIn();
      allow update: if isAdmin();
      allow delete: if false;
    }

    match /blockedDrivers/{blockId} {
      allow read, write: if isAdmin();
    }

    match /analytics/{docId} {
      allow read: if isAdmin();
      allow write: if false;
    }
  }
}
```

## 5. Admin Panel Structure

Driver management tabs:

- Pending Applications: `driverApplications.status == pending`
- Active Drivers: `drivers.status == approved`
- Blocked Drivers: `drivers.status == blocked`
- Offline Drivers: `drivers.isOnline == false`

Each card should read only the fields needed for the list: photo, name, vehicle type, vehicle number, status, last active time, and action buttons.

Report management tabs:

- Open Reports: `driverReports.status == open`
- Under Investigation: `driverReports.status == investigating`
- Resolved Reports: `driverReports.status == resolved`

Admin actions should be server-side Cloud Functions when possible: approve driver, reject application, block driver, lift block, resolve report.

## 6. Performance Best Practices

- Never load all drivers or all rides into the admin dashboard.
- Use `limit()` and `startAfter()` for every list.
- Use aggregation counts for counters, or maintain `adminStats/current` with Cloud Functions.
- Keep documents small. Store images in Firebase Storage and save URLs in Firestore.
- Use `drivers/{driverId}.status` for fast filtering instead of scanning verification booleans.
- Use `blockedDrivers` as append-only audit history.
- Store high-volume location pings in a separate lightweight collection if needed, for example `driverLocations/{driverId}`.
- For geo queries at large scale, add geohash fields and query by geohash bounds.

## 7. Migration Plan

1. Add new fields to existing `drivers` documents: `status`, `isOnline`, `lastActiveAt`, `earningsToday`, `earningsTotal`.
2. Backfill `status`:
   - `banned == true` or `isBlocked == true` -> `blocked`
   - `isVerified == true` -> `approved`
   - otherwise -> `pending`
3. Create `driverApplications` from existing verification data for drivers still pending.
4. Normalize ride documents by adding `pickupLocation`, `dropLocation`, `distanceKm`, `paymentStatus`, and `vehicleType`.
5. Move existing report-like data into `driverReports`.
6. Create one `blockedDrivers` audit document for each currently blocked driver.
7. Deploy indexes before switching admin queries.
8. Deploy rules in staged mode, test with admin, driver, and passenger accounts, then enforce.
