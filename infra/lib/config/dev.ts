import { DevConfig } from "./types";

/**
 * Minimal env config for dev.
 * Only parameterizes a small set of values for this tech test demo.
 */
export const devConfig: DevConfig = {
  network: {
    cidr: "10.20.0.0/16",
    maxAzs: 2,
    natGateways: 2
  },

  ecs: {
    desiredCount: 2
  }
};
