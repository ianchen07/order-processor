export interface DevConfig {
  network: {
    cidr: string;
    maxAzs: number;
    natGateways: number;
  };

  ecs: {
    desiredCount: number;
  };
}
