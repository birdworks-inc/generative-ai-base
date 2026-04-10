import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { LabelerConstruct } from '../../../../generative-ai-addons/packages/labeler/cdk/lib';
import { UsermgmtConstruct } from '../../../../generative-ai-addons/packages/usermgmt/cdk/lib';
import { ChirpConstruct } from '../../../../generative-ai-addons/packages/chirp/cdk/lib';
import { DashboardConstruct } from '../../../../generative-ai-addons/packages/dashboard/cdk/lib';
import { QuillConstruct } from '../../../../generative-ai-addons/packages/quill/cdk/lib';
import { RookConstruct } from '../../../../generative-ai-addons/packages/rook/cdk/lib';

export interface AddonStackProps extends cdk.StackProps {
  userPoolId: string;
  bedrockRegion: string;
  statsTableName: string;
  statsTableArn: string;
  identityPoolId: string;
}

export class AddonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AddonStackProps) {
    super(scope, id, props);

    const {
      userPoolId,
      bedrockRegion,
      statsTableName,
      statsTableArn,
      identityPoolId,
    } = props;

    const restApi = new apigateway.RestApi(this, 'Api', {
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
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(
      this,
      'Authorizer',
      {
        cognitoUserPools: [userPool],
      }
    );

    new LabelerConstruct(this, 'Labeler', {
      restApi,
      authorizer,
      bedrockRegion,
      statsTableName,
      statsTableArn,
    });
    const usermgmt = new UsermgmtConstruct(this, 'Usermgmt', {
      restApi,
      authorizer,
      userPoolId,
    });
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

    const quill = new QuillConstruct(this, 'Quill', {
      restApi,
      authorizer,
      bedrockRegion,
      identityPoolId,
    });

    new RookConstruct(this, 'Rook', {
      restApi,
      authorizer,
      bedrockRegion,
    });

    new cdk.CfnOutput(this, 'QuillWebSocketEndpoint', {
      value: quill.webSocketApiEndpoint,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: restApi.url,
      exportName: `${this.stackName}-ApiEndpoint`,
    });
  }
}
