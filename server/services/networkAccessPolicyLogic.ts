export type NetworkAccessInputs = {
  orgNetworkAccessEnabled: boolean;
  userNetworkAccessEnabled: boolean;
};

export type NetworkAccessDecision = {
  effectiveNetworkAccessEnabled: boolean;
  lockedByOrg: boolean;
};

export function computeNetworkAccessDecision(input: NetworkAccessInputs): NetworkAccessDecision {
  const effectiveNetworkAccessEnabled = input.orgNetworkAccessEnabled && input.userNetworkAccessEnabled;
  const lockedByOrg = !input.orgNetworkAccessEnabled;
  return { effectiveNetworkAccessEnabled, lockedByOrg };
}
