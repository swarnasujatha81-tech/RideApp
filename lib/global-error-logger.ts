import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

const LOG_KEY = 'shareit_last_runtime_error';

function serializeError(error: unknown, isFatal?: boolean) {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    message: err.message,
    stack: err.stack || '',
    isFatal: !!isFatal,
    platform: Platform.OS,
    at: new Date().toISOString(),
  };
}

async function persistRuntimeError(error: unknown, isFatal?: boolean) {
  try {
    await AsyncStorage.setItem(LOG_KEY, JSON.stringify(serializeError(error, isFatal)));
  } catch {
    // Avoid recursive failures while logging a crash.
  }
}

export function installGlobalErrorLogger() {
  const errorUtils = (globalThis as any).ErrorUtils as
    | {
        getGlobalHandler?: () => (error: unknown, isFatal?: boolean) => void;
        setGlobalHandler?: (handler: (error: unknown, isFatal?: boolean) => void) => void;
      }
    | undefined;
  const previousHandler = errorUtils?.getGlobalHandler?.();

  errorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    const payload = serializeError(error, isFatal);
    console.error('[global-error]', payload);
    void persistRuntimeError(error, isFatal);
    previousHandler?.(error, isFatal);
  });

  const rejectionTarget = globalThis as typeof globalThis & {
    addEventListener?: (event: string, handler: (event: any) => void) => void;
  };

  rejectionTarget.addEventListener?.('unhandledrejection', (event) => {
    const reason = event?.reason ?? event;
    console.error('[unhandled-rejection]', reason);
    void persistRuntimeError(reason, false);
  });
}
