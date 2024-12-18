import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { MultiversxBase } from './multiversx-base';
import { getMultiversxConfig } from './multiversx.config';
import { Account } from '@multiversx/sdk-core/out/account';
import { MultiversxController } from './multiversx.controllers';

export class Multiversx extends MultiversxBase {
  private static _instances: { [name: string]: Multiversx };
  private _gasPrice: number;
  private _nativeTokenSymbol: string;
  private _chain: string;
  public controller;

  private constructor(network: string) {
    const config = getMultiversxConfig('multiversx', network);
    super(
      'multiversx',
      config.network.chainID,
      config.network.nodeURL,
      config.network.tokenListSource,
      config.network.tokenListType,
      1000000000,
      config.gasLimitTransaction,
      ConfigManagerV2.getInstance().get('server.transactionDbPath')
    );
    this._chain = config.network.name;
    this._nativeTokenSymbol = config.nativeCurrencySymbol;
    this._gasPrice = 1000000000;

    this.controller = MultiversxController;
  }

  public static getInstance(network: string): Multiversx {
    if (Multiversx._instances === undefined) {
      Multiversx._instances = {};
    }
    if (!(network in Multiversx._instances)) {
      Multiversx._instances[network] = new Multiversx(network);
    }

    return Multiversx._instances[network];
  }

  public static getConnectedInstances(): { [name: string]: Multiversx } {
    return Multiversx._instances;
  }

  public get gasPrice(): number {
    return this._gasPrice;
  }

  public get nativeTokenSymbol(): string {
    return this._nativeTokenSymbol;
  }

  public get chain(): string {
    return this._chain;
  }

  //   getContract(tokenAddress: string, account: Account) {
  //     return new Contract(account, tokenAddress, <ContractMethods>abi);
  //   }

  getSpender(reqSpender: string): string {
    return reqSpender;
  }

  // cancel transaction
  async cancelTx(_account: Account, _nonce: number): Promise<string> {
    return '';
  }
}
