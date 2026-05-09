# Notification Integration Guide

This guide shows you exactly where and how to add notification calls to your RideApp to track ride events.

## Location 1: Driver Accepts Ride (Line ~3287)

**File:** `/workspaces/RideApp/app/(tabs)/index.tsx`

**Current Code (around line 3287):**
```typescript
const updatePayload: any = {
  status: 'accepted', driverId: auth.currentUser?.uid,
  driverPhone: driverPhone, driverName: driverName, vehiclePlate: vehiclePlate,
  acceptedAtMs,
  ...
};

const acceptedRide = {
  ...ride,
  status: 'accepted' as const,
  driverId: auth.currentUser?.uid || ride.driverId || null,
  driverPhone,
  driverName,
  vehiclePlate,
  acceptedAtMs,
  driverPhotoUrl: driverPhotoUrl || undefined,
};
setCurrentRide(acceptedRide);
```

**Add This After Setting Current Ride:**
```typescript
// Import at the top
import { NotificationService } from '@/lib/notification-service';

// After setCurrentRide(acceptedRide);
await NotificationService.sendDriverAcceptedNotification(
  driverName,
  vehiclePlate,
  ride.id || ''
);
```

---

## Location 2: Driver Cancels Ride (Line ~3365)

**File:** `/workspaces/RideApp/app/(tabs)/index.tsx`

**Current Code (inside cancelRide function, when isDriver is true):**
```typescript
await updateRideSafely(id, {
  status: 'waiting',
  cancelledBy: deleteField(),
  driverId: null,
  driverPhone: '',
  driverName: '',
  vehiclePlate: '',
  driverLocation: deleteField()
}, () => {
  setCurrentRide(null);
});

setCurrentRide(null);
```

**Add This:**
```typescript
// After setCurrentRide(null);
await NotificationService.sendDriverCancelledNotification(id);
```

---

## Location 3: User Cancels Ride (Line ~3450)

**File:** `/workspaces/RideApp/app/(tabs)/index.tsx`

**Current Code (inside cancelRide function, when isDriver is false):**
```typescript
await deleteDoc(doc(db, 'rides', id));
setUserBookedRide(null);
setDestCoords(null);
setShowDetails(false);
setShowTipModal(false);
```

**Add This:**
```typescript
// Before deleteDoc
await NotificationService.sendUserCancelledNotification(id);

// Then the existing code continues
await deleteDoc(doc(db, 'rides', id));
```

---

## Location 4: Ride Completed (Line ~3753)

**File:** `/workspaces/RideApp/app/(tabs)/index.tsx`

**Current Code:**
```typescript
await addRideHistoryEntry(currentRide, 'completed');
setDriverStats(prev => ({ ...prev, completed: prev.completed + 1, earnings: prev.earnings + totalShareFare }));
await deleteDoc(doc(db, 'rides', currentRide.id));
setCurrentRide(null);
```

**Add This:**
```typescript
// After addRideHistoryEntry
await NotificationService.sendRideEndedNotification(
  currentRide.fare,
  currentRide.type,
  currentRide.id || ''
);
```

---

## Location 5: Another Ride Completed (Line ~4954)

**File:** `/workspaces/RideApp/app/(tabs)/index.tsx`

**Look for:**
```typescript
await addRideHistoryEntry(currentRide, 'completed', undefined, {
  finalFare?: number;
  driverPayout?: number;
  appFeeToApp?: number;
});
```

**Add After:**
```typescript
const finalFare = settlement?.finalFare ?? currentRide.fare;
await NotificationService.sendRideEndedNotification(
  finalFare,
  currentRide.type,
  currentRide.id || ''
);
```

---

## Quick Integration Steps

1. **Import the notification service** at the top of `/workspaces/RideApp/app/(tabs)/index.tsx`:
   ```typescript
   import { NotificationService } from '@/lib/notification-service';
   ```

2. **Add notification calls** at each of the 5 locations mentioned above

3. **Install the package** (already added to package.json):
   ```bash
   npm install expo-notifications
   ```

4. **The hook is already initialized** in your root layout (`app/_layout.tsx`), so notifications will automatically start when the app loads

---

## Features Now Active

✅ Promotional notifications every 35 hours  
✅ Driver accepted notification  
✅ Ride ended notification  
✅ Driver cancelled notification  
✅ User cancelled notification  

---

## Notification Data Structure

Each notification includes:
- **Title:** Clear, emoji-based header
- **Body:** Detailed message
- **Sound:** Enabled
- **Badge:** Updated
- **Data:** Includes type and ride ID for handling taps

---

## Testing Notifications

To test notifications locally:

```typescript
// In your component, add a test button:
<Button 
  title="Test Promo Notification" 
  onPress={() => NotificationService.sendCustomNotification(
    '🚨 Emergency?',
    'Book a bike to go! Fast, reliable, and affordable rides at your fingertips.'
  )}
/>
```

---

## Notes

- Notifications are configured to show alerts, play sound, and update badge count
- The notification service handles errors gracefully
- Periodic promotional notifications are automatically scheduled every 35 hours
- Notification permissions are requested on app initialization
- All notification types are tracked with timestamp data for analytics
