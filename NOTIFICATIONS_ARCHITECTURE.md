# RideApp Notifications - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     YOUR RIDEAPP SCREENS                         │
│  (Home, Booking, Ride Details, Chat, History, Driver Mode)      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ├── Ride Status Changes
                           │   ├── Driver Accepts
                           │   ├── Driver Cancels
                           │   ├── User Cancels
                           │   └── Ride Ends
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│              NOTIFICATION SERVICE                                 │
│         (lib/notification-service.ts)                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Triggers:                                                 │   │
│  │ • sendDriverAcceptedNotification()                       │   │
│  │ • sendRideEndedNotification()                            │   │
│  │ • sendDriverCancelledNotification()                      │   │
│  │ • sendUserCancelledNotification()                        │   │
│  │ • sendCustomNotification()                               │   │
│  │ • scheduleDailyPromoNotifications()                      │   │
│  └─────────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ├── Uses Expo Notifications API
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│            EXPO NOTIFICATIONS SYSTEM                              │
│  • Handles local notifications                                   │
│  • Manages notification permissions                              │
│  • Sends to device notification center                           │
│  • Plays sounds                                                  │
│  • Updates app badge                                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│          USER DEVICE NOTIFICATION CENTER                          │
│  • Notification displayed to user                                │
│  • Sound played                                                  │
│  • Badge updated                                                 │
│  • User can tap to navigate back to app                         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Notification Flow Timeline

### Scenario 1: Driver Accepts Ride
```
1. User books a ride
   ↓
2. Driver clicks "Accept" button
   ↓
3. Firestore updated: status = 'accepted'
   ↓
4. YOUR CODE calls:
   NotificationService.sendDriverAcceptedNotification(...)
   ↓
5. Notification created with:
   ✅ Driver name and vehicle plate
   ✅ Sound enabled
   ✅ Badge updated
   ✅ Ride ID in data
   ↓
6. User receives: "✅ Driver Accepted! [Name] ([Plate]) has accepted..."
```

### Scenario 2: Ride Completes
```
1. Driver completes all pickups/dropoffs
   ↓
2. Ride marked as complete in Firestore
   ↓
3. addRideHistoryEntry() called
   ↓
4. YOUR CODE calls:
   NotificationService.sendRideEndedNotification(fare, type, id)
   ↓
5. Notification created with:
   ✅ Final fare amount
   ✅ Ride type
   ✅ Timestamp
   ↓
6. User receives: "🏁 Ride Completed! Fare: ₹299.50. Thank you!"
```

### Scenario 3: Promotional (Every 35 Hours)
```
1. App starts/initializes
   ↓
2. useNotifications() hook runs
   ↓
3. NotificationService.initialize() called
   ↓
4. Checks AsyncStorage for last notification time
   ↓
5. If 35+ hours since last notification:
   ↓
6. Random promo message selected
   ↓
7. Notification scheduled
   ↓
8. Time saved to AsyncStorage
   ↓
9. User receives: "🚨 Emergency? Book the bike to go!..."
```

---

## Data Flow: 5 Integration Points

```
app/(tabs)/index.tsx
├─ Line ~3310: After setCurrentRide(acceptedRide)
│  └─> NotificationService.sendDriverAcceptedNotification()
│
├─ Line ~3375: In cancelRide(), driver cancels branch
│  └─> NotificationService.sendDriverCancelledNotification()
│
├─ Line ~3450: In cancelRide(), user cancels branch
│  └─> NotificationService.sendUserCancelledNotification()
│
├─ Line ~3754: After addRideHistoryEntry() - ShareAuto completed
│  └─> NotificationService.sendRideEndedNotification()
│
└─ Line ~4954: After addRideHistoryEntry() - Other rides completed
   └─> NotificationService.sendRideEndedNotification()
```

---

## Component Relationships

```
app/_layout.tsx (Root Layout)
├─ Initializes: useNotifications() hook
│
app/(tabs)/index.tsx (Main Ride Screen)
├─ Imports: NotificationService
├─ Calls: sendDriverAcceptedNotification()
├─ Calls: sendDriverCancelledNotification()
├─ Calls: sendUserCancelledNotification()
└─ Calls: sendRideEndedNotification()

lib/notification-service.ts (Core Service)
├─ Handles: All notification types
├─ Manages: 35-hour scheduling
├─ Uses: Expo Notifications API
└─ Stores: Timestamp in AsyncStorage

hooks/use-notifications.ts (Hook)
├─ Auto-initializes: Notification service
├─ Sets up: Response listeners
└─ Handles: Permission requests
```

