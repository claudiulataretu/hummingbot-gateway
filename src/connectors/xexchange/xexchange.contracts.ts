export interface xExchangeContractAddresses {
  xExchangeRouterAddress: string;
}

export interface NetworkContractAddresses {
  [network: string]: xExchangeContractAddresses;
}

export const contractAddresses: NetworkContractAddresses = {
  mainnet: {
    xExchangeRouterAddress: 'erd1qqqqqqqqqqqqqpgqq66xk9gfr4esuhem3jru86wg5hvp33a62jps2fy57p',
  },
};

export function getxExchangeRouterAddress(network: string): string {
  const address = contractAddresses[network]?.xExchangeRouterAddress;

  if (address === null) {
    throw new Error(`xExchange is not deployed on ${network} network.`);
  }

  if (!address) {
    throw new Error(`xExchange Router address not configured for network: ${network}`);
  }

  return address;
}
