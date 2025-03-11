import { BigNumber, utils as ethersUtils } from 'ethers';
import {
  HttpException,
  LOAD_WALLET_ERROR_CODE,
  LOAD_WALLET_ERROR_MESSAGE,
  TOKEN_NOT_SUPPORTED_ERROR_CODE,
  TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
} from '../../services/error-handler';

import { logger } from '../../services/logger';
import { TokenInfo } from './multiversx-base';
import { Account } from '@multiversx/sdk-core/out';
import {
  BalanceRequest,
  CancelRequest,
  StatusRequest,
} from '../chain.requests';
import { UserSigner } from '@multiversx/sdk-wallet/out';
import { Multiversx } from './multiversx';
import { wrapResponse } from '../../services/response-wrapper';
import { PollRequest, TokensRequest } from './multiversx.routes';

export class MultiversxController {
  static getTokenSymbolsToTokens = (
    multiversx: Multiversx,
    tokenSymbols: Array<string>,
  ): Record<string, TokenInfo> => {
    const tokens: Record<string, TokenInfo> = {};

    for (let i = 0; i < tokenSymbols.length; i++) {
      const symbol = tokenSymbols[i];
      const token = multiversx.getTokenBySymbol(symbol);
      if (token) tokens[symbol] = token;
    }

    return tokens;
  };

  static async balances(multiversx: Multiversx, req: BalanceRequest) {
    const initTime = Date.now();
    let account: UserSigner;
    try {
      account = await multiversx.getWallet(req.address);
    } catch (err) {
      throw new HttpException(
        500,
        LOAD_WALLET_ERROR_MESSAGE + err,
        LOAD_WALLET_ERROR_CODE,
      );
    }
    const tokens = MultiversxController.getTokenSymbolsToTokens(
      multiversx,
      req.tokenSymbols,
    );
    const balances: Record<string, string> = {};

    if (req.network === 'mainnet_paper_trade') {
      Object.keys(tokens).forEach((symbol) => {
        balances[symbol] = ethersUtils
          .formatUnits(
            BigNumber.from(1000000).mul(
              BigNumber.from(10).pow(tokens[symbol].decimals),
            ),
            tokens[symbol].decimals,
          )
          .toString();
      });

      return wrapResponse(
        {
          balances: balances,
        },
        initTime,
      );
    }

    await Promise.all(
      Object.keys(tokens).map(async (symbol) => {
        if (tokens[symbol] !== undefined) {
          const decimals = tokens[symbol].decimals;
          // instantiate a contract and pass in provider for read-only access
          const balance: string = (
            await multiversx.getESDTBalance(
              symbol,
              new Account(account.getAddress()),
              decimals,
            )
          ).value.toString();
          balances[symbol] = ethersUtils
            .formatUnits(BigNumber.from(balance), decimals)
            .toString();
        }
      }),
    );

    if (!Object.keys(balances).length) {
      throw new HttpException(
        500,
        TOKEN_NOT_SUPPORTED_ERROR_MESSAGE,
        TOKEN_NOT_SUPPORTED_ERROR_CODE,
      );
    }

    return wrapResponse(
      {
        balances: balances,
      },
      initTime,
    );
  }

  // txStatus
  // -1: not in the mempool or failed
  // 1: succeeded
  static async poll(multiversx: Multiversx, body: PollRequest) {
    const initTime = Date.now();
    const currentBlock = await multiversx.getCurrentBlockNumber();
    const txReceipt = await multiversx.getTransaction(body.txHash);
    let txStatus = -1;

    if (typeof txReceipt.status !== 'object') {
      txStatus = 0;
      logger.info(
        `Poll ${multiversx.chain}, txHash ${body.txHash}, txReceipt ${txReceipt}.`,
      );
    }

    if (
      typeof txReceipt.status === 'object' &&
      txReceipt.status.isSuccessful()
    ) {
      txStatus = 1;
    }

    if (typeof txReceipt.status === 'object' && txReceipt.status.isPending()) {
      txStatus = 0;
    }

    if (typeof txReceipt.status === 'object' && txReceipt.status.isFailed()) {
      txStatus = -1;
    }

    logger.info(
      `Poll ${multiversx.chain}, txHash ${body.txHash}, status ${txStatus}.`,
    );
    return wrapResponse(
      {
        currentBlock,
        txHash: body.txHash,
        txStatus,
      },
      initTime,
    );
  }

  static async cancel(_multiversx: Multiversx, req: CancelRequest) {
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
      `Cancelled transaction at nonce ${req.nonce}, cancel txHash ''.`,
    );

    return wrapResponse(
      {
        txHash: '',
      },
      Date.now(),
    );
  }

  static async getTokens(multiversx: Multiversx, _req: TokensRequest) {
    const initTime = Date.now();
    let tokens: TokenInfo[] = [];

    if (!_req.tokenSymbols) {
      tokens = multiversx.storedTokenList;
    } else {
      const symbolsArray = Array.isArray(_req.tokenSymbols)
        ? _req.tokenSymbols
        : typeof _req.tokenSymbols === 'string'
          ? (_req.tokenSymbols as string).replace(/[[\]]/g, '').split(',')
          : [];

      for (const symbol of symbolsArray) {
        const token = multiversx.getTokenForSymbol(symbol.trim());
        if (token) tokens.push(token);
      }
    }
    return wrapResponse({ tokens: tokens }, initTime);
  }

  static async getStatus(multiversx: Multiversx, _req: StatusRequest) {
    const initTime = Date.now();

    const chain = 'multiversx';
    const chainId = multiversx.chainId;
    const network = multiversx.chain;
    const rpcUrl = multiversx.rpcUrl;
    const nativeCurrency = multiversx.nativeTokenSymbol;
    const currentBlockNumber = await multiversx.getCurrentBlockNumber();

    return wrapResponse(
      {
        chain,
        chainId,
        network,
        rpcUrl,
        currentBlockNumber,
        nativeCurrency,
        timestamp: initTime,
        latency: Date.now() - initTime,
      },
      initTime,
    );
  }
}
