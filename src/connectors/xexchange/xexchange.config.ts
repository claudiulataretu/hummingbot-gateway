import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../connector.requests';
export namespace XExchangeConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    maximumHops: number;
    routerAbi: string;
    pairAbi: string;
    routerAddress: (network: string) => string;
    tradingTypes: Array<string>;
    availableNetworks: Array<AvailableNetworks>;
    useRouter?: boolean;
    ttl: number;
    chainType: string;
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get(
      `xexchange.allowedSlippage`,
    ),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      `xexchange.gasLimitEstimate`,
    ),
    maximumHops: ConfigManagerV2.getInstance().get(`xexchange.maximumHops`),
    tradingTypes: ['AMM'],
    routerAbi: ConfigManagerV2.getInstance().get(`xexchange.routerAbi`),
    pairAbi: ConfigManagerV2.getInstance().get(`xexchange.pairAbi`),
    routerAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        `xexchange.contractAddresses.${network}.routerAddress`,
      ),
    availableNetworks: [
      {
        chain: 'multiversx',
        networks: Object.keys(
          ConfigManagerV2.getInstance().get('xexchange.contractAddresses'),
        ).filter((network) =>
          Object.keys(
            ConfigManagerV2.getInstance().get('multiversx.networks'),
          ).includes(network),
        ),
      },
    ],
    useRouter: ConfigManagerV2.getInstance().get(`xexchange.useRouter`),
    ttl: ConfigManagerV2.getInstance().get(`xexchange.ttl`),
    chainType: 'MVX',
  };
}
