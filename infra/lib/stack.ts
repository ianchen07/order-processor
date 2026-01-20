import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import { NetworkConstruct } from "./constructs/network";
import { MessagingConstruct } from "./constructs/messaging";
import { DatabaseConstruct } from "./constructs/database";
import { ComputeConstruct } from "./constructs/compute";

export class OrderProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    const network = new NetworkConstruct(this, "Network");
    const messaging = new MessagingConstruct(this, "Messaging");

    const repo = new ecr.Repository(this, "Repo", {
      repositoryName: "order-processor"
    });

    // one SG for ECS tasks
    const ecsSg = new ec2.SecurityGroup(this, "EcsSg", { vpc: network.vpc });

    const database = new DatabaseConstruct(this, "Database", network.vpc, ecsSg);

    const imageTag = this.node.tryGetContext("imageTag") ?? "latest";

    const compute = new ComputeConstruct(this, "Compute", {
      vpc: network.vpc,
      ecsSg,
      queue: messaging.queue,
      dbSecret: database.secret,
      dbHost: database.db.dbInstanceEndpointAddress,
      imageRepo: repo,
      imageTag
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