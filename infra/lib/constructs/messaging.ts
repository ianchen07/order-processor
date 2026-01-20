import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import * as sqs from "aws-cdk-lib/aws-sqs";

export class MessagingConstruct extends Construct {
  readonly queue: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const dlq = new sqs.Queue(this, "Dlq", {
      retentionPeriod: cdk.Duration.days(14)
    });

    this.queue = new sqs.Queue(this, "Queue", {
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: { queue: dlq, maxReceiveCount: 5 }
    });
  }
}