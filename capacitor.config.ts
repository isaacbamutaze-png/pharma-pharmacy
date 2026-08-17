import { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.pharma.pharmacy",
  appName: "PHARMA",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;
