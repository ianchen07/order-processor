import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { NetworkConstruct } from "./constructs/network";
import { MessagingConstruct } from "./constructs/messaging";
import { DatabaseConstruct } from "./constructs/database";
import { ComputeConstruct } from "./constructs/compute";
import { DevConfig } from "./config/types";

export interface OrderProcessingStackProps extends cdk.StackProps {
  config: DevConfig;
}

export class OrderProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OrderProcessingStackProps) {
    super(scope, id, props);

    const network = new NetworkConstruct(this, "Network", { config: props.config.network });
    const messaging = new MessagingConstruct(this, "Messaging");

    const repo = new ecr.Repository(this, "Repo", {
      repositoryName: "order-processor"
    });

    // One SG for ECS tasks (passed to DB for 5432 ingress allow)
    const ecsSg = new ec2.SecurityGroup(this, "EcsSg", { vpc: network.vpc });

    const database = new DatabaseConstruct(this, "Database", network.vpc, ecsSg);

    const imageTag = this.node.tryGetContext("imageTag") ?? "latest";

    const desiredCountCtx = this.node.tryGetContext("desiredCount");
    const desiredCount =
      desiredCountCtx !== undefined && desiredCountCtx !== null
        ? Number(desiredCountCtx)
        : props.config.ecs.desiredCount;

    const compute = new ComputeConstruct(this, "Compute", {
      vpc: network.vpc,
      ecsSg,
      queue: messaging.queue,
      dbSecret: database.secret,
      dbHost: database.db.dbInstanceEndpointAddress,
      imageRepo: repo,
      imageTag,
      desiredCount
    });

    new cdk.CfnOutput(this, "RepoUri", { value: repo.repositoryUri });
    new cdk.CfnOutput(this, "ClusterName", { value: compute.cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: compute.service.serviceName });

    const appSubnetIds = network.vpc
      .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
      .subnetIds
      .join(",");
    new cdk.CfnOutput(this, "AppSubnetIds", { value: appSubnetIds });
    new cdk.CfnOutput(this, "EcsSecurityGroupId", { value: ecsSg.securityGroupId });
  }
}
