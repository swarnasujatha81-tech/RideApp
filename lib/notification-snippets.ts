/**
 * Notification integration snippets kept as strings so this file stays
 * TypeScript-safe while still serving as copy-paste documentation.
 */

export const notificationIntegrationGuide = {
  importStatement: "import { NotificationService } from '@/lib/notification-service';",
  driverAccepted: [
    "await NotificationService.sendDriverAcceptedNotification(",
    "  driverName,",
    "  vehiclePlate,",
    "  ride.id || ''",
    ");",
  ].join('\n'),
  driverCancelled: "await NotificationService.sendDriverCancelledNotification(id);",
  userCancelled: "await NotificationService.sendUserCancelledNotification(id);",
  shareAutoCompleted: [
    "await NotificationService.sendRideEndedNotification(",
    "  totalShareFare,",
    "  currentRide.type,",
    "  currentRide.id || ''",
    ");",
  ].join('\n'),
  regularRideCompleted: [
    "const finalFare = settlement?.finalFare ?? currentRide.fare;",
    "await NotificationService.sendRideEndedNotification(",
    "  finalFare,",
    "  currentRide.type,",
    "  currentRide.id || ''",
    ");",
  ].join('\n'),
  testButton: [
    "<Button",
    "  title=\"Test Notification\"",
    "  onPress={() => NotificationService.sendCustomNotification(",
    "    '🚨 Test',",
    "    'Notifications are working!'",
    "  )}",
    "/>",
  ].join('\n'),
};
