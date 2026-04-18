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
        allowMethods: ["GET", "OPTIONS"],
        allowHeaders: ["X-Api-Key", "Content-Type"],
      },
    });

    api.route("$default", {
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
      ],
      environment: {
        OPENSEARCH_ENDPOINT: process.env.OPENSEARCH_ENDPOINT ?? OPENSEARCH_ENDPOINT_DEFAULT,
        KEYS_TABLE_NAME: authKeysTable.name,
        USAGE_TABLE_NAME: authUsageTable.name,
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
      link: [authKeysTable, auditTable, suppressionsTable],
      permissions: [
        {
          actions: ["ses:SendEmail", "ses:SendRawEmail"],
          resources: [
            `arn:aws:ses:${AWS_REGION}:${AWS_ACCOUNT_ID}:identity/prontiq.dev`,
          ],
        },
      ],
      environment: {
        // Secrets wrapped with $util.secret() so Pulumi encrypts them
        // in state, redacts them from previews/diffs, and treats stack-
        // output references as secret-typed. Read via readGithubSecret
        // so trailing-newline / whitespace-only values get normalised
        // consistently with the validation guard above.
        CLERK_WEBHOOK_SECRET: $util.secret(readGithubSecret("CLERK_WEBHOOK_SECRET")),
        CLERK_SECRET_KEY: $util.secret(readGithubSecret("CLERK_SECRET_KEY")),
        STRIPE_SECRET_KEY: $util.secret(readGithubSecret("STRIPE_SECRET_KEY")),
        // Non-secret config — plaintext in state is fine.
        CLERK_ADMIN_ROLES: process.env.CLERK_ADMIN_ROLES ?? "",
        KEYS_TABLE_NAME: authKeysTable.name,
        AUDIT_TABLE_NAME: auditTable.name,
        SUPPRESSIONS_TABLE_NAME: suppressionsTable.name,
        WELCOME_EMAIL_FROM: process.env.WELCOME_EMAIL_FROM ?? "noreply@prontiq.dev",
        PRONTIQ_ACCOUNT_URL:
          process.env.PRONTIQ_ACCOUNT_URL ?? "https://prontiq.dev/account",
        PRONTIQ_DOCS_URL: process.env.PRONTIQ_DOCS_URL ?? "https://docs.prontiq.dev",
        // AWS_REGION is intentionally NOT set here — it's a Lambda
        // reserved key that the runtime auto-populates with the
        // function's deploy region. Setting it explicitly causes
        // CreateFunction to reject the request with
        // InvalidParameterValueException. The hand-rolled SES SigV4
        // signing in provisioning.ts reads process.env.AWS_REGION via
        // getOptionalEnv("AWS_REGION", "ap-southeast-2") — the runtime
        // value is what it gets.
      },
    });

    api.route("POST /webhooks/clerk", clerkWebhookFn.arn);

    // CloudWatch alarm: > 5 errors in 15 minutes on the Clerk webhook
    // Lambda fires the existing ingestAlerts SNS topic. Webhook DLQ
    // semantics: ApiGatewayV2 doesn't have a sync-invoke DLQ — the
    // operational DLQ is Svix's own redelivery queue (visible in the
    // Clerk dashboard) plus this alarm.
    new aws.cloudwatch.MetricAlarm("PqClerkWebhookErrors", {
      comparisonOperator: "GreaterThanThreshold",
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      metricName: "Errors",
      namespace: "AWS/Lambda",
      period: 900, // 15 minutes
      statistic: "Sum",
      threshold: 5,
      treatMissingData: "notBreaching",
      alarmDescription:
        "Clerk webhook Lambda errored more than 5 times in 15 minutes. Check CloudWatch Logs for the handler and the Svix message queue in the Clerk dashboard for stuck deliveries.",
      alarmActions: [ingestAlerts.arn],
      okActions: [ingestAlerts.arn],
      dimensions: { FunctionName: clerkWebhookFn.name },
    });

    return {
      api: api.url,
      stateMachine: stateMachine.arn,
      ingestAlerts: ingestAlerts.arn,
    };
  },
});
