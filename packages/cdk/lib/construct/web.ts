import { Stack, RemovalPolicy, CfnResource, Duration } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import {
  CloudFrontToS3,
  CloudFrontToS3Props,
} from '@aws-solutions-constructs/aws-cloudfront-s3';
import {
  AllowedMethods,
  BehaviorOptions,
  CachePolicy,
  CfnDistribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  HeadersFrameOption,
  HeadersReferrerPolicy,
  IDistribution,
  ResponseHeadersPolicy,
  ViewerProtocolPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { S3BucketOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { NodejsBuild } from '@cdklabs/deploy-time-build';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ARecord, HostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import { ICertificate } from 'aws-cdk-lib/aws-certificatemanager';
import {
  AgentCoreConfiguration,
  Flow,
  HiddenUseCases,
  ModelConfiguration,
} from 'generative-ai-use-cases';
import { ComputeType } from 'aws-cdk-lib/aws-codebuild';

export interface WebProps {
  readonly apiEndpointUrl: string;
  readonly userPoolId: string;
  readonly userPoolClientId: string;
  readonly idPoolId: string;
  readonly predictStreamFunctionArn: string;
  readonly ragEnabled: boolean;
  readonly ragKnowledgeBaseEnabled: boolean;
  readonly agentEnabled: boolean;
  readonly flows?: Flow[];
  readonly flowStreamFunctionArn: string;
  readonly optimizePromptFunctionArn: string;
  readonly selfSignUpEnabled: boolean;
  readonly webAclId?: string;
  readonly modelRegion: string;
  readonly modelIds: ModelConfiguration[];
  readonly imageGenerationModelIds: ModelConfiguration[];
  readonly videoGenerationModelIds: ModelConfiguration[];
  readonly endpointNames: ModelConfiguration[];
  readonly samlAuthEnabled: boolean;
  readonly samlCognitoDomainName?: string | null;
  readonly samlCognitoFederatedIdentityProviderName?: string | null;
  readonly builtinAgentsJson: string;
  readonly customAgentsJson: string;
  readonly inlineAgents: boolean;
  readonly cert?: ICertificate;
  readonly hostName?: string | null;
  readonly domainName?: string | null;
  readonly hostedZoneId?: string | null;
  readonly useCaseBuilderEnabled: boolean;
  readonly hiddenUseCases: HiddenUseCases;
  readonly speechToSpeechNamespace: string;
  readonly speechToSpeechEventApiEndpoint: string;
  readonly speechToSpeechModelIds: ModelConfiguration[];
  readonly mcpEnabled: boolean;
  readonly mcpEndpoint: string | null;
  readonly mcpServersConfig?: string;
  readonly webBucket?: s3.Bucket;
  readonly agentCoreEnabled: boolean;
  readonly agentCoreGenericRuntime?: AgentCoreConfiguration;
  readonly agentBuilderEnabled: boolean;
  readonly agentCoreAgentBuilderRuntime?: AgentCoreConfiguration;
  readonly agentCoreExternalRuntimes: AgentCoreConfiguration[];
  readonly agentCoreRegion?: string;
  readonly researchAgentEnabled: boolean;
  readonly researchAgentRuntime?: AgentCoreConfiguration;
  readonly brandingConfig?: {
    logoPath?: string;
    title?: string;
  };
  readonly addonApiEndpointUrl?: string;
  // If true, create a Nest Portal S3 bucket and attach `/nest/*` behavior
  // to the same CloudFront distribution.
  readonly enableNestPortal?: boolean;
}

export class Web extends Construct {
  // public readonly distribution: Distribution;
  public readonly webUrl: string;
  public readonly nestPortalBucket?: s3.Bucket;

  constructor(scope: Construct, id: string, props: WebProps) {
    super(scope, id);

    let distribution: IDistribution | undefined = undefined;
    let webBucket: s3.IBucket;

    // ─── Nest Portal bucket (created upfront so its origin can be wired
    //     into the CloudFront distribution below) ───────────────────────
    let nestPortalBucket: s3.Bucket | undefined;
    if (props.enableNestPortal) {
      nestPortalBucket = new s3.Bucket(this, 'NestPortalBucket', {
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        encryption: s3.BucketEncryption.S3_MANAGED,
        autoDeleteObjects: true,
        removalPolicy: RemovalPolicy.DESTROY,
        enforceSSL: true,
      });
      this.nestPortalBucket = nestPortalBucket;
    }

    const commonBucketProps: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
      objectOwnership: s3.ObjectOwnership.OBJECT_WRITER,
      enforceSSL: true,
    };

    if (!props.webBucket) {
      const cspSaml = props.samlCognitoDomainName
        ? ` https://${props.samlCognitoDomainName}`
        : '';
      const csp = `default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: https://*.amazonaws.com; connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com wss://*.amazonaws.com:* https://*.on.aws https://raw.githubusercontent.com https://api.github.com${cspSaml}; font-src 'self' https://fonts.gstatic.com data:; object-src 'none'; frame-ancestors 'none'; frame-src 'self' https://www.youtube.com/;`;

      // Create Response Headers Policy for security headers
      const responseHeadersPolicy = new ResponseHeadersPolicy(
        this,
        'SecurityHeadersPolicy',
        {
          securityHeadersBehavior: {
            // Content Security Policy configuration
            contentSecurityPolicy: {
              contentSecurityPolicy: csp,
              override: true,
            },
            // Clickjacking protection
            frameOptions: {
              frameOption: HeadersFrameOption.DENY,
              override: true,
            },
            // Other security headers
            strictTransportSecurity: {
              accessControlMaxAge: Duration.days(365 * 2),
              includeSubdomains: true,
              preload: true,
              override: true,
            },
            xssProtection: {
              protection: true,
              modeBlock: true,
              override: true,
            },
            contentTypeOptions: {
              override: true,
            },
            referrerPolicy: {
              referrerPolicy:
                HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
              override: true,
            },
          },
        }
      );

      // Optional Nest Portal additional behavior under `/nest/*`.
      //
      // The Nest Portal SPA is uploaded to the Nest Portal S3 bucket under
      // the `nest/` key prefix (e.g. `nest/index.html`, `nest/assets/...`),
      // so requests can be forwarded to S3 verbatim without URI rewriting.
      //
      // A CloudFront Function only rewrites SPA route refreshes
      // (`/nest/some-page` -> `/nest/index.html`) and the trailing-slash
      // case (`/nest/` -> `/nest/index.html`). This keeps cache keys
      // namespaced under `/nest/...` so they cannot collide with the GenU
      // default behavior cache.
      const nestAdditionalBehaviors: Record<string, BehaviorOptions> = {};
      if (nestPortalBucket) {
        const nestRewriteFn = new CfFunction(this, 'NestRewriteFunction', {
          runtime: FunctionRuntime.JS_2_0,
          code: FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  // Trailing slash -> /nest/.../index.html
  if (uri.endsWith('/')) {
    uri += 'index.html';
  } else if (uri.lastIndexOf('.') <= uri.lastIndexOf('/')) {
    // Extension-less SPA routes -> the Nest Portal SPA shell
    uri = '/nest/index.html';
  }
  request.uri = uri;
  return request;
}
          `),
        });
        nestAdditionalBehaviors['/nest/*'] = {
          origin: S3BucketOrigin.withOriginAccessControl(nestPortalBucket),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          responseHeadersPolicy,
          functionAssociations: [
            {
              function: nestRewriteFn,
              eventType: FunctionEventType.VIEWER_REQUEST,
            },
          ],
        };
      }

      const cloudFrontToS3Props: CloudFrontToS3Props = {
        insertHttpSecurityHeaders: false,
        loggingBucketProps: commonBucketProps,
        bucketProps: commonBucketProps,
        cloudFrontLoggingBucketProps: commonBucketProps,
        cloudFrontLoggingBucketAccessLogBucketProps: commonBucketProps,
        cloudFrontDistributionProps: {
          defaultBehavior: {
            responseHeadersPolicy: responseHeadersPolicy,
          },
          additionalBehaviors: nestAdditionalBehaviors,
          errorResponses: [
            {
              httpStatus: 403,
              responseHttpStatus: 200,
              responsePagePath: '/index.html',
            },
            {
              httpStatus: 404,
              responseHttpStatus: 200,
              responsePagePath: '/index.html',
            },
          ],
        },
      };

      if (
        props.cert &&
        props.hostName &&
        props.domainName &&
        props.hostedZoneId
      ) {
        cloudFrontToS3Props.cloudFrontDistributionProps.certificate =
          props.cert;
        cloudFrontToS3Props.cloudFrontDistributionProps.domainNames = [
          `${props.hostName}.${props.domainName}`,
        ];
      }

      const { cloudFrontWebDistribution, s3BucketInterface } =
        new CloudFrontToS3(this, 'Web', cloudFrontToS3Props);

      if (
        props.cert &&
        props.hostName &&
        props.domainName &&
        props.hostedZoneId
      ) {
        // DNS record for custom domain
        const hostedZone = HostedZone.fromHostedZoneAttributes(
          this,
          'HostedZone',
          {
            hostedZoneId: props.hostedZoneId,
            zoneName: props.domainName,
          }
        );
        new ARecord(this, 'ARecord', {
          zone: hostedZone,
          recordName: props.hostName,
          target: RecordTarget.fromAlias(
            new CloudFrontTarget(cloudFrontWebDistribution)
          ),
        });
        this.webUrl = `https://${props.hostName}.${props.domainName}`;
      } else {
        this.webUrl = `https://${cloudFrontWebDistribution.domainName}`;
      }

      if (props.webAclId) {
        const existingCloudFrontWebDistribution = cloudFrontWebDistribution.node
          .defaultChild as CfnDistribution;
        existingCloudFrontWebDistribution.addPropertyOverride(
          'DistributionConfig.WebACLId',
          props.webAclId
        );
      }

      distribution = cloudFrontWebDistribution;
      webBucket = s3BucketInterface;
    } else {
      // Closed network
      webBucket = props.webBucket!;
      this.webUrl = 'CLOSED_NETWORK_MODE';
    }

    const build = new NodejsBuild(this, 'BuildWeb', {
      assets: [
        {
          path: '../../',
          exclude: [
            '.git',
            '.github',
            '.gitignore',
            '.prettierignore',
            '.prettierrc.json',
            '*.md',
            'LICENSE',
            'docs',
            'imgs',
            'setup-env.sh',
            'node_modules',
            'prompt-templates',
            'packages/cdk/**/*',
            '!packages/cdk/cdk.json',
            'packages/web/dist',
            'packages/web/dev-dist',
            'packages/web/node_modules',
            'browser-extension',
          ],
        },
      ],
      destinationBucket: webBucket,
      distribution: distribution,
      outputSourceDirectory: './packages/web/dist',
      buildCommands: [
        'echo "@birdworks-inc:registry=https://npm.pkg.github.com" >> .npmrc',
        'echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc',
        'npm ci',
        'npm run web:build',
      ],
      buildEnvironment: {
        NODE_OPTIONS: '--max-old-space-size=4096',
        // If Nest Portal is enabled, point the "← Nest" header button at
        // the same CloudFront distribution's `/nest/` path.
        VITE_NEST_URL: props.enableNestPortal ? '/nest/' : '',
        VITE_APP_API_ENDPOINT: props.apiEndpointUrl,
        VITE_APP_REGION: Stack.of(this).region,
        VITE_APP_USER_POOL_ID: props.userPoolId,
        VITE_APP_USER_POOL_CLIENT_ID: props.userPoolClientId,
        VITE_APP_IDENTITY_POOL_ID: props.idPoolId,
        VITE_APP_PREDICT_STREAM_FUNCTION_ARN: props.predictStreamFunctionArn,
        VITE_APP_RAG_ENABLED: props.ragEnabled.toString(),
        VITE_APP_RAG_KNOWLEDGE_BASE_ENABLED:
          props.ragKnowledgeBaseEnabled.toString(),
        VITE_APP_AGENT_ENABLED: props.agentEnabled.toString(),
        VITE_APP_FLOWS: JSON.stringify(props.flows || []),
        VITE_APP_FLOW_STREAM_FUNCTION_ARN: props.flowStreamFunctionArn,
        VITE_APP_OPTIMIZE_PROMPT_FUNCTION_ARN: props.optimizePromptFunctionArn,
        VITE_APP_SELF_SIGN_UP_ENABLED: props.selfSignUpEnabled.toString(),
        VITE_APP_MODEL_REGION: props.modelRegion,
        VITE_APP_MODEL_IDS: JSON.stringify(props.modelIds),
        VITE_APP_IMAGE_MODEL_IDS: JSON.stringify(props.imageGenerationModelIds),
        VITE_APP_VIDEO_MODEL_IDS: JSON.stringify(props.videoGenerationModelIds),
        VITE_APP_ENDPOINT_NAMES: JSON.stringify(props.endpointNames),
        VITE_APP_SAMLAUTH_ENABLED: props.samlAuthEnabled.toString(),
        VITE_APP_SAML_COGNITO_DOMAIN_NAME: props.samlCognitoDomainName ?? '',
        VITE_APP_SAML_COGNITO_FEDERATED_IDENTITY_PROVIDER_NAME:
          props.samlCognitoFederatedIdentityProviderName ?? '',
        VITE_APP_BUILTIN_AGENTS_JSON: props.builtinAgentsJson,
        VITE_APP_CUSTOM_AGENTS_JSON: props.customAgentsJson,
        VITE_APP_INLINE_AGENTS: props.inlineAgents.toString(),
        VITE_APP_USE_CASE_BUILDER_ENABLED:
          props.useCaseBuilderEnabled.toString(),
        VITE_APP_HIDDEN_USE_CASES: JSON.stringify(props.hiddenUseCases),
        VITE_APP_SPEECH_TO_SPEECH_NAMESPACE: props.speechToSpeechNamespace,
        VITE_APP_SPEECH_TO_SPEECH_EVENT_API_ENDPOINT:
          props.speechToSpeechEventApiEndpoint,
        VITE_APP_SPEECH_TO_SPEECH_MODEL_IDS: JSON.stringify(
          props.speechToSpeechModelIds
        ),
        VITE_APP_MCP_ENABLED: props.mcpEnabled.toString(),
        VITE_APP_MCP_ENDPOINT: props.mcpEndpoint ?? '',
        VITE_APP_MCP_SERVERS_CONFIG: props.mcpServersConfig ?? '',
        VITE_APP_AGENT_CORE_ENABLED: props.agentCoreEnabled.toString(),
        VITE_APP_AGENT_CORE_GENERIC_RUNTIME: JSON.stringify(
          props.agentCoreGenericRuntime
        ),
        VITE_APP_AGENT_CORE_AGENT_BUILDER_ENABLED:
          props.agentBuilderEnabled.toString(),
        VITE_APP_AGENT_CORE_AGENT_BUILDER_RUNTIME: JSON.stringify(
          props.agentCoreAgentBuilderRuntime
        ),
        VITE_APP_AGENT_CORE_EXTERNAL_RUNTIMES: JSON.stringify(
          props.agentCoreExternalRuntimes
        ),
        VITE_APP_RESEARCH_AGENT_ENABLED: props.researchAgentEnabled.toString(),
        VITE_APP_RESEARCH_AGENT_RUNTIME: JSON.stringify(
          props.researchAgentRuntime
        ),
        VITE_APP_BRANDING_LOGO_PATH: props.brandingConfig?.logoPath ?? '',
        VITE_APP_BRANDING_TITLE: props.brandingConfig?.title ?? '',
        VITE_APP_ADDON_API_ENDPOINT: props.addonApiEndpointUrl ?? '',
        NODE_AUTH_TOKEN: ssm.StringParameter.valueForStringParameter(
          this,
          '/genu/github-packages-token'
        ),
      },
    });
    // Enhance computing resources
    (
      build.node.findChild('Project').node.defaultChild as CfnResource
    ).addPropertyOverride('Environment.ComputeType', ComputeType.MEDIUM);

    // ─── Nest Portal SPA build (only when enableNestPortal is set) ───
    // Builds packages/nest-portal/web with Vite via pnpm and uploads the
    // result to the Nest Portal S3 bucket under the `nest/` key prefix.
    // The same CloudFront distribution is invalidated for `/nest/*`.
    if (nestPortalBucket && distribution) {
      const nestBuild = new NodejsBuild(this, 'BuildNestPortal', {
        assets: [
          {
            path: '../../../generative-ai-addons',
            exclude: [
              '.git',
              '.github',
              '.gitignore',
              '*.md',
              'node_modules',
              '**/node_modules',
              '**/dist',
              '**/dist-app',
              '**/cdk.out',
              '**/*.tsbuildinfo',
              '**/target',
              'packages/chirp-connector/src-tauri/target',
            ],
          },
        ],
        destinationBucket: nestPortalBucket,
        distribution,
        // Vite emits into `dist-app/nest/`, so uploading the whole
        // `dist-app/` directory lands the files under the `nest/` S3 key
        // prefix expected by the /nest/* behavior.
        outputSourceDirectory: './packages/nest-portal/web/dist-app',
        buildCommands: [
          'corepack enable',
          'corepack prepare pnpm@10.33.0 --activate',
          'echo "@birdworks-inc:registry=https://npm.pkg.github.com" >> .npmrc',
          'echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> .npmrc',
          'pnpm install --frozen-lockfile',
          // Build addon web packages first so their dist/ outputs (used by
          // tsc to resolve @birdworks-inc/genu-addon-*-web types) exist
          // before the Nest Portal type-check runs.
          'pnpm --filter "@birdworks-inc/genu-addon-kit-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-chirp-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-quill-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-dashboard-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-rook-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-labeler-web" run build',
          'pnpm --filter "@birdworks-inc/genu-addon-usermgmt-web" run build',
          'pnpm --filter @birdworks-inc/nest-portal-web run build',
        ],
        buildEnvironment: {
          NODE_OPTIONS: '--max-old-space-size=4096',
          // GenU convention env vars consumed by addon web packages
          VITE_APP_API_ENDPOINT: props.apiEndpointUrl,
          VITE_APP_ADDON_API_ENDPOINT: props.addonApiEndpointUrl ?? '',
          VITE_APP_REGION: Stack.of(this).region,
          VITE_APP_USER_POOL_ID: props.userPoolId,
          VITE_APP_USER_POOL_CLIENT_ID: props.userPoolClientId,
          VITE_APP_IDENTITY_POOL_ID: props.idPoolId,
          // Nest Portal native env vars (kept as fallback)
          VITE_USER_POOL_ID: props.userPoolId,
          VITE_USER_POOL_CLIENT_ID: props.userPoolClientId,
          VITE_IDENTITY_POOL_ID: props.idPoolId,
          VITE_REGION: Stack.of(this).region,
          VITE_ADDON_API_ENDPOINT: props.addonApiEndpointUrl ?? '',
          NODE_AUTH_TOKEN: ssm.StringParameter.valueForStringParameter(
            this,
            '/genu/github-packages-token'
          ),
        },
      });
      (
        nestBuild.node.findChild('Project').node.defaultChild as CfnResource
      ).addPropertyOverride('Environment.ComputeType', ComputeType.MEDIUM);
    }
  }
}
