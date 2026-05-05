/**
 * Session Management & Device Tracking
 * Ensures only one device can be logged in at a time
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

export interface UserSession {
  userId: string;
  deviceId: string;
  deviceName?: string;
  loginTime: number;
  lastActivityTime: number;
}

/**
 * Generate a unique device identifier
 * Uses a persisted random ID per install so we do not depend on native device modules.
 */
export async function generateDeviceId(): Promise<string> {
  try {
    const storedId = await AsyncStorage.getItem('app_device_id');
    if (storedId) {
      return storedId;
    }

    const deviceId = `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await AsyncStorage.setItem('app_device_id', deviceId);
    return deviceId;
  } catch (error) {
    console.error('Error generating device ID:', error);
    return `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Get current session from AsyncStorage
 */
export async function getCurrentSession(): Promise<UserSession | null> {
  try {
    const sessionStr = await AsyncStorage.getItem('app_current_session');
    if (!sessionStr) return null;
    return JSON.parse(sessionStr) as UserSession;
  } catch (error) {
    console.error('Error reading session:', error);
    return null;
  }
}

/**
 * Save session to AsyncStorage
 */
export async function saveSession(session: UserSession): Promise<void> {
  try {
    await AsyncStorage.setItem('app_current_session', JSON.stringify(session));
  } catch (error) {
    console.error('Error saving session:', error);
  }
}

/**
 * Clear current session
 */
export async function clearSession(): Promise<void> {
  try {
    await AsyncStorage.removeItem('app_current_session');
  } catch (error) {
    console.error('Error clearing session:', error);
  }
}

/**
 * Update last activity time
 */
export async function updateSessionActivity(): Promise<void> {
  try {
    const session = await getCurrentSession();
    if (session) {
      session.lastActivityTime = Date.now();
      await saveSession(session);
    }
  } catch (error) {
    console.error('Error updating session activity:', error);
  }
}

/**
 * Check if session is still valid
 * Returns false if session doesn't match current device
 */
export async function isSessionValid(storedDeviceId: string): Promise<boolean> {
  try {
    const currentDeviceId = await generateDeviceId();
    return storedDeviceId === currentDeviceId;
  } catch (error) {
    console.error('Error checking session validity:', error);
    return false;
  }
}

/**
 * Get device name for display purposes
 */
export function getDeviceName(): string {
  return 'This device';
}
