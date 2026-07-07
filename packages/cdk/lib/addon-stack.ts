import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { LabelerConstruct } from '../../../../generative-ai-addons/packages/labeler/cdk/lib';
import { UsermgmtConstruct } from '@birdworks-inc/genu-addon-usermgmt/cdk';
import { ChirpConstruct } from '../../../../generative-ai-addons/packages/chirp/cdk/lib';
import { DashboardConstruct } from '../../../../generative-ai-addons/packages/dashboard/cdk/lib';
import { QuillConstruct } from '../../../../generative-ai-addons/packages/quill/cdk/lib';
import { RookConstruct } from '../../../../generative-ai-addons/packages/rook/cdk/lib';
import { NestPortalConstruct } from '@birdworks-inc/genu-addon-nest-portal-cdk';

export interface AddonStackProps extends cdk.StackProps {
  userPoolId: string;
  userPoolClientId: string;
  bedrockRegion: string;
  statsTableName: string;
  statsTableArn: string;
  identityPoolId: string;
  // Nest Portal S3 bucket name (created by GenU stack via enableNestPortal)
  nestPortalBucketName: string;
  // Which addons to deploy. Undefined/null means "deploy all" (backward compatible).
  enabledAddons?: string[] | null;
}

export class AddonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AddonStackProps) {
    super(scope, id, props);

    const {
      userPoolId,
      userPoolClientId,
      bedrockRegion,
      statsTableName,
      statsTableArn,
      identityPoolId,
      nestPortalBucketName,
      enabledAddons,
    } = props;

    // Undefined enabledAddons means "deploy all" for backward compatibility.
    // Usermgmt is auto-enabled when Chirp or Dashboard is enabled, since both
    // depend on its profile/group tables.
    const isEnabled = (name: string): boolean =>
      !enabledAddons || enabledAddons.includes(name);
    const usermgmtEnabled =
      isEnabled('usermgmt') || isEnabled('chirp') || isEnabled('dashboard');
    // Only Labeler/Usermgmt/Chirp/Dashboard/Quill/Rook attach routes to the
    // shared RestApi. NestPortal does not use it, so if none of the API-based
    // addons are enabled, skip creating the RestApi/Authorizer entirely
    // (an Authorizer with no attached method fails CDK validation).
    const restApiNeeded =
      isEnabled('labeler') ||
      usermgmtEnabled ||
      isEnabled('quill') ||
      isEnabled('rook');

    let restApi: apigateway.RestApi | undefined;
    let authorizer: apigateway.CognitoUserPoolsAuthorizer | undefined;

    if (restApiNeeded) {
      restApi = new apigateway.RestApi(this, 'Api', {
        deployOptions: { stageName: 'api' },
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: apigateway.Cors.ALL_METHODS,
        },
        cloudWatchRole: true,
      });

      // Add CORS headers to Gateway error responses (4XX/5XX)
      restApi.addGatewayResponse('Default4XX', {
        type: apigateway.ResponseType.DEFAULT_4XX,
        responseHeaders: {
          'Access-Control-Allow-Origin': "'*'",
          'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        },
      });
      restApi.addGatewayResponse('Default5XX', {
        type: apigateway.ResponseType.DEFAULT_5XX,
        responseHeaders: {
          'Access-Control-Allow-Origin': "'*'",
          'Access-Control-Allow-Headers': "'Content-Type,Authorization'",
        },
      });

      const userPool = cognito.UserPool.fromUserPoolId(
        this,
        'UserPool',
        userPoolId
      );
      authorizer = new apigateway.CognitoUserPoolsAuthorizer(
        this,
        'Authorizer',
        {
          cognitoUserPools: [userPool],
        }
      );
    }

    if (isEnabled('labeler') && restApi && authorizer) {
      new LabelerConstruct(this, 'Labeler', {
        restApi,
        authorizer,
        bedrockRegion,
        statsTableName,
        statsTableArn,
      });
    }

    const usermgmt =
      usermgmtEnabled && restApi && authorizer
        ? new UsermgmtConstruct(this, 'Usermgmt', {
            restApi,
            authorizer,
            userPoolId,
          })
        : undefined;

    if (isEnabled('chirp') && usermgmt && restApi && authorizer) {
      new ChirpConstruct(this, 'Chirp', {
        restApi,
        authorizer,
        bedrockRegion,
        profileTableName: usermgmt.profileTableName,
        profileTableArn: usermgmt.profileTableArn,
        userPoolId,
        statsTableName,
        statsTableArn,
      });
    }

    if (isEnabled('dashboard') && usermgmt && restApi && authorizer) {
      new DashboardConstruct(this, 'Dashboard', {
        restApi,
        authorizer,
        statsTableName,
        statsTableArn,
        profileTableName: usermgmt.profileTableName,
        profileTableArn: usermgmt.profileTableArn,
        groupProfileTableName: usermgmt.groupProfileTableName,
        groupProfileTableArn: usermgmt.groupProfileTableArn,
      });
    }

    if (isEnabled('quill') && restApi && authorizer) {
      const quill = new QuillConstruct(this, 'Quill', {
        restApi,
        authorizer,
        bedrockRegion,
        identityPoolId,
      });
      new cdk.CfnOutput(this, 'QuillWebSocketEndpoint', {
        value: quill.webSocketApiEndpoint,
      });
    }

    if (isEnabled('rook') && restApi && authorizer) {
      new RookConstruct(this, 'Rook', {
        restApi,
        authorizer,
        bedrockRegion,
      });
    }

    if (isEnabled('nestPortal')) {
      new NestPortalConstruct(this, 'NestPortal', {
        bucketName: nestPortalBucketName,
        userPoolId,
        userPoolClientId,
        identityPoolId,
        region: this.region,
      });
    }

    if (restApi) {
      new cdk.CfnOutput(this, 'ApiEndpoint', {
        value: restApi.url,
        exportName: `${this.stackName}-ApiEndpoint`,
      });
    }
  }
}
