import { ConfigManagerV2 } from '../../services/config-manager-v2';

export interface MultiversxNetworkConfig {
  chainID: number;
  nodeURL: string;
  nativeCurrencySymbol: string;
  minGasPrice?: number;
  swapProvider?: string;
}

export interface MultiversxChainConfig {
  defaultNetwork: string;
  defaultWallet: string;
}

export function getMultiversxNetworkConfig(network: string): MultiversxNetworkConfig {
  const namespaceId = `multiversx-${network}`;
  return {
    chainID: ConfigManagerV2.getInstance().get(namespaceId + '.chainID'),
    nodeURL: ConfigManagerV2.getInstance().get(namespaceId + '.nodeURL'),
    nativeCurrencySymbol: ConfigManagerV2.getInstance().get(namespaceId + '.nativeCurrencySymbol'),
    minGasPrice: ConfigManagerV2.getInstance().get(namespaceId + '.minGasPrice'),
    swapProvider: ConfigManagerV2.getInstance().get(namespaceId + '.swapProvider'),
  };
}

export function getMultiversxChainConfig(): MultiversxChainConfig {
  return {
    defaultNetwork: ConfigManagerV2.getInstance().get('multiversx.defaultNetwork'),
    defaultWallet: ConfigManagerV2.getInstance().get('multiversx.defaultWallet'),
  };
}
