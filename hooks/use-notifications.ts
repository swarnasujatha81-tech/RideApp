import { NotificationService } from '@/lib/notification-service';
import { useEffect } from 'react';

/**
 * Hook to initialize notification service and set up listeners
 */
export function useNotifications() {
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initializeNotifications = async () => {
      try {
        // Initialize the notification service
        const granted = await NotificationService.initialize();

        if (granted) {
          // Set up listener for notification responses
          unsubscribe = NotificationService.setupNotificationListener((notification) => {
            const data = notification.request.content.data;
            handleNotificationResponse(data);
          });
        }
      } catch (error) {
        console.error('Error initializing notifications:', error);
      }
    };

    initializeNotifications();

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);
}

/**
 * Handle notification taps
 */
function handleNotificationResponse(data: Record<string, string>) {
  const type = data?.type;

  switch (type) {
    case 'driver_accepted':
      // Navigate to ride details or ride home screen
      console.log('Driver accepted notification tapped:', data.rideId);
      // You can add navigation logic here if needed
      break;

    case 'ride_ended':
      // Navigate to ride history or rating screen
      console.log('Ride ended notification tapped:', data.rideId);
      break;

    case 'driver_cancelled':
    case 'user_cancelled':
      // Navigate to home screen or booking
      console.log('Ride cancelled notification tapped:', data.rideId);
      break;

    case 'promotional':
      // Navigate to home or booking screen
      console.log('Promotional notification tapped');
      break;

    default:
      console.log('Notification tapped:', data);
  }
}
