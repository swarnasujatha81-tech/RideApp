import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

// Configure notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const LAST_PROMO_NOTIFICATION_KEY = 'lastPromoNotificationTime';
const NOTIFICATION_SCHEDULED_KEY = 'notificationScheduled';
const PROMO_INTERVAL_MS = 35 * 60 * 60 * 1000; // 35 hours in milliseconds

// Promotional messages
const PROMO_MESSAGES = [
  {
    title: '🚨 Emergency?',
    body: 'Book a bike to go! Fast, reliable, and affordable rides at your fingertips.',
  },
  {
    title: '🏃 Don\'t wait for buses!',
    body: 'Use bike and go fast! Get where you need to be in no time.',
  },
  {
    title: '⚡ Quick & Easy Rides',
    body: 'Book now and reach your destination faster than ever!',
  },
  {
    title: '🚴 Time to Ride',
    body: 'Skip the traffic! Book a bike ride and enjoy the freedom of speed.',
  },
  {
    title: '💨 Ready to Go?',
    body: 'Your next ride is just one tap away. Book now and save time!',
  },
  {
    title: '🎯 Need a Ride?',
    body: 'Bikes are waiting for you! Book instantly and ride with confidence.',
  },
];

export class NotificationService {
  /**
   * Initialize notification service and request permissions
   */
  static async initialize(): Promise<boolean> {
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      const granted = status === 'granted';
      
      if (granted) {
        await this.scheduleDailyPromoNotifications();
      }
      
      return granted;
    } catch (error) {
      console.error('Error initializing notifications:', error);
      return false;
    }
  }

  /**
   * Schedule periodic promotional notifications every 35 hours
   */
  static async scheduleDailyPromoNotifications(): Promise<void> {
    try {
      const lastNotificationTime = await AsyncStorage.getItem(LAST_PROMO_NOTIFICATION_KEY);
      const now = Date.now();

      if (lastNotificationTime) {
        const lastTime = parseInt(lastNotificationTime, 10);
        const timeSinceLastNotification = now - lastTime;

        // If less than 35 hours have passed, wait for the remaining time
        if (timeSinceLastNotification < PROMO_INTERVAL_MS) {
          const remainingTime = PROMO_INTERVAL_MS - timeSinceLastNotification;
          await Notifications.scheduleNotificationAsync({
            content: this.getRandomPromoNotification(),
            trigger: { seconds: Math.ceil(remainingTime / 1000) },
          });
          return;
        }
      }

      // Schedule first notification immediately or after 35 hours
      await Notifications.scheduleNotificationAsync({
        content: this.getRandomPromoNotification(),
        trigger: { seconds: 1 }, // Send immediately on first setup
      });

      await AsyncStorage.setItem(LAST_PROMO_NOTIFICATION_KEY, now.toString());
    } catch (error) {
      console.error('Error scheduling promo notifications:', error);
    }
  }

  /**
   * Get a random promotional message
   */
  private static getRandomPromoNotification() {
    const randomIndex = Math.floor(Math.random() * PROMO_MESSAGES.length);
    const message = PROMO_MESSAGES[randomIndex];

    return {
      title: message.title,
      body: message.body,
      sound: true,
      badge: 1,
      data: {
        type: 'promotional',
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Send notification when driver accepts ride
   */
  static async sendDriverAcceptedNotification(
    driverName: string,
    vehiclePlate: string,
    rideId: string
  ): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✅ Driver Accepted!',
          body: `${driverName} (${vehiclePlate}) has accepted your ride and is on the way.`,
          sound: true,
          badge: 1,
          data: {
            type: 'driver_accepted',
            rideId,
            timestamp: new Date().toISOString(),
          },
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending driver accepted notification:', error);
    }
  }

  /**
   * Send notification when ride ends
   */
  static async sendRideEndedNotification(
    fareAmount: number,
    rideType: string,
    rideId: string
  ): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🏁 Ride Completed!',
          body: `Your ${rideType} ride has ended. Total fare: ₹${fareAmount.toFixed(2)}. Thank you for riding with us!`,
          sound: true,
          badge: 1,
          data: {
            type: 'ride_ended',
            rideId,
            timestamp: new Date().toISOString(),
          },
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending ride ended notification:', error);
    }
  }

  /**
   * Send notification when ride is cancelled by driver
   */
  static async sendDriverCancelledNotification(rideId: string): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Ride Cancelled',
          body: 'Your driver has cancelled the ride. Please book another ride.',
          sound: true,
          badge: 1,
          data: {
            type: 'driver_cancelled',
            rideId,
            timestamp: new Date().toISOString(),
          },
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending driver cancelled notification:', error);
    }
  }

  /**
   * Send notification when ride is cancelled by user
   */
  static async sendUserCancelledNotification(rideId: string): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '❌ Ride Cancelled',
          body: 'You have cancelled the ride. Book another ride whenever you are ready.',
          sound: true,
          badge: 1,
          data: {
            type: 'user_cancelled',
            rideId,
            timestamp: new Date().toISOString(),
          },
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending user cancelled notification:', error);
    }
  }

  /**
   * Send custom notification
   */
  static async sendCustomNotification(
    title: string,
    body: string,
    data?: Record<string, string>
  ): Promise<void> {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
          badge: 1,
          data: {
            ...data,
            timestamp: new Date().toISOString(),
          },
        },
        trigger: null, // Send immediately
      });
    } catch (error) {
      console.error('Error sending custom notification:', error);
    }
  }

  /**
   * Clear all scheduled notifications
   */
  static async clearAllNotifications(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync();
    } catch (error) {
      console.error('Error clearing notifications:', error);
    }
  }

  /**
   * Get all scheduled notifications
   */
  static async getScheduledNotifications() {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('Error getting scheduled notifications:', error);
      return [];
    }
  }

  /**
   * Set up notification response listener
   */
  static setupNotificationListener(
    callback: (notification: Notifications.Notification) => void
  ): () => void {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      callback(response.notification);
    });

    return () => subscription.remove();
  }
}
