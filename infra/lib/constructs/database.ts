import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";

export class DatabaseConstruct extends Construct {
  readonly secret: secrets.Secret;
  readonly db: rds.DatabaseInstance;

  constructor(scope: Construct, id: string, vpc: ec2.Vpc, ecsSg: ec2.SecurityGroup) {
    super(scope, id);

    this.secret = new secrets.Secret(this, "DbSecret", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "app" }),
        generateStringKey: "password"
      }
    });

    const dbSg = new ec2.SecurityGroup(this, "DbSg", { vpc });
    dbSg.addIngressRule(ecsSg, ec2.Port.tcp(5432), "ECS to Postgres");

    const paramGroup = new rds.ParameterGroup(this, "PgParams", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      parameters: {
        // demo-level example; you can add more as needed
        log_min_duration_statement: "500"
      }
    });

    this.db = new rds.DatabaseInstance(this, "Postgres", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_15 }),
      credentials: rds.Credentials.fromSecret(this.secret),
      securityGroups: [dbSg],
      parameterGroup: paramGroup,
      publiclyAccessible: false,
      
      databaseName: "appdb",
      // demo-friendly
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      backupRetention: cdk.Duration.days(7)
    });
  }
}