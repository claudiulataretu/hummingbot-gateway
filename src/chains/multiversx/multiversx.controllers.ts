import { BigNumber, utils as ethersUtils } from 'ethers';
import {
  HttpException,
  LOAD_WALLET_ERROR_CODE,
  LOAD_WALLET_ERROR_MESSAGE,
  TOKEN_NOT_SUPPORTED_ERROR_CODE,
  TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
} from '../../services/error-handler';

import { logger } from '../../services/logger';
import { Multiversxish } from '../../services/common-interfaces';
import { TokenInfo } from './multiversx-base';
import { BalanceRequest, PollRequest } from '../../network/network.requests';
import { Account } from '@multiversx/sdk-core/out';
import { CancelRequest } from '../chain.requests';
import { UserSigner } from '@multiversx/sdk-wallet/out';

export class MultiversxController {
  static getTokenSymbolsToTokens = (
    multiversxish: Multiversxish,
    tokenSymbols: Array<string>
  ): Record<string, TokenInfo> => {
    const tokens: Record<string, TokenInfo> = {};

    for (let i = 0; i < tokenSymbols.length; i++) {
      const symbol = tokenSymbols[i];
      const token = multiversxish.getTokenBySymbol(symbol);
      if (token) tokens[symbol] = token;
    }

    return tokens;
  };

  static async balances(multiversxish: Multiversxish, req: BalanceRequest) {
    let account: UserSigner;
    try {
      account = await multiversxish.getWallet(req.address);
    } catch (err) {
      throw new HttpException(
        500,
        LOAD_WALLET_ERROR_MESSAGE + err,
        LOAD_WALLET_ERROR_CODE
      );
    }
    const tokens = MultiversxController.getTokenSymbolsToTokens(
      multiversxish,
      req.tokenSymbols
    );
    const balances: Record<string, string> = {};
    // if (req.tokenSymbols.includes(multiversxish.nativeTokenSymbol)) {
    //   balances[multiversxish.nativeTokenSymbol] = (
    //     await multiversxish.getNativeBalance(new Account(account.getAddress()))
    //   ).value.toString();
    // }

    if (req.network === 'mainnet_paper_trade') {
      Object.keys(tokens).forEach((symbol) => {
        balances[symbol] = ethersUtils
          .formatUnits(
            BigNumber.from(1000000).mul(
              BigNumber.from(10).pow(tokens[symbol].decimals)
            ),
            tokens[symbol].decimals
          )
          .toString();
      });

      return {
        balances: balances,
      };
    }

    await Promise.all(
      Object.keys(tokens).map(async (symbol) => {
        if (tokens[symbol] !== undefined) {
          const decimals = tokens[symbol].decimals;
          // instantiate a contract and pass in provider for read-only access
          const balance: string = (
            await multiversxish.getESDTBalance(
              symbol,
              new Account(account.getAddress()),
              decimals
            )
          ).value.toString();
          balances[symbol] = ethersUtils
            .formatUnits(BigNumber.from(balance), decimals)
            .toString();
        }
      })
    );

    if (!Object.keys(balances).length) {
      throw new HttpException(
        500,
        TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
        TOKEN_NOT_SUPPORTED_ERROR_CODE
      );
    }

    return {
      balances: balances,
    };
  }

  // txStatus
  // -1: not in the mempool or failed
  // 1: succeeded
  static async poll(multiversxish: Multiversxish, body: PollRequest) {
    const currentBlock = await multiversxish.getCurrentBlockNumber();
    const txReceipt = await multiversxish.getTransaction(body.txHash);
    let txStatus = -1;
    if (
      typeof txReceipt.status === 'object' &&
      txReceipt.status.isSuccessful()
    ) {
      txStatus = 1;
    }

    logger.info(
      `Poll ${multiversxish.chain}, txHash ${body.txHash}, status ${txStatus}.`
    );
    return {
      currentBlock,
      txHash: body.txHash,
      txStatus,
      txReceipt,
    };
  }

  static async cancel(_multiversxish: Multiversxish, req: CancelRequest) {
    // let account: Account;
    // try {
    //   account = await nearish.getWallet(req.address);
    // } catch (err) {
    //   throw new HttpException(
    //     500,
    //     LOAD_WALLET_ERROR_MESSAGE + err,
    //     LOAD_WALLET_ERROR_CODE
    //   );
    // }

    // // call cancelTx function
    // const cancelTx = await nearish.cancelTx(account, req.nonce);

    logger.info(
      `Cancelled transaction at nonce ${req.nonce}, cancel txHash ''.`
    );

    return {
      txHash: '',
    };
  }
}
