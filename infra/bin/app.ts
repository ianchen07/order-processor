#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OrderProcessingStack } from "../lib/stack";
import { devConfig } from "../lib/config/dev";

const app = new cdk.App();

const envName = app.node.tryGetContext("env") ?? "dev";
const stackName = `order-processing-${envName}`;

// For this demo we only define dev config.
new OrderProcessingStack(app, stackName, { config: devConfig });
