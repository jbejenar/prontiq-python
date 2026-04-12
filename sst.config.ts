/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Naming convention:
 * SST generates AWS names as: {app}-{stage}-{componentName}{ResourceType}-{hash}
 *
 * Component names are chosen so generated AWS names read naturally:
 *   "PqKeys"     → prontiq-dev-PqKeysTable-xxx           (DynamoDB)
 *   "PqApi"      → prontiq-dev-PqApiApi-xxx               (API Gateway)
 *   "PqPortal"   → prontiq-dev-PqPortalAssetsBucket-xxx   (Dashboard S3/CloudFront)
 *
 * App name: "prontiq" (short, clean AWS console names)
 */

// External OpenSearch domain (not managed by SST).
// Domain access policy must allow account-wide access:
//   Principal: {"AWS": "arn:aws:iam::493712557159:root"}
// Identity-based policies on each Lambda/Fargate role scope the actual es:ESHttp* actions.
const OPENSEARCH_DOMAIN_ARN = "arn:aws:es:ap-southeast-2:493712557159:domain/flat-white";
const OPENSEARCH_ENDPOINT_DEFAULT =
  "https://search-flat-white-lrsdymw7a4u56cu2lrvxa3ggve.ap-southeast-2.es.amazonaws.com";
const DATA_BUCKET_NAME = "flat-white-address-493712557159-ap-southeast-2-an";
const DATA_BUCKET_ARN = `arn:aws:s3:::${DATA_BUCKET_NAME}`;
const AWS_ACCOUNT_ID = "493712557159";
const AWS_REGION = "ap-southeast-2";

