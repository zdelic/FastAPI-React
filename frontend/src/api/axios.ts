import axios, {
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

// 1) Base URL – kombinacija .env + hostname
const fromEnv = process.env.REACT_APP_API_URL;

let baseURL: string;

if (fromEnv && fromEnv.trim().length > 0) {
  // ako ikad proradi .env / .env.local, koristi to
  baseURL = fromEnv.trim();
} else {
  const host = window.location.hostname;

  // SERVER – otvaraš app kao http://172.20.1.25:3000
  if (host === "172.20.1.25") {
    baseURL = "http://172.20.1.25:8001";
  }
  // LOKALNI DEV – http://localhost:3000 ili http://127.0.0.1:3000
  else if (host === "localhost" || host === "127.0.0.1") {
    baseURL = "http://127.0.0.1:8001";
  }
  // fallback, za svaki slučaj
  else {
    baseURL = "http://127.0.0.1:8000";
  }
}

console.log("REACT API URL =", fromEnv);
console.log("axios baseURL =", baseURL);

// 2) Loader bridge (App.tsx ga puni i smije ga “gasiti”)
export const loaderBridge: {
  show?: () => void;
  hide?: () => void;
} = {};

// 3) Axios instanca
const api = axios.create({
  baseURL,
  withCredentials: false,
  timeout: 15000,
});

// 4) Proširenje configa s hideLoader flagom
declare module "axios" {
  export interface AxiosRequestConfig {
    hideLoader?: boolean;
  }
  export interface InternalAxiosRequestConfig {
    hideLoader?: boolean;
  }
}

// 5) Request interceptor (token + opcionalni loader)
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem("token");
    if (token) {
      const headers = (config.headers ??= new AxiosHeaders());
      headers.set("Authorization", `Bearer ${token}`);
    }
    if (!config.hideLoader) {
      try {
        loaderBridge.show?.();
      } catch {}
    }
    return config;
  },
  (error) => {
    try {
      loaderBridge.hide?.();
    } catch {}
    return Promise.reject(error);
  }
);

// 6) Response interceptor (zatvori loader + 401)
api.interceptors.response.use(
  (response) => {
    if (!response.config.hideLoader) {
      try {
        loaderBridge.hide?.();
      } catch {}
    }
    return response;
  },
  (error) => {
    try {
      if (!error?.config?.hideLoader) loaderBridge.hide?.();
    } catch {}
    if (axios.isCancel(error) || error.code === "ERR_CANCELED") {
      return Promise.reject(error);
    }
    if (error.response && error.response.status === 401) {
      localStorage.removeItem("token");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// 7) Helper za apsolutni URL (slike itd.)
export const absoluteUrl = (path: string) => {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  return `${baseURL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
};

export { baseURL };
export default api;
