declare module 'firebase/auth' {
  export * from '@firebase/auth';
  export function getReactNativePersistence(storage: unknown): import('@firebase/auth').Persistence;
}
