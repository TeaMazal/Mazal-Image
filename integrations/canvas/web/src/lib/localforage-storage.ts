import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

localforage.config({
    name: "souhub-canvas-" + window.__SOUHUB_CANVAS__.owner,
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(window.__SOUHUB_CANVAS__.owner + ":" + name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(window.__SOUHUB_CANVAS__.owner + ":" + name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(window.__SOUHUB_CANVAS__.owner + ":" + name);
        }
    },
};
