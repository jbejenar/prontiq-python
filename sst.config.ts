/// <reference path="./.sst/platform/config.d.ts" />

/**
 * Naming convention:
 * SST generates AWS names as: {app}-{stage}-{componentName}{ResourceType}-{hash}
 *
 * Component names are chosen so generated AWS names read naturally:
 *   "PqKeys"     → prontiq-dev-PqKeysTable-xxx           (DynamoDB)
 *   "PqApi"      → prontiq-dev-PqApiApi-xxx               (API Gateway)
 *
 * App name: "prontiq" (short, clean AWS console names)
 */

// External OpenSearch domain (not managed by SST).
// Domain access policy must allow account-wide access:
//   Principal: {"AWS": "arn:aws:iam::493712557159:root"}
// Identity-based policies on each Lambda/Fargate role scope the actual es:ESHttp* actions.
const OPENSEARCH_DOMAIN_ARN = "arn:aws:es:ap-southeast-2:493712557159:domain/flat-white";
const OPENSEARCH_DOMAIN_NAME = "flat-white";
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
    const pulumi = await import("@pulumi/pulumi");
    const { calculateOpenSearchLowFreeStorageThresholdMiB } = await import(
      "./packages/shared/src/observability.js"
    );

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

    const isProd = $app.stage === "prod";

    // -- DynamoDB: v2.2 auth/billing tables (P1B.04) --
    //
    // Additive to PqKeys above. Schemas mirror ARCHITECTURE.MD §5.5.1.
    // Not yet linked into the API Lambda — the hot-path cutover (hash-based
    // GetItem, REDIRECT fallback, usage writes) ships in P1B.04b. Declaring
    // the infra here so P1B.04b's migration script has a target.
    const authKeysName = isProd ? "prontiq-keys" : `prontiq-keys-${$app.stage}`;
    const authUsageName = isProd ? "prontiq-usage" : `prontiq-usage-${$app.stage}`;
    const auditTableName = isProd ? "prontiq-audit" : `prontiq-audit-${$app.stage}`;
    const suppressionsName = isProd
      ? "prontiq-ses-suppressions"
      : `prontiq-ses-suppressions-${$app.stage}`;

    const authKeysTable = new sst.aws.Dynamo("PqAuthKeys", {
      fields: {
        apiKeyHash: "string",
        orgId: "string",
      },
      primaryIndex: { hashKey: "apiKeyHash" },
      globalIndexes: {
        "orgId-index": { hashKey: "orgId" },
      },
      transform: { table: { name: authKeysName } },
    });

    const authUsageTable = new sst.aws.Dynamo("PqAuthUsage", {
      fields: {
        apiKeyHash: "string",
        scope: "string",
        newHash: "string",
      },
      primaryIndex: { hashKey: "apiKeyHash", rangeKey: "scope" },
      globalIndexes: {
        "newHash-redirect-index": { hashKey: "newHash", projection: "keys-only" },
      },
      ttl: "ttl",
      transform: { table: { name: authUsageName } },
    });

    const auditTable = new sst.aws.Dynamo("PqAuthAudit", {
      fields: {
        orgId: "string",
        "timestamp#eventId": "string",
      },
      primaryIndex: { hashKey: "orgId", rangeKey: "timestamp#eventId" },
      ttl: "ttl",
      transform: { table: { name: auditTableName } },
    });

    const suppressionsTable = new sst.aws.Dynamo("PqSesSuppressions", {
      fields: {
        email: "string",
      },
      primaryIndex: { hashKey: "email" },
      ttl: "ttl",
      transform: { table: { name: suppressionsName } },
    });

    const sesSenderDomain = "prontiq.dev";
    const sesConfigurationSetName = isProd
      ? "prontiq-transactional"
      : `prontiq-transactional-${$app.stage}`;
    const sesFeedbackTopic = new aws.sns.Topic("PqSesFeedbackTopic");
    if (isProd) {
      new aws.sesv2.EmailIdentity("PqTransactionalEmailIdentity", {
        emailIdentity: sesSenderDomain,
      });
    }
    const sesConfigurationSet = new aws.sesv2.ConfigurationSet("PqSesConfigurationSet", {
      configurationSetName: sesConfigurationSetName,
      sendingOptions: {
        sendingEnabled: true,
      },
    });
    new aws.sesv2.ConfigurationSetEventDestination("PqSesFeedbackDestination", {
      configurationSetName: sesConfigurationSet.configurationSetName,
      eventDestinationName: "ses-feedback-sns",
      eventDestination: {
        enabled: true,
        matchingEventTypes: ["BOUNCE", "COMPLAINT"],
        snsDestination: {
          topicArn: sesFeedbackTopic.arn,
        },
      },
    });

    function sharedEmailEnv() {
      return {
        KEYS_TABLE_NAME: authKeysTable.name,
        USAGE_TABLE_NAME: authUsageTable.name,
        SUPPRESSIONS_TABLE_NAME: suppressionsTable.name,
        WELCOME_EMAIL_FROM:
          process.env.WELCOME_EMAIL_FROM ?? "noreply@prontiq.dev",
        PRONTIQ_BILLING_URL:
          process.env.PRONTIQ_BILLING_URL ?? process.env.PRONTIQ_ACCOUNT_URL ?? "https://prontiq.dev/account",
        PRONTIQ_DOCS_URL: process.env.PRONTIQ_DOCS_URL ?? "https://docs.prontiq.dev",
        SES_CONFIGURATION_SET_NAME: sesConfigurationSet.configurationSetName,
      };
    }

    function sharedEmailSendResources() {
      const fromEmail = process.env.WELCOME_EMAIL_FROM ?? "noreply@prontiq.dev";
      return [
        `arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:identity/prontiq.dev`,
        `arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:identity/${fromEmail}`,
        pulumi.interpolate`arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:configuration-set/${sesConfigurationSet.configurationSetName}`,
      ];
    }

    const sesFeedbackFn = new sst.aws.Function("PqSesFeedback", {
      handler: "packages/control-plane/src/ses-feedback.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [suppressionsTable],
      environment: {
        SUPPRESSIONS_TABLE_NAME: suppressionsTable.name,
      },
    });

    new aws.sns.TopicSubscription("PqSesFeedbackSubscription", {
      topic: sesFeedbackTopic.arn,
      protocol: "lambda",
      endpoint: sesFeedbackFn.arn,
    });

    new aws.lambda.Permission("PqSesFeedbackSnsPermission", {
      action: "lambda:InvokeFunction",
      function: sesFeedbackFn.name,
      principal: "sns.amazonaws.com",
      sourceArn: sesFeedbackTopic.arn,
    });

    const quotaEmailWorkerFn = new sst.aws.Function("PqQuotaEmailWorker", {
      handler: "packages/control-plane/src/quota-email.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [authKeysTable, authUsageTable, suppressionsTable],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: sharedEmailSendResources(),
        },
      ],
      environment: sharedEmailEnv(),
    });

    // -- Required secrets (P1B.05) --
    //
    // Sourced from GitHub Environment secrets (Settings → Environments →
    // dev/prod → Environment secrets), exported by the deploy-{dev,prod}
    // workflows as `env: NAME: ${{ secrets.NAME }}`, read here as
    // process.env.NAME. Same pattern as the pre-existing WELCOME_EMAIL_FROM
    // / PRONTIQ_ACCOUNT_URL config — keeps secret management in one place.
    //
    // Earlier iteration of this PR used sst.Secret() (SSM-backed via
    // `sst secret set`). That fought with the GitHub-Environment pattern:
    // values landed in process.env at deploy time but the SST runtime
    // tried to resolve them from SSM, SecretMissingError. Aligned to a
    // single source of truth.
    //
    // TWO security/reliability properties enforced below:
    //
    //  1. Whitespace-trim before validation AND before wiring into the
    //     Lambda env. A pasted value with a trailing newline or all-
    //     whitespace value would otherwise pass the length check and
    //     ship an invalid secret to the Lambda — recreating the silent-
    //     deploy-broken-runtime failure mode this hotfix is supposed to
    //     prevent. `readGithubSecret` normalises once at the boundary.
    //
    //  2. $util.secret() wraps the values when passed to the Function
    //     environment block. Without this wrapper, plain string inputs
    //     to Pulumi `environment` get serialized as plaintext in
    //     deployment state, previews, and diffs — visible to anyone who
    //     can read the SST/Pulumi state backend. Wrapping marks them as
    //     secret-typed Outputs so Pulumi encrypts them in state and
    //     redacts them from previews/diffs/CloudWatch logs that surface
    //     stack outputs. Lambda still receives them as env vars
    //     (KMS-encrypted at rest by AWS), so handler code is unchanged.
    //
    // Fail-fast guard for deployed stages (dev, prod): GitHub Actions
    // resolves an unset `${{ secrets.X }}` to an empty string. Without
    // this check, an unset secret silently produces a Lambda that
    // returns 500 on every request. We instead fail the deploy with a
    // clear error pointing at the GitHub Environment.
    //
    // Personal stages (jbejenar etc.) skip the guard so `sst dev`
    // works locally without all secrets configured — handler's runtime
    // guard still catches missing values during local manual testing.
    const REQUIRED_WEBHOOK_SECRETS = [
      "CLERK_WEBHOOK_SECRET",
      "CLERK_SECRET_KEY",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ] as const;
    function readGithubSecret(name: string): string {
      const raw = process.env[name];
      if (raw === undefined) return "";
      // Trim leading/trailing whitespace including newlines — common
      // copy-paste artefact when operators paste from the Clerk/Stripe
      // dashboards. Whitespace-only values become empty here and fail
      // the same validation as truly-unset secrets.
      return raw.trim();
    }
    function readGithubVar(name: string): string {
      const raw = process.env[name];
      if (raw === undefined) return "";
      return raw.trim();
    }
    const isDeployedStage = $app.stage === "dev" || $app.stage === "prod";
    if (isDeployedStage) {
      const missing = REQUIRED_WEBHOOK_SECRETS.filter(
        (name) => readGithubSecret(name).length === 0,
      );
      if (missing.length > 0) {
        throw new Error(
          `Missing or whitespace-only GitHub Environment secrets for stage "${$app.stage}": ` +
            `${missing.join(", ")}. ` +
            `Set them at Settings → Environments → ${$app.stage} → Environment secrets ` +
            `(values must be non-empty after trimming), then re-run the deploy workflow.`,
        );
      }
    }

    // -- API: Hono on Lambda (single handler for all routes) --

    const api = new sst.aws.ApiGatewayV2("PqApi", {
      domain: isProd
        ? {
            name: "api.prontiq.dev",
            dns: false,
            cert: "arn:aws:acm:ap-southeast-2:493712557159:certificate/bcf32366-bb2c-42d8-a690-ada84e048700",
          }
        : undefined,
      cors: {
        allowOrigins: ["*"],
        // POST + Authorization added in P1B.05 PR 3 for the
        // /v1/account/setup endpoint. Scope is wider than that one
        // endpoint — the CORS config on ApiGatewayV2 applies to ALL
        // routes — but additive: the address API is GET-only with
        // X-Api-Key auth, so a browser POST or Authorization header
        // on /v1/address/* is either rejected as 404 (no POST route
        // declared) or ignored by the auth middleware (which keys
        // off X-Api-Key only). No existing-flow rejection.
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["X-Api-Key", "Authorization", "Content-Type"],
      },
      transform: {
        // Enable per-route CloudWatch metrics so the
        // PqClerkWebhookErrors / PqAccountErrors alarms below can
        // dimension on `Route` and fire only for their own route
        // group (not on every PqApi 5xx). Without this flag the
        // default ApiGatewayV2 metrics expose only ApiId + Stage
        // dimensions, which would force a single combined alarm
        // for the entire API. Cost is ~$0.09 per million requests
        // — negligible for our QPS, but the operational clarity
        // (separate alarms / runbooks per ingress surface) is
        // worth it.
        //
        // **CRITICAL — throttle limits MUST be set explicitly when
        // defaultRouteSettings is configured.** AWS API Gateway
        // treats omitted throttlingBurstLimit / throttlingRateLimit
        // fields as 0 (NOT "inherit account default") whenever
        // defaultRouteSettings is set, which throttles every
        // request to the API. Setting them to the AWS account
        // defaults (10000 req/s sustained, 5000 burst) restores
        // the prior implicit behaviour. Caught the hard way in PR
        // #101 — initial deploy 429'd every prod request including
        // /v1/health. Do NOT remove these values.
        stage: {
          defaultRouteSettings: {
            detailedMetricsEnabled: true,
            throttlingBurstLimit: 5000,
            throttlingRateLimit: 10000,
          },
        },
      },
    });

    const apiDefaultRoute = api.route("$default", {
      handler: "packages/api/src/index.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [authKeysTable, authUsageTable],
      permissions: [
        {
          actions: ["es:ESHttpGet", "es:ESHttpPost", "es:ESHttpHead"],
          resources: [`${OPENSEARCH_DOMAIN_ARN}/*`],
        },
        {
          actions: ["xray:PutTraceSegments", "xray:PutTelemetryRecords"],
          resources: ["*"],
        },
        {
          actions: ["lambda:InvokeFunction"],
          resources: [quotaEmailWorkerFn.arn],
        },
      ],
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT,
        KEYS_TABLE_NAME: authKeysTable.name,
        QUOTA_EMAIL_WORKER_FUNCTION_NAME: quotaEmailWorkerFn.name,
        USAGE_TABLE_NAME: authUsageTable.name,
      },
      transform: {
        function: {
          tracingConfig: {
            mode: "Active",
          },
        },
      },
    });

    // Customer dashboard removed. The next account surface will be built
    // fresh per the Architecture v2.1 §7 design when P1B ships (Clerk +
    // billing provisioning chain). See packages/web/ when that work begins.

    // ═══════════════════════════════════════════════════════════════════════
    // INGESTION PIPELINE
    // ═══════════════════════════════════════════════════════════════════════

    // -- SNS: Ingestion failure alerts --
    const ingestAlerts = new aws.sns.Topic("PqIngestAlerts");
    if (isProd) {
      const alertEmails = readGithubVar("ALERT_EMAILS")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      if (alertEmails.length === 0) {
        throw new Error(
          'Missing GitHub Environment variable "ALERT_EMAILS" for stage "prod". ' +
            "Set it to a comma-separated recipient list in Settings → Environments → prod → Variables.",
        );
      }
      alertEmails.forEach((email, index) => {
        new aws.sns.TopicSubscription(`PqAlertEmailSubscription${index + 1}`, {
          topic: ingestAlerts.arn,
          protocol: "email",
          endpoint: email,
        });
      });
    }

    // -- Ingestion Lambdas (Step Function tasks) --
    const opensearchEndpoint =
      process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT;

    const readManifestFn = new sst.aws.Function("PqIngestReadManifest", {
      handler: "packages/ingestion/src/read-manifest.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
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
      runtime: "nodejs24.x",
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
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "15 minutes",
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
      runtime: "nodejs24.x",
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
      runtime: "nodejs24.x",
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

    const ecrRepoName = isProd ? "prontiq-ingest-bulk" : `prontiq-ingest-bulk-${$app.stage}`;
    const ingestRepo = new aws.ecr.Repository("PqIngestBulkRepo", {
      name: ecrRepoName,
      forceDelete: true,
    }, isProd ? { import: "prontiq-ingest-bulk" } : undefined);

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
      family: `prontiq-ingest-bulk-${$app.stage}`,
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
              "awslogs-group": `/ecs/prontiq-ingest-bulk-${$app.stage}`,
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
                TimeoutSeconds: 14400,
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
      runtime: "nodejs24.x",
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
        runtime: "nodejs24.x",
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

    // ═══════════════════════════════════════════════════════════════════════
    // CONTROL PLANE — Clerk webhook handler (P1B.05)
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Wires `POST /webhooks/clerk` on the existing PqApi to a dedicated
    // PqClerkWebhook Lambda. ApiGatewayV2's explicit-route precedence
    // means this route lands on PqClerkWebhook; everything else still
    // hits the $default address-API Lambda. The address-API IAM stays
    // untouched.
    //
    // Clerk dashboard already points at this URL (the dev stage's
    // execute-api endpoint at /webhooks/clerk). PR PR 3 of P1B.05 will
    // add /v1/account/setup as a separate route mapped to its own
    // PqAccount Lambda — not this one — to keep address-API IAM minimal.
    //
    // SES IAM: scoped to the prontiq.dev domain identity. Operator must
    // verify the SES domain identity in ap-southeast-2 (one-time DKIM
    // CNAME setup via Vercel DNS) and request removal from SES sandbox
    // before the welcome email path goes live in prod.

    // ─── Shared env contract for ALL control-plane Lambdas ───
    //
    // Both `PqClerkWebhook` (Svix-signed `POST /webhooks/clerk`) and
    // `PqAccount` (Clerk-JWT-authenticated `POST /v1/account/setup`)
    // call into `@prontiq/control-plane` and MUST be configured with
    // the same env so they enforce the same provisioning + auth policy.
    //
    // Why a single helper instead of two parallel env blocks:
    //   - `getAdminRoles()` (in `@prontiq/control-plane`) reads
    //     `process.env.CLERK_ADMIN_ROLES` at runtime. If one Lambda
    //     receives the override and the other doesn't, the two ingress
    //     paths silently disagree on who can provision an org — exactly
    //     the policy divergence the centralised helper was meant to
    //     prevent. Bot review on PR #101 (Bug 3) caught this after the
    //     two env blocks were declared independently.
    //   - Future env additions for control-plane logic (e.g. a SES
    //     suppression-table name when P1B.08 ships) need to land on
    //     BOTH Lambdas. A single source makes it impossible to forget
    //     one, and a future reviewer can audit the contract by reading
    //     ten lines instead of diffing two blocks.
    //
    // Webhook-only env (currently just `CLERK_WEBHOOK_SECRET`) is
    // spread on top in the webhook's own declaration.
    //
    // Note on AWS_REGION: intentionally NOT set in either Lambda —
    // it's a Lambda reserved key that the runtime auto-populates with
    // the function's deploy region. Setting it explicitly causes
    // CreateFunction to reject the request with
    // InvalidParameterValueException. The hand-rolled SES SigV4
    // signing in `provisioning.ts` reads `process.env.AWS_REGION` via
    // `getOptionalEnv("AWS_REGION", "ap-southeast-2")` — the runtime
    // value is what it gets.
    function controlPlaneEnv() {
      return {
        // Secrets wrapped with $util.secret() so Pulumi encrypts them
        // in state, redacts them from previews/diffs, and treats
        // stack-output references as secret-typed. Read via
        // readGithubSecret so trailing-newline / whitespace-only
        // values get normalised consistently with the validation
        // guard above.
        CLERK_SECRET_KEY: $util.secret(readGithubSecret("CLERK_SECRET_KEY")),
        STRIPE_SECRET_KEY: $util.secret(readGithubSecret("STRIPE_SECRET_KEY")),
        // Non-secret config — plaintext in state is fine.
        // Consumed by `getAdminRoles()` in `@prontiq/control-plane`,
        // called by BOTH the webhook handler (gates on the Svix-
        // signed `data.role` field) AND the account-setup endpoint's
        // `clerkAdminOnly()` middleware (gates on the JWT `org_role`
        // claim). Same env var → same role set → no divergence.
        CLERK_ADMIN_ROLES: process.env.CLERK_ADMIN_ROLES ?? "",
        AUDIT_TABLE_NAME: auditTable.name,
        ...sharedEmailEnv(),
        PRONTIQ_ACCOUNT_URL:
          process.env.PRONTIQ_ACCOUNT_URL ?? "https://prontiq.dev/account",
      };
    }

    // Declare the Function explicitly (rather than inline in api.route)
    // so the CloudWatch alarm below can reference its name
    // deterministically. With inline specs SST generates names like
    // `prontiq-{stage}-PqApiRoute<hash>HandlerFunction-<rand>` which
    // don't give us a stable handle.
    const clerkWebhookFn = new sst.aws.Function("PqClerkWebhook", {
      handler: "packages/webhooks/src/clerk.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [authKeysTable, authUsageTable, auditTable, suppressionsTable],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: sharedEmailSendResources(),
        },
      ],
      environment: {
        ...controlPlaneEnv(),
        // Webhook-only: the Svix signing secret used to verify the
        // `POST /webhooks/clerk` body. The account-setup endpoint
        // doesn't need this — it authenticates via Clerk JWT instead.
        CLERK_WEBHOOK_SECRET: $util.secret(readGithubSecret("CLERK_WEBHOOK_SECRET")),
      },
    });

    api.route("POST /webhooks/clerk", clerkWebhookFn.arn);

    const stripeWebhookFn = new sst.aws.Function("PqStripeWebhook", {
      handler: "packages/webhooks/src/stripe.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [authKeysTable, authUsageTable, auditTable, suppressionsTable],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: sharedEmailSendResources(),
        },
      ],
      environment: {
        ...controlPlaneEnv(),
        STRIPE_WEBHOOK_SECRET: $util.secret(readGithubSecret("STRIPE_WEBHOOK_SECRET")),
      },
    });

    api.route("POST /webhooks/stripe", stripeWebhookFn.arn);

    // CloudWatch alarm: > 5 5xx responses in 15 minutes on the Clerk
    // webhook route fires the existing ingestAlerts SNS topic.
    //
    // **Why AWS/ApiGateway 5xx instead of AWS/Lambda Errors:** the
    // handler reports most failure modes by RETURNING json with HTTP
    // 500 (retryable_failure / fatal_failure / clerk_api_lookup_failed),
    // not by throwing. From Lambda's perspective those invocations
    // succeed — `AWS/Lambda Errors` stays at 0. The ApiGateway 5xx
    // metric counts both unhandled Lambda exceptions (which propagate
    // to API Gateway as 5xx) AND handler-returned 5xx, so it's a
    // strict superset. Bot review on PR #101 surfaced this; the same
    // bug was latent on the existing webhook alarm and is fixed here
    // alongside the new account alarm.
    //
    // Webhook DLQ semantics: ApiGatewayV2 doesn't have a sync-invoke
    // DLQ — the operational DLQ is Svix's own redelivery queue
    // (visible in the Clerk dashboard) plus this alarm.
    new aws.cloudwatch.MetricAlarm("PqClerkWebhookErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "5xx",
      namespace: "AWS/ApiGateway",
      period: 900, // 15 minutes
      statistic: "Sum",
      threshold: 5,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Clerk webhook route returned more than 5 5xx responses in 15 minutes. Catches both unhandled Lambda exceptions AND handler-returned 500s (retryable_failure, fatal_failure, clerk_api_lookup_failed). Check CloudWatch Logs for the handler and the Svix message queue in the Clerk dashboard for stuck deliveries.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        ApiId: api.nodes.api.id,
        Stage: "$default",
        Route: "POST /webhooks/clerk",
      },
    });

    new aws.cloudwatch.MetricAlarm("PqStripeWebhookErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "5xx",
      namespace: "AWS/ApiGateway",
      period: 900,
      statistic: "Sum",
      threshold: 5,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Stripe webhook route returned more than 5 5xx responses in 15 minutes. Catches both unhandled Lambda exceptions and handler-returned 500s for replay-safe Stripe retries.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        ApiId: api.nodes.api.id,
        Stage: "$default",
        Route: "POST /webhooks/stripe",
      },
    });

    new aws.cloudwatch.MetricAlarm("PqSesFeedbackErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 900,
      statistic: "Sum",
      threshold: 0,
      treatMissingData: "notBreaching",
      alarmDescription:
        "SES feedback subscriber Lambda recorded an error in the last 15 minutes. Check CloudWatch Logs before suppression drift damages SES reputation.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        FunctionName: sesFeedbackFn.name,
      },
    });

    new aws.cloudwatch.MetricAlarm("PqQuotaEmailWorkerErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 900,
      statistic: "Sum",
      threshold: 0,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Quota email worker Lambda recorded an error in the last 15 minutes. Check CloudWatch Logs for stuck threshold emails or SES send failures.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        FunctionName: quotaEmailWorkerFn.name,
      },
    });

    const billingCron = new sst.aws.Cron("PqBillingCron", {
      schedule: "rate(1 hour)",
      function: {
        handler: "packages/control-plane/src/billing-cron.handler",
        architecture: "arm64",
        runtime: "nodejs24.x",
        memory: "512 MB",
        timeout: "2 minutes",
        link: [authKeysTable, authUsageTable],
        environment: {
          KEYS_TABLE_NAME: authKeysTable.name,
          STRIPE_SECRET_KEY: $util.secret(readGithubSecret("STRIPE_SECRET_KEY")),
          USAGE_TABLE_NAME: authUsageTable.name,
        },
      },
    });

    new aws.cloudwatch.MetricAlarm("PqBillingCronErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 3600,
      statistic: "Sum",
      threshold: 0,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Billing cron Lambda recorded an error in the last hour. Check CloudWatch Logs for meter push failures before usage drift accumulates.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        FunctionName: billingCron.nodes.function.name,
      },
    });

    const monthClose = new sst.aws.Cron("PqMonthClose", {
      schedule: "cron(30 0 1 * ? *)",
      function: {
        handler: "packages/control-plane/src/month-close.handler",
        architecture: "arm64",
        runtime: "nodejs24.x",
        memory: "512 MB",
        timeout: "2 minutes",
        link: [authKeysTable, authUsageTable],
        environment: {
          KEYS_TABLE_NAME: authKeysTable.name,
          STRIPE_SECRET_KEY: $util.secret(readGithubSecret("STRIPE_SECRET_KEY")),
          USAGE_TABLE_NAME: authUsageTable.name,
        },
      },
    });

    new aws.cloudwatch.MetricAlarm("PqMonthCloseErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 3600,
      statistic: "Sum",
      threshold: 0,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Month-close Lambda recorded an error during the day-1 previous-month finalisation sweep. Check CloudWatch Logs before billing close drifts.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        FunctionName: monthClose.nodes.function.name,
      },
    });

    // ─── Account-handler Lambda (P1B.05 PR 3): POST /v1/account/setup ───
    //
    // Same control-plane env contract as PqClerkWebhook — see the
    // controlPlaneEnv() helper above. Both Lambdas share the same
    // CLERK_ADMIN_ROLES override (so the admin-role policy is
    // uniform across both ingress paths), the same DDB table names,
    // the same Stripe + Clerk Backend API secrets, etc. Webhook adds
    // CLERK_WEBHOOK_SECRET on top; this Lambda doesn't need it
    // (authenticates via Clerk JWT instead of Svix signature).
    //
    // Separate Lambda from the address-API $default so the hot path
    // (autocomplete / validate) doesn't inherit the @clerk/backend +
    // @prontiq/control-plane bundle. Mounted on the same ApiGatewayV2
    // via an explicit route below — explicit-route precedence catches
    // /v1/account/* before $default. NO CLERK_WEBHOOK_SECRET — the
    // account endpoint authenticates via Clerk JWT, not Svix
    // signature. CLERK_ADMIN_ROLES IS shared (via controlPlaneEnv())
    // so any custom-role override applies uniformly to both this
    // Lambda's clerkAdminOnly() gate and the webhook's role gate.
    // The existing REQUIRED_WEBHOOK_SECRETS guard above validates the
    // two secrets this Lambda needs (CLERK_SECRET_KEY +
    // STRIPE_SECRET_KEY) for dev/prod stages.
    const accountFn = new sst.aws.Function("PqAccount", {
      handler: "packages/api/src/account-handler.handler",
      architecture: "arm64",
      runtime: "nodejs24.x",
      memory: "512 MB",
      timeout: "30 seconds",
      link: [authKeysTable, authUsageTable, auditTable, suppressionsTable],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: sharedEmailSendResources(),
        },
      ],
      environment: controlPlaneEnv(),
    });

    api.route("ANY /v1/account/{proxy+}", accountFn.arn);

    // Same shape as PqClerkWebhookErrors above (AWS/ApiGateway 5xx)
    // for the same reason: the account handler returns 500/503 as JSON
    // envelopes for retryable/fatal failures and AWS/Lambda Errors
    // would miss those. The Resource dimension scopes the alarm to the
    // account route group so a webhook 5xx doesn't trigger this alarm
    // (and vice-versa) — separate operator runbooks for each surface.
    new aws.cloudwatch.MetricAlarm("PqAccountErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "5xx",
      namespace: "AWS/ApiGateway",
      period: 900, // 15 minutes
      statistic: "Sum",
      threshold: 5,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Account route (/v1/account/*) returned more than 5 5xx responses in 15 minutes. Catches unhandled Lambda exceptions AND handler-returned 500/503 (RETRYABLE_FAILURE, FATAL_FAILURE). Check CloudWatch Logs for the PqAccount Lambda.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: {
        ApiId: api.nodes.api.id,
        Stage: "$default",
        Route: "ANY /v1/account/{proxy+}",
      },
    });

    if (isProd) {
      const opensearchDomain = aws.elasticsearch.getDomainOutput({
        domainName: OPENSEARCH_DOMAIN_NAME,
      });
      const openSearchLowFreeStorageThreshold = opensearchDomain.ebsOptions.apply((options) => {
        const volumeSize = options[0]?.volumeSize;
        if (!volumeSize || volumeSize <= 0) {
          throw new Error(
            `Could not resolve EBS volume size for OpenSearch domain "${OPENSEARCH_DOMAIN_NAME}".`,
          );
        }
        return calculateOpenSearchLowFreeStorageThresholdMiB(volumeSize);
      });

      new aws.cloudwatch.MetricAlarm("PqApi5xxRate", {
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        threshold: 1,
        treatMissingData: "notBreaching",
        alarmDescription:
          "Address API 5xx rate exceeded 1% over 5 minutes. Check the PqApi Lambda logs and X-Ray traces for upstream failures.",
        alarmActions: [ingestAlerts.arn],
        okActions: [ingestAlerts.arn],
        metricQueries: [
          {
            id: "e1",
            expression: "IF(m1 > 0, (m2 / m1) * 100, 0)",
            label: "Address API 5xx rate",
            returnData: true,
          },
          {
            id: "m1",
            metric: {
              metricName: "Count",
              namespace: "AWS/ApiGateway",
              period: 300,
              stat: "Sum",
              dimensions: {
                ApiId: api.nodes.api.id,
                Stage: "$default",
                Route: "$default",
              },
            },
          },
          {
            id: "m2",
            metric: {
              metricName: "5xx",
              namespace: "AWS/ApiGateway",
              period: 300,
              stat: "Sum",
              dimensions: {
                ApiId: api.nodes.api.id,
                Stage: "$default",
                Route: "$default",
              },
            },
          },
        ],
      });

      new aws.cloudwatch.MetricAlarm("PqApiLambdaErrorRate", {
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        threshold: 1,
        treatMissingData: "notBreaching",
        alarmDescription:
          "Address API Lambda error rate exceeded 1% over 5 minutes. Check the PqApi Lambda logs for unhandled exceptions.",
        alarmActions: [ingestAlerts.arn],
        okActions: [ingestAlerts.arn],
        metricQueries: [
          {
            id: "e1",
            expression: "IF(m1 > 0, (m2 / m1) * 100, 0)",
            label: "Address API Lambda error rate",
            returnData: true,
          },
          {
            id: "m1",
            metric: {
              metricName: "Invocations",
              namespace: "AWS/Lambda",
              period: 300,
              stat: "Sum",
              dimensions: {
                FunctionName: apiDefaultRoute.nodes.function.name,
              },
            },
          },
          {
            id: "m2",
            metric: {
              metricName: "Errors",
              namespace: "AWS/Lambda",
              period: 300,
              stat: "Sum",
              dimensions: {
                FunctionName: apiDefaultRoute.nodes.function.name,
              },
            },
          },
        ],
      });

      new aws.cloudwatch.MetricAlarm("PqOpenSearchYellow", {
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        metricName: "ClusterStatus.yellow",
        namespace: "AWS/ES",
        period: 300,
        statistic: "Maximum",
        threshold: 1,
        treatMissingData: "notBreaching",
        alarmDescription:
          "OpenSearch domain cluster status is yellow. Check shard allocation and node health before redundancy degrades further.",
        alarmActions: [ingestAlerts.arn],
        okActions: [ingestAlerts.arn],
        dimensions: {
          DomainName: OPENSEARCH_DOMAIN_NAME,
          ClientId: AWS_ACCOUNT_ID,
        },
      });

      new aws.cloudwatch.MetricAlarm("PqOpenSearchRed", {
        comparisonOperator: "GreaterThanOrEqualToThreshold",
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        metricName: "ClusterStatus.red",
        namespace: "AWS/ES",
        period: 300,
        statistic: "Maximum",
        threshold: 1,
        treatMissingData: "notBreaching",
        alarmDescription:
          "OpenSearch domain cluster status is red. Search availability is degraded or broken and needs immediate intervention.",
        alarmActions: [ingestAlerts.arn],
        okActions: [ingestAlerts.arn],
        dimensions: {
          DomainName: OPENSEARCH_DOMAIN_NAME,
          ClientId: AWS_ACCOUNT_ID,
        },
      });

      new aws.cloudwatch.MetricAlarm("PqOpenSearchLowFreeStorage", {
        comparisonOperator: "LessThanThreshold",
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        metricName: "FreeStorageSpace",
        namespace: "AWS/ES",
        period: 300,
        statistic: "Minimum",
        threshold: openSearchLowFreeStorageThreshold,
        treatMissingData: "notBreaching",
        alarmDescription:
          "OpenSearch per-node free storage fell below 20% of provisioned capacity. Check indexing growth before the domain enters write-protection or cluster instability.",
        alarmActions: [ingestAlerts.arn],
        okActions: [ingestAlerts.arn],
        dimensions: {
          DomainName: OPENSEARCH_DOMAIN_NAME,
          ClientId: AWS_ACCOUNT_ID,
        },
      });

      new aws.cloudwatch.Dashboard("PqProductionDashboard", {
        dashboardName: "prontiq-production",
        dashboardBody: pulumi
          .all([
            api.nodes.api.id,
            apiDefaultRoute.nodes.function.name,
            clerkWebhookFn.name,
            stripeWebhookFn.name,
            accountFn.name,
            sesFeedbackFn.name,
            quotaEmailWorkerFn.name,
            billingCron.nodes.function.name,
            monthClose.nodes.function.name,
          ])
          .apply(
            ([
              apiId,
              apiFunctionName,
              clerkWebhookName,
              stripeWebhookName,
              accountName,
              sesFeedbackName,
              quotaEmailName,
              billingCronName,
              monthCloseName,
            ]) =>
              JSON.stringify({
                widgets: [
                  {
                    type: "metric",
                    x: 0,
                    y: 0,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "API Request Count",
                      view: "timeSeries",
                      region: AWS_REGION,
                      stat: "Sum",
                      period: 300,
                      metrics: [
                        ["AWS/ApiGateway", "Count", "ApiId", apiId, "Stage", "$default", "Route", "$default"],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 12,
                    y: 0,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "API Latency p50 / p95 / p99",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      metrics: [
                        ["AWS/ApiGateway", "Latency", "ApiId", apiId, "Stage", "$default", "Route", "$default", { stat: "p50" }],
                        ["...", { stat: "p95" }],
                        ["...", { stat: "p99" }],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 0,
                    y: 6,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "API 5xx Rate",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      metrics: [
                        [{ expression: "IF(m1 > 0, (m2 / m1) * 100, 0)", id: "e1", label: "5xx rate %" }],
                        ["AWS/ApiGateway", "Count", "ApiId", apiId, "Stage", "$default", "Route", "$default", { id: "m1", stat: "Sum" }],
                        [".", "5xx", ".", ".", ".", ".", ".", ".", { id: "m2", stat: "Sum" }],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 12,
                    y: 6,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "API Lambda Error Rate",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      metrics: [
                        [{ expression: "IF(m1 > 0, (m2 / m1) * 100, 0)", id: "e1", label: "Lambda error rate %" }],
                        ["AWS/Lambda", "Invocations", "FunctionName", apiFunctionName, { id: "m1", stat: "Sum" }],
                        [".", "Errors", ".", ".", { id: "m2", stat: "Sum" }],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 0,
                    y: 12,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "OpenSearch Cluster Status",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      stat: "Maximum",
                      metrics: [
                        ["AWS/ES", "ClusterStatus.yellow", "DomainName", OPENSEARCH_DOMAIN_NAME, "ClientId", AWS_ACCOUNT_ID],
                        [".", "ClusterStatus.red", ".", ".", ".", "."],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 12,
                    y: 12,
                    width: 12,
                    height: 6,
                    properties: {
                      title: "OpenSearch Free Storage",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      stat: "Minimum",
                      metrics: [
                        ["AWS/ES", "FreeStorageSpace", "DomainName", OPENSEARCH_DOMAIN_NAME, "ClientId", AWS_ACCOUNT_ID],
                      ],
                    },
                  },
                  {
                    type: "metric",
                    x: 0,
                    y: 18,
                    width: 24,
                    height: 6,
                    properties: {
                      title: "Critical Lambda Errors",
                      view: "timeSeries",
                      region: AWS_REGION,
                      period: 300,
                      stat: "Sum",
                      metrics: [
                        ["AWS/Lambda", "Errors", "FunctionName", clerkWebhookName],
                        [".", ".", ".", stripeWebhookName],
                        [".", ".", ".", accountName],
                        [".", ".", ".", sesFeedbackName],
                        [".", ".", ".", quotaEmailName],
                        [".", ".", ".", billingCronName],
                        [".", ".", ".", monthCloseName],
                      ],
                    },
                  },
                ],
              }),
          ),
      });
    }

    return {
      api: api.url,
      stateMachine: stateMachine.arn,
      ingestAlerts: ingestAlerts.arn,
    };
  },
});
