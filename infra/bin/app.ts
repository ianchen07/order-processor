#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OrderProcessingStack } from "../lib/stack";

const app = new cdk.App();

const envName = app.node.tryGetContext("env") ?? "dev"; // demo 默认 dev
const stackName = `order-processing-${envName}`;

new OrderProcessingStack(app, stackName);