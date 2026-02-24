declare module "passport-auth0" {
  export interface Auth0StrategyOptions {
    domain: string;
    clientID: string;
    clientSecret: string;
    callbackURL: string;
    scope?: string;
    passReqToCallback?: boolean;
  }

  export type VerifyCallback = (error: Error | null, user?: unknown, info?: unknown) => void;

  export type VerifyFunction = (
    accessToken: string,
    refreshToken: string,
    extraParams: Record<string, unknown>,
    profile: {
      id: string;
      displayName?: string;
      name?: { givenName?: string; familyName?: string };
      nickname?: string;
      emails?: Array<{ value: string }>;
      picture?: string;
      _json?: Record<string, unknown>;
    },
    done: VerifyCallback
  ) => void;

  export class Strategy {
    constructor(options: Auth0StrategyOptions, verify: VerifyFunction);
  }
}
