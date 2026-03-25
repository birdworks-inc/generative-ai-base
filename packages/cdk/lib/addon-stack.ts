import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { LabelerConstruct } from '../../../../generative-ai-addons/packages/labeler/cdk/lib';
import { UsermgmtConstruct } from '../../../../generative-ai-addons/packages/usermgmt/cdk/lib';
import { ChirpConstruct } from '../../../../generative-ai-addons/packages/chirp/cdk/lib';
import { DashboardConstruct } from '../../../../generative-ai-addons/packages/dashboard/cdk/lib';

export interface AddonStackProps extends cdk.StackProps {
  userPoolId: string;
  bedrockRegion: string;
}

export class AddonStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AddonStackProps) {
    super(scope, id, props);

    const { userPoolId, bedrockRegion } = props;

    const restApi = new apigateway.RestApi(this, 'Api', {
      deployOptions: { stageName: 'api' },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
      cloudWatchRole: true,
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
    });
    new DashboardConstruct(this, 'Dashboard', {
      restApi,
      authorizer,
    });

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: restApi.url,
      exportName: `${this.stackName}-ApiEndpoint`,
    });
  }
}
