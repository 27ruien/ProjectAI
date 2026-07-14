"use client";

import { useCallback, useSyncExternalStore } from "react";

const localStorageChangeEvent = "projectai:local-storage-change";
const subscribeToNothing = () => () => undefined;
const clientReadySnapshot = () => true;
const serverReadySnapshot = () => false;
const serverStorageSnapshot = () => null;

export function useClientSnapshotReady(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    clientReadySnapshot,
    serverReadySnapshot,
  );
}

export function useLocalStorageSnapshot(key: string): string | null {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === key) onStoreChange();
      };
      const onLocalChange = (event: Event) => {
        if ((event as CustomEvent<string>).detail === key) onStoreChange();
      };
      window.addEventListener("storage", onStorage);
      window.addEventListener(localStorageChangeEvent, onLocalChange);
      return () => {
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(localStorageChangeEvent, onLocalChange);
      };
    },
    [key],
  );
  const getSnapshot = useCallback(() => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }, [key]);

  return useSyncExternalStore(subscribe, getSnapshot, serverStorageSnapshot);
}

export function setLocalStorageSnapshot(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    window.dispatchEvent(new CustomEvent(localStorageChangeEvent, { detail: key }));
    return true;
  } catch {
    return false;
  }
}