export default $config({
  app(input) {
    return {
      name: "prontiq",
      removal: input?.stage === "prod" ? "retain" : "remove",
      protect: ["prod"].includes(input?.stage ?? ""),
      home: "aws",
      providers: {
        aws: {
          region: AWS_REGION,
        },
      },
    };
  },
  async run() {
    // ═══════════════════════════════════════════════════════════════════════
    // EXISTING INFRASTRUCTURE
    // ═══════════════════════════════════════════════════════════════════════

    // -- DynamoDB: API key verification + usage counters --
    const keyTable = new sst.aws.Dynamo("PqKeys", {
      fields: {
        apiKey: "string",
      },
      primaryIndex: { hashKey: "apiKey" },
    });

    // -- API: Hono on Lambda (single handler for all routes) --
    const api = new sst.aws.ApiGatewayV2("PqApi", {
      cors: {
        allowOrigins: ["*"],
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["X-Api-Key", "Content-Type"],
      },
    });

    api.route("$default", {
      handler: "packages/api/src/index.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [keyTable],
      permissions: [
        {
          actions: ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpHead"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT,
        API_KEY_TABLE_NAME: keyTable.name,
      },
    });

    // -- Dashboard: Next.js developer portal --
    const portal = new sst.aws.Nextjs("PqPortal", {
      path: "packages/dashboard",
      environment: {
        NEXT_PUBLIC_API_URL: api.url,
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
        CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "",
        CLERK_WEBHOOK_SECRET: process.env.CLERK_WEBHOOK_SECRET ?? "",
      },
    });

    // ═══════════════════════════════════════════════════════════════════════
    // INGESTION PIPELINE
    // ═══════════════════════════════════════════════════════════════════════

    // -- SNS: Ingestion failure alerts --
    const ingestAlerts = new aws.sns.Topic("PqIngestAlerts");

    // -- Ingestion Lambdas (Step Function tasks) --
    const opensearchEndpoint =
      process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT;

    const readManifestFn = new sst.aws.Function("PqIngestReadManifest", {
      handler: "packages/ingestion/src/read-manifest.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "2 minutes",
      permissions: [
        { actions: ["s3:GetObject", "s3:HeadObject"], resources: [`${DATA_BUCKET_ARN}/*`] },
        { actions: ["es:ESHttpGet"], resources: [`${OPENSEARCH_DOMAIN_ARN}/*`] },
      ],
      environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
    });

    const createIndexFn = new sst.aws.Function("PqIngestCreateIndex", {
      handler: "packages/ingestion/src/create-index.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "60 seconds",
      permissions: [
        { actions: ["s3:GetObject"], resources: [`${DATA_BUCKET_ARN}/*`] },
        {
          actions: ["es:ESHttpPut", "es:ESHttpGet", "es:ESHttpHead", "es:ESHttpDelete"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
    });

    const healthCheckFn = new sst.aws.Function("PqIngestHealthCheck", {
      handler: "packages/ingestion/src/health-check.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "5 minutes",
      permissions: [
        {
          actions: ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpPut"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
    });

    const aliasSwapFn = new sst.aws.Function("PqIngestAliasSwap", {
      handler: "packages/ingestion/src/alias-swap.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "60 seconds",
      permissions: [
        {
          actions: ["es:ESHttpPost", "es:ESHttpGet"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
    });

    const onFailureFn = new sst.aws.Function("PqIngestOnFailure", {
      handler: "packages/ingestion/src/on-failure.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "60 seconds",
      permissions: [
        {
          actions: ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpDelete"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
      ],
      environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
    });

    // -- ECS: Fargate bulk ingest --
    const ingestCluster = new aws.ecs.Cluster("PqIngestCluster");

    const ingestRepo = new aws.ecr.Repository("PqIngestBulkRepo", {
      name: "prontiq-ingest-bulk",
      forceDelete: true,
    });

    const defaultVpc = aws.ec2.getVpcOutput({ default: true });
    const publicSubnets = aws.ec2.getSubnetsOutput({
      filters: [
        { name: "vpc-id", values: [defaultVpc.id] },
        { name: "map-public-ip-on-launch", values: ["true"] },
      ],
    });

    const bulkTaskExecutionRole = new aws.iam.Role("PqIngestBulkExecRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
      managedPolicyArns: [
        "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
      ],
    });

    // The managed ECS execution policy has CreateLogStream + PutLogEvents
    // but NOT CreateLogGroup. The task definition uses awslogs-create-group=true,
    // so the execution role needs this additional permission.
    new aws.iam.RolePolicy("PqIngestBulkExecLogPolicy", {
      role: bulkTaskExecutionRole.name,
      policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "logs:CreateLogGroup",
            Resource: "*",
          },
        ],
      }),
    });

    const bulkTaskRole = new aws.iam.Role("PqIngestBulkTaskRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "ecs-tasks.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });

    new aws.iam.RolePolicy("PqIngestBulkTaskPolicy", {
      role: bulkTaskRole.name,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:GetObject"],
            Resource: [`${DATA_BUCKET_ARN}/*`],
          },
          {
            Effect: "Allow",
            Action: ["es:ESHttpPost"],
            Resource: [`${OPENSEARCH_DOMAIN_ARN}/*`],
          },
          {
            Effect: "Allow",
            Action: ["states:SendTaskSuccess", "states:SendTaskFailure"],
            Resource: ["*"],
          },
        ],
      }),
    });

    const bulkTaskDefinition = new aws.ecs.TaskDefinition("PqIngestBulk", {
      family: "prontiq-ingest-bulk",
      requiresCompatibilities: ["FARGATE"],
      networkMode: "awsvpc",
      cpu: "1024",
      memory: "2048",
      executionRoleArn: bulkTaskExecutionRole.arn,
      taskRoleArn: bulkTaskRole.arn,
      containerDefinitions: $jsonStringify([
        {
          name: "bulk-ingest",
          image: $interpolate`${ingestRepo.repositoryUrl}:latest`,
          essential: true,
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": "/ecs/prontiq-ingest-bulk",
              "awslogs-region": AWS_REGION,
              "awslogs-stream-prefix": "bulk",
              "awslogs-create-group": "true",
            },
          },
        },
      ]),
    });

    // -- Step Function: Ingestion pipeline orchestrator --
    const sfnRole = new aws.iam.Role("PqIngestSfnRole", {
      assumeRolePolicy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: { Service: "states.amazonaws.com" },
            Action: "sts:AssumeRole",
          },
        ],
      }),
    });

    new aws.iam.RolePolicy("PqIngestSfnPolicy", {
      role: sfnRole.name,
      policy: $jsonStringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "lambda:InvokeFunction",
            Resource: [
              readManifestFn.arn,
              createIndexFn.arn,
              healthCheckFn.arn,
              aliasSwapFn.arn,
              onFailureFn.arn,
            ],
          },
          {
            Effect: "Allow",
            Action: "ecs:RunTask",
            Resource: [bulkTaskDefinition.arn],
          },
          {
            Effect: "Allow",
            Action: "iam:PassRole",
            Resource: [bulkTaskExecutionRole.arn, bulkTaskRole.arn],
          },
          {
            Effect: "Allow",
            Action: "sns:Publish",
            Resource: [ingestAlerts.arn],
          },
        ],
      }),
    });

    const stateMachine = new aws.sfn.StateMachine("PqIngest", {
      roleArn: sfnRole.arn,
      definition: $resolve([
        readManifestFn.arn,
        createIndexFn.arn,
        healthCheckFn.arn,
        aliasSwapFn.arn,
        onFailureFn.arn,
        ingestCluster.arn,
        bulkTaskDefinition.arn,
        publicSubnets.ids,
        ingestAlerts.arn,
      ]).apply(
        ([
          readManifestArn,
          createIndexArn,
          healthCheckArn,
          aliasSwapArn,
          onFailureArn,
          clusterArn,
          taskDefArn,
          subnetIds,
          alertsArn,
        ]) =>
          JSON.stringify({
            StartAt: "ReadManifest",
            States: {
              ReadManifest: {
                Type: "Task",
                Resource: readManifestArn,
                Next: "CreateIndex",
                Catch: [
                  {
                    ErrorEquals: ["States.ALL"],
                    ResultPath: "$.error",
                    Next: "OnFailure",
                  },
                ],
              },
              CreateIndex: {
                Type: "Task",
                Resource: createIndexArn,
                Next: "BulkIngest",
                Catch: [
                  {
                    ErrorEquals: ["States.ALL"],
                    ResultPath: "$.error",
                    Next: "OnFailure",
                  },
                ],
              },
              BulkIngest: {
                Type: "Task",
                Resource: "arn:aws:states:::ecs:runTask.waitForTaskToken",
                Parameters: {
                  Cluster: clusterArn,
                  TaskDefinition: taskDefArn,
                  LaunchType: "FARGATE",
                  NetworkConfiguration: {
                    AwsvpcConfiguration: {
                      Subnets: subnetIds,
                      AssignPublicIp: "ENABLED",
                    },
                  },
                  Overrides: {
                    ContainerOverrides: [
                      {
                        Name: "bulk-ingest",
                        Environment: [
                          { Name: "BUCKET", "Value.$": "$.bucket" },
                          { Name: "MANIFEST_KEY", "Value.$": "$.key" },
                          { Name: "INDEX_NAME", "Value.$": "$.indexName" },
                          {
                            Name: "TASK_TOKEN",
                            "Value.$": "$$.Task.Token",
                          },
                          {
                            Name: "OPENSEARCH_ENDPOINT",
                            Value: opensearchEndpoint,
                          },
                          { Name: "AWS_REGION", Value: AWS_REGION },
                        ],
                      },
                    ],
                  },
                },
                ResultPath: "$.bulkResult",
                Next: "HealthCheck",
                Catch: [
                  {
                    ErrorEquals: ["States.ALL"],
                    ResultPath: "$.error",
                    Next: "OnFailure",
                  },
                ],
                TimeoutSeconds: 7200,
              },
              HealthCheck: {
                Type: "Task",
                Resource: healthCheckArn,
                Next: "AliasSwap",
                Catch: [
                  {
                    ErrorEquals: ["States.ALL"],
                    ResultPath: "$.error",
                    Next: "OnFailure",
                  },
                ],
              },
              AliasSwap: {
                Type: "Task",
                Resource: aliasSwapArn,
                Next: "Success",
                Catch: [
                  {
                    ErrorEquals: ["States.ALL"],
                    ResultPath: "$.error",
                    Next: "OnFailure",
                  },
                ],
              },
              Success: { Type: "Succeed" },
              OnFailure: {
                Type: "Task",
                Resource: onFailureArn,
                Next: "AlertFailure",
              },
              AlertFailure: {
                Type: "Task",
                Resource: "arn:aws:states:::sns:publish",
                Parameters: {
                  TopicArn: alertsArn,
                  "Message.$":
                    "States.Format('Ingestion failed for {}/{}', $.product, $.version)",
                },
                Next: "Fail",
              },
              Fail: { Type: "Fail" },
            },
          }),
      ),
    });

    // -- Router Lambda: EventBridge → manifest routing → Step Function --
    const routerFn = new sst.aws.Function("PqIngestRouter", {
      handler: "packages/ingestion/src/router.handler",
      architecture: "arm64",
      runtime: "nodejs20.x",
      memory: "512 MB",
      timeout: "60 seconds",
      permissions: [
        { actions: ["s3:GetObject"], resources: [`${DATA_BUCKET_ARN}/*`] },
        {
          actions: ["states:StartExecution", "states:ListExecutions"],
          resources: [stateMachine.arn],
        },
      ],
      environment: {
        STATE_MACHINE_ARN: stateMachine.arn,
      },
    });

    // -- EventBridge: S3 manifest upload → Router Lambda --
    // EventBridge array values are OR, not AND. Using prefix-only filter here;
    // the Router Lambda validates .json suffix before processing.
    const ingestRule = new aws.cloudwatch.EventRule("PqIngestTrigger", {
      eventPattern: JSON.stringify({
        source: ["aws.s3"],
        "detail-type": ["Object Created"],
        detail: {
          bucket: { name: [DATA_BUCKET_NAME] },
          object: { key: [{ prefix: "manifests/" }] },
        },
      }),
    });

    new aws.cloudwatch.EventTarget("PqIngestTriggerTarget", {
      rule: ingestRule.name,
      arn: routerFn.arn,
    });

    new aws.lambda.Permission("PqIngestTriggerPermission", {
      action: "lambda:InvokeFunction",
      function: routerFn.name,
      principal: "events.amazonaws.com",
      sourceArn: ingestRule.arn,
    });

    // -- Scheduled cleanup: delete expired indices every 6 hours --
    new sst.aws.Cron("PqIngestCleanup", {
      schedule: "rate(6 hours)",
      function: {
        handler: "packages/ingestion/src/cleanup.handler",
        architecture: "arm64",
        runtime: "nodejs20.x",
        memory: "512 MB",
        timeout: "2 minutes",
        permissions: [
          {
            actions: ["es:ESHttpGet", "es:ESHttpDelete"],
            resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
          },
          { actions: ["sns:Publish"], resources: [ingestAlerts.arn] },
        ],
        environment: { OPENSEARCH_ENDPOINT: opensearchEndpoint },
      },
    });

    return {
      api: api.url,
      portal: portal.url,
      stateMachine: stateMachine.arn,
      ingestAlerts: ingestAlerts.arn,
    };
  },
});