---

## Notification State Management

```
Local Storage (AsyncStorage):
└─ lastPromoNotificationTime
   ├─ Stores: Timestamp of last promo notification
   ├─ Used: To calculate next 35-hour window
   └─ Updated: Every time promo notif is sent

Notification Data Payload:
├─ type: 'driver_accepted' | 'ride_ended' | 'promotional' | etc.
├─ rideId: The ride ID (for navigation)
├─ timestamp: ISO string when created
└─ Additional: Context-specific data
```

---

## Permission & Initialization Flow

```
App Launch
   │
   ├─> RootLayout initializes
   │
   ├─> RootNavigator component mounts
   │
   ├─> useNotifications() hook runs
   │   └─> NotificationService.initialize()
   │       ├─> Requests permission
   │       ├─> If granted:
   │       │   └─> scheduleDailyPromoNotifications()
   │       │       ├─> Checks AsyncStorage
   │       │       ├─> Calculates time since last
   │       │       └─> Schedules next notification
   │       └─> Sets up response listener
   │
   └─> App ready to receive ride events
```

---

## Message Format

### Driver Accepted Notification
```
Title:   ✅ Driver Accepted!
Body:    John Doe (TS-12345) has accepted your ride and is on the way.
Sound:   ✅ Enabled
Badge:   ✅ Updated (+1)
Data:    {
           type: 'driver_accepted',
           rideId: 'ride-123',
           timestamp: '2026-05-09T...'
         }
```

### Ride Ended Notification
```
Title:   🏁 Ride Completed!
Body:    Your Bike ride has ended. Total fare: ₹299.50. Thank you for riding with us!
Sound:   ✅ Enabled
Badge:   ✅ Updated (+1)
Data:    {
           type: 'ride_ended',
           rideId: 'ride-123',
           timestamp: '2026-05-09T...'
         }
```

### Driver Cancelled Notification
```
Title:   ❌ Ride Cancelled
Body:    Your driver has cancelled the ride. Please book another ride.
Sound:   ✅ Enabled
Badge:   ✅ Updated (+1)
Data:    {
           type: 'driver_cancelled',
           rideId: 'ride-123',
           timestamp: '2026-05-09T...'
         }
```

### Promotional Notification
```
Title:   🚨 Emergency?
Body:    Book the bike to go! Fast, reliable, and affordable rides at your fingertips.
Sound:   ✅ Enabled
Badge:   ✅ Updated (+1)
Data:    {
           type: 'promotional',
           timestamp: '2026-05-09T...'
         }
```

---

## Error Handling Strategy

```
Each notification method:
├─ Try to send notification
├─ Catch errors
├─ Log to console (non-blocking)
└─ Continue app execution (resilient)

Permission errors:
├─ Caught gracefully
├─ App continues to work
└─ User can enable manually in Settings

AsyncStorage errors:
├─ Doesn't block notifications
├─ Promo scheduling may be suboptimal
└─ But app keeps running
```

---

## Performance Considerations

✅ **Async Operations**: All notification calls are async, don't block UI  
✅ **Lazy Initialization**: Service initializes only when needed  
✅ **Efficient Scheduling**: 35-hour interval prevents notification spam  
✅ **Local Only**: No server roundtrips for local notifications  
✅ **Memory Safe**: Proper cleanup of event listeners  

---

## Testing Strategy

```
Unit Level:
└─ Test NotificationService methods independently

Integration Level:
├─ Test with actual Firestore updates
├─ Verify notifications trigger at right times
└─ Check AsyncStorage persistence

Device Level:
├─ Verify notifications appear on device
├─ Check sound and badge
└─ Test 35-hour scheduling manually
```

---

## Future Enhancements (Optional)

```
Could add:
├─ Firebase Cloud Messaging (FCM) for server-sent notifications
├─ Deep linking from notifications to specific screens
├─ Notification history/archive
├─ Custom notification sounds per type
├─ Notification preferences (enable/disable per type)
├─ Analytics on notification engagement
└─ A/B testing of promo messages
```

---

This architecture ensures:
- ✅ Reliable notification delivery
- ✅ Minimal performance impact
- ✅ Graceful error handling
- ✅ Easy to extend
- ✅ Production-ready implementation
