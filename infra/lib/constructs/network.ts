import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import { DevConfig } from "../config/types";

export interface NetworkConstructProps {
  config: DevConfig["network"];
}

/**
 * NOTE:
 * We deliberately keep subnet cidrMask fixed at /24 to avoid replacing subnets
 * in an existing dev stack. Changing subnet CIDR allocations is a destructive change.
 */
export class NetworkConstruct extends Construct {
  readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: NetworkConstructProps) {
    super(scope, id);

    this.vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr(props.config.cidr),
      maxAzs: props.config.maxAzs,
      natGateways: props.config.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "db", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }
      ]
    });
  }
}
