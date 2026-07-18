import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.dexcargo.ops",
  appName: "DEXCARGO Ops",
  webDir: "dist",
  server: { androidScheme: "https" },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#070A12",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#070A12",
    },
  },
};

export default config;