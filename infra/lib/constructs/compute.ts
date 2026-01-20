import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as ecr from "aws-cdk-lib/aws-ecr";

export interface ComputeConstructProps {
  vpc: ec2.Vpc;

  /**
   * One shared SG for ECS tasks (also used by DB to allow 5432 ingress).
   * Create it at stack level and pass in here.
   */
  ecsSg: ec2.SecurityGroup;

  queue: sqs.Queue;
  dbSecret: secrets.Secret;

  /** RDS endpoint address, e.g. <xxx>.ap-southeast-2.rds.amazonaws.com */
  dbHost: string;

  /** ECR repository holding the app image */
  imageRepo: ecr.IRepository;

  /** Image tag to deploy (driven by CI), e.g. 7-char commit SHA */
  imageTag: string;

  /** Desired number of tasks (default 2 in stack) */
  desiredCount?: number;
}

export class ComputeConstruct extends Construct {
  readonly sg: ec2.SecurityGroup;
  readonly cluster: ecs.Cluster;
  readonly taskDef: ecs.FargateTaskDefinition;
  readonly service: ecs.FargateService;
  readonly alb: elbv2.ApplicationLoadBalancer;

  constructor(scope: Construct, id: string, props: ComputeConstructProps) {
    super(scope, id);

    this.sg = props.ecsSg;

    /**
     * ALB SG (public): allow inbound 80 from internet
     */
    const albSg = new ec2.SecurityGroup(this, "AlbSg", { vpc: props.vpc });
    albSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "HTTP from internet");
    // Optional IPv6:
    // albSg.addIngressRule(ec2.Peer.anyIpv6(), ec2.Port.tcp(80), "HTTP from internet (IPv6)");

    /**
     * ECS tasks SG (private): allow inbound 8080 ONLY from ALB SG
     * (tasks are not directly reachable from the internet)
     */
    this.sg.addIngressRule(albSg, ec2.Port.tcp(8080), "ALB to ECS /health on 8080");

    this.cluster = new ecs.Cluster(this, "Cluster", { vpc: props.vpc });

    this.taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {
      // Keep defaults; you can set cpu/memory explicitly if you want.
      // cpu: 256,
      // memoryLimitMiB: 512,
    });

    // IAM: least privilege
    props.queue.grantConsumeMessages(this.taskDef.taskRole);
    props.dbSecret.grantRead(this.taskDef.taskRole);

    const logGroup = new logs.LogGroup(this, "AppLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK
    });

    const container = this.taskDef.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromEcrRepository(props.imageRepo, props.imageTag),
      logging: ecs.LogDriver.awsLogs({ logGroup, streamPrefix: "app" }),
      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        SQS_QUEUE_URL: props.queue.queueUrl,

        // DB connection (user/db name are demo defaults; password is injected from Secrets Manager)
        DB_HOST: props.dbHost,
        DB_USER: "app",
        DB_NAME: "appdb",
        DB_PORT: "5432",
        
        DB_SSL: "true",

        // Health endpoint port (worker listens here for ALB target group health checks)
        HEALTH_PORT: "8080"
      },
      secrets: {
        DB_PASSWORD: ecs.Secret.fromSecretsManager(props.dbSecret, "password")
      }
    });

    container.addPortMappings({ containerPort: 8080 });

    this.service = new ecs.FargateService(this, "Service", {
      cluster: this.cluster,
      taskDefinition: this.taskDef,
      desiredCount: props.desiredCount ?? 2,
      securityGroups: [this.sg],

      // Place tasks in private app subnets (with NAT egress)
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }
    });

    /**
     * Public ALB in public subnets
     */
    this.alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc: props.vpc,
      internetFacing: true,
      securityGroup: albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC }
    });

    const listener = this.alb.addListener("HttpListener", {
      port: 80,
      open: false // ingress is handled via albSg
    });

    listener.addTargets("EcsTargets", {
      port: 8080,
      targets: [this.service],
      healthCheck: {
        path: "/health",
        healthyHttpCodes: "200"
      }
    });

    // Useful outputs for CI/debug
    new cdk.CfnOutput(this, "AlbDnsName", { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, "ClusterName", { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, "ServiceName", { value: this.service.serviceName });
  }
}