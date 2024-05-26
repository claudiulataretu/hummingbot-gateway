import express from 'express';
import { Express } from 'express-serve-static-core';
import request from 'supertest';
import { UniswapLP } from '../../../src/connectors/uniswap/uniswap.lp';
import { AmmLiquidityRoutes } from '../../../src/amm/amm.routes';
import { patch, unpatch } from '../../../test/services/patch';
import { patchEVMNonceManager } from '../../evm.nonce.mock';
import {BinanceSmartChain} from "../../../src/chains/binance-smart-chain/binance-smart-chain";

let app: Express;
let binanceSmartChain: BinanceSmartChain;
let uniswap: UniswapLP;

beforeAll(async () => {
  app = express();
  app.use(express.json());
  binanceSmartChain = BinanceSmartChain.getInstance('mainnet');
  patchEVMNonceManager(binanceSmartChain.nonceManager);
  await binanceSmartChain.init();

  uniswap = UniswapLP.getInstance('binance-smart-chain', 'mainnet');
  await uniswap.init();
  app.use('/amm/liquidity', AmmLiquidityRoutes.router);
});

beforeEach(() => {
  patchEVMNonceManager(binanceSmartChain.nonceManager);
});

afterEach(() => {
  unpatch();
});

afterAll(async () => {
  await binanceSmartChain.close();
});

const address: string = '0x242532ebDfcc760f2Ddfe8378eB51f5F847CE5bD';

const patchGetWallet = () => {
  patch(binanceSmartChain, 'getWallet', () => {
    return {
      address: address,
    };
  });
};

const patchInit = () => {
  patch(uniswap, 'init', async () => {
    return;
  });
};

const patchStoredTokenList = () => {
  patch(binanceSmartChain, 'tokenList', () => {
    return [
      {
        chainId: 56,
        name: 'WBNB',
        symbol: 'WBNB',
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        decimals: 18,
      },
      {
        chainId: 56,
        name: 'DAI',
        symbol: 'DAI',
        address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
        decimals: 18,
      },
    ];
  });
};

const patchGetTokenBySymbol = () => {
  patch(binanceSmartChain, 'getTokenBySymbol', (symbol: string) => {
    if (symbol === 'WBNB') {
      return {
        chainId: 56,
        name: 'WBNB',
        symbol: 'WBNB',
        address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
        decimals: 18,
      };
    } else {
      return {
        chainId: 56,
        name: 'DAI',
        symbol: 'DAI',
        address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3',
        decimals: 18,
      };
    }
  });
};

const patchGetTokenByAddress = () => {
  patch(uniswap, 'getTokenByAddress', () => {
    return {
      chainId: 56,
      name: 'WBNB',
      symbol: 'WBNB',
      address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
      decimals: 18,
    };
  });
};

const patchGasPrice = () => {
  patch(binanceSmartChain, 'gasPrice', () => 100);
};

const patchGetNonce = () => {
  patch(binanceSmartChain.nonceManager, 'getNonce', () => 21);
};

const patchAddPosition = () => {
  patch(uniswap, 'addPosition', () => {
    return { nonce: 21, hash: '000000000000000' };
  });
};

const patchRemovePosition = () => {
  patch(uniswap, 'reducePosition', () => {
    return { nonce: 21, hash: '000000000000000' };
  });
};

const patchCollectFees = () => {
  patch(uniswap, 'collectFees', () => {
    return { nonce: 21, hash: '000000000000000' };
  });
};

const patchPosition = () => {
  patch(uniswap, 'getPosition', () => {
    return {
      token0: 'DAI',
      token1: 'WBNB',
      fee: 300,
      lowerPrice: '1',
      upperPrice: '5',
      amount0: '1',
      amount1: '1',
      unclaimedToken0: '1',
      unclaimedToken1: '1',
    };
  });
};

describe('POST /liquidity/add', () => {
  it('should return 200 when all parameter are OK', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();
    patchGasPrice();
    patchAddPosition();
    patchGetNonce();

    await request(app)
      .post(`/amm/liquidity/add`)
      .send({
        address: address,
        token0: 'DAI',
        token1: 'WBNB',
        amount0: '1',
        amount1: '1',
        fee: 'LOW',
        lowerPrice: '1',
        upperPrice: '5',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(200);
  });

  it('should return 500 for unrecognized token0 symbol', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();

    await request(app)
      .post(`/amm/liquidity/add`)
      .send({
        address: address,
        token0: 'DOGE',
        token1: 'WBNB',
        amount0: '1',
        amount1: '1',
        fee: 'LOW',
        lowerPrice: '1',
        upperPrice: '5',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(500);
  });

  it('should return 404 for invalid fee tier', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();

    await request(app)
      .post(`/amm/liquidity/add`)
      .send({
        address: address,
        token0: 'DAI',
        token1: 'WBNB',
        amount0: '1',
        amount1: '1',
        fee: 300,
        lowerPrice: '1',
        upperPrice: '5',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(404);
  });

  it('should return 500 when the helper operation fails', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();
    patch(uniswap, 'addPositionHelper', () => {
      return 'error';
    });

    await request(app)
      .post(`/amm/liquidity/add`)
      .send({
        address: address,
        token0: 'DAI',
        token1: 'WBNB',
        amount0: '1',
        amount1: '1',
        fee: 'LOW',
        lowerPrice: '1',
        upperPrice: '5',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(500);
  });
});

describe('POST /liquidity/remove', () => {
  const patchForBuy = () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();
    patchGasPrice();
    patchRemovePosition();
    patchGetNonce();
  };
  it('should return 200 when all parameter are OK', async () => {
    patchForBuy();
    await request(app)
      .post(`/amm/liquidity/remove`)
      .send({
        address: address,
        tokenId: 2732,
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(200);
  });

  it('should return 404 when the tokenId is invalid', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();

    await request(app)
      .post(`/amm/liquidity/remove`)
      .send({
        address: address,
        tokenId: 'Invalid',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(404);
  });
});

describe('POST /liquidity/collect_fees', () => {
  const patchForBuy = () => {
    patchGetWallet();
    patchInit();
    patchGasPrice();
    patchCollectFees();
    patchGetNonce();
  };
  it('should return 200 when all parameter are OK', async () => {
    patchForBuy();
    await request(app)
      .post(`/amm/liquidity/collect_fees`)
      .send({
        address: address,
        tokenId: 2732,
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(200);
  });

  it('should return 404 when the tokenId is invalid', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();

    await request(app)
      .post(`/amm/liquidity/collect_fees`)
      .send({
        address: address,
        tokenId: 'Invalid',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(404);
  });
});

describe('POST /liquidity/position', () => {
  it('should return 200 when all parameter are OK', async () => {
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();
    patchPosition();

    await request(app)
      .post(`/amm/liquidity/position`)
      .send({
        tokenId: 2732,
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(200);
  });

  it('should return 404 when the tokenId is invalid', async () => {
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();

    await request(app)
      .post(`/amm/liquidity/position`)
      .send({
        tokenId: 'Invalid',
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(404);
  });
});

describe('POST /liquidity/price', () => {
  const patchForBuy = () => {
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();
    patch(uniswap, 'poolPrice', () => {
      return ['100', '105'];
    });
  };
  it('should return 200 when all parameter are OK', async () => {
    patchForBuy();
    await request(app)
      .post(`/amm/liquidity/price`)
      .send({
        token0: 'DAI',
        token1: 'WBNB',
        fee: 'LOW',
        period: 120,
        interval: 60,
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(200);
  });

  it('should return 404 when the fee is invalid', async () => {
    patchGetWallet();
    patchInit();
    patchStoredTokenList();
    patchGetTokenBySymbol();
    patchGetTokenByAddress();

    await request(app)
      .post(`/amm/liquidity/price`)
      .send({
        token0: 'DAI',
        token1: 'WBNB',
        fee: 11,
        period: 120,
        interval: 60,
        chain: 'binance-smart-chain',
        network: 'mainnet',
        connector: 'uniswapLP',
      })
      .set('Accept', 'application/json')
      .expect(404);
  });
});
