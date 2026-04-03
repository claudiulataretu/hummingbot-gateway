import { AvailableNetworks } from '#src/services/base';

import { ConfigManagerV2 } from '../../services/config-manager-v2';

export namespace XExchangeConfig {
  // Supported networks for xExchange
  export const chain = 'multiversx';
  export const networks = ['mainnet'];
  export type Network = string;

  // Supported trading types
  export const tradingTypes = ['amm'] as const;

  export interface RootConfig {
    // Global configuration
    slippagePct: number;
    gasLimitEstimate: number;
    routerAbi: string;
    pairAbi: string;

    // Available networks
    availableNetworks: Array<AvailableNetworks>;
  }

  export const config: RootConfig = {
    slippagePct: ConfigManagerV2.getInstance().get('xexchange.slippagePct'),
    gasLimitEstimate: ConfigManagerV2.getInstance().get('xexchange.gasLimitEstimate'),
    routerAbi: ConfigManagerV2.getInstance().get('xexchange.routerAbi'),
    pairAbi: ConfigManagerV2.getInstance().get('xexchange.pairAbi'),

    availableNetworks: [
      {
        chain,
        networks: networks,
      },
    ],
  };
}
