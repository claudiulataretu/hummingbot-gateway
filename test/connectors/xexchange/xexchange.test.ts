import { Address, ResultsParser } from '@multiversx/sdk-core';
import { TradeType } from '@uniswap/sdk-core';
import BigNumber from 'bignumber.js';

import { Multiversx } from '../../../src/chains/multiversx/multiversx';
import { XExchange } from '../../../src/connectors/xexchange/xexchange';

// Explicit factory mocks to prevent ConfigManagerV2 bootstrap during module evaluation
// Using factories avoids jest evaluating the real modules to infer their shape
jest.mock('../../../src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../src/chains/multiversx/multiversx', () => ({
  Multiversx: { getInstance: jest.fn() },
}));
jest.mock('../../../src/connectors/xexchange/xexchange.config', () => ({
  XExchangeConfig: {
    config: {
      slippagePct: 1,
      gasLimitEstimate: 25000000,
      routerAbi: 'src/connectors/xexchange/router.abi.json',
      pairAbi: 'src/connectors/xexchange/pair.abi.json',
      availableNetworks: [{ chain: 'multiversx', networks: ['mainnet'] }],
    },
  },
}));

const PAIR_ADDRESS = 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq';
const WEGLD_ID = 'WEGLD-bd4d79';
const USDC_ID = 'USDC-c76f1f';

const mockWegld = { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
const mockUsdc = { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };

const mockProvider = {
  queryContract: jest.fn().mockResolvedValue({}),
  getAccount: jest.fn().mockResolvedValue({ nonce: 5 }),
  sendTransaction: jest.fn().mockResolvedValue('tx-hash-123'),
};

const mockMultiversxInstance = {
  provider: mockProvider,
  chainId: 1,
  getToken: jest.fn((name: string) => {
    if (name === 'WEGLD') return mockWegld;
    if (name === 'USDC') return mockUsdc;
    return null;
  }),
  ready: jest.fn().mockReturnValue(true),
  init: jest.fn().mockResolvedValue(undefined),
};

describe('XExchange', () => {
  let parseQueryResponseSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (XExchange as any)._instances = {};
    (Multiversx.getInstance as jest.Mock).mockResolvedValue(mockMultiversxInstance);
    mockProvider.queryContract.mockResolvedValue({});
  });

  afterEach(() => {
    parseQueryResponseSpy?.mockRestore();
  });

  describe('getInstance', () => {
    it('should create and return a singleton instance', async () => {
      const inst1 = await XExchange.getInstance('mainnet');
      const inst2 = await XExchange.getInstance('mainnet');
      expect(inst1).toBe(inst2);
    });

    it('should call Multiversx.getInstance during init', async () => {
      await XExchange.getInstance('mainnet');
      expect(Multiversx.getInstance).toHaveBeenCalledWith('mainnet');
    });

    it('should not reuse instance after manual reset', async () => {
      const inst1 = await XExchange.getInstance('mainnet');
      (XExchange as any)._instances = {};
      const inst2 = await XExchange.getInstance('mainnet');
      expect(inst1).not.toBe(inst2);
    });
  });

  describe('ready()', () => {
    it('should return true after init completes', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      expect(xexchange.ready()).toBe(true);
    });
  });

  describe('router', () => {
    it('should return the mainnet router address', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      expect(xexchange.router).toBe('erd1qqqqqqqqqqqqqpgqq66xk9gfr4esuhem3jru86wg5hvp33a62jps2fy57p');
    });
  });

  describe('gasLimitEstimate', () => {
    it('should return the configured gas limit', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      expect(xexchange.gasLimitEstimate).toBe(25000000);
    });
  });

  describe('getTokenByName', () => {
    it('should return token info from multiversx', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      const token = xexchange.getTokenByName('WEGLD');
      expect(token).toEqual(mockWegld);
      expect(mockMultiversxInstance.getToken).toHaveBeenCalledWith('WEGLD');
    });

    it('should return null for unknown token', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      const token = xexchange.getTokenByName('UNKNOWN');
      expect(token).toBeNull();
    });
  });

  describe('findDefaultPool', () => {
    it('should return the pair address from the router contract', async () => {
      const mockPairAddress = { bech32: () => PAIR_ADDRESS };
      parseQueryResponseSpy = jest
        .spyOn(ResultsParser.prototype, 'parseQueryResponse')
        .mockReturnValue({ firstValue: { valueOf: () => mockPairAddress } } as any);

      const xexchange = await XExchange.getInstance('mainnet');
      const result = await xexchange.findDefaultPool(mockWegld, mockUsdc);

      expect(mockProvider.queryContract).toHaveBeenCalledTimes(1);
      expect(result).toBe(mockPairAddress);
    });
  });

  describe('estimateSellTrade', () => {
    it('should return trade and expectedAmount for EXACT_INPUT', async () => {
      const mockPairAddress = { bech32: () => PAIR_ADDRESS };
      const amount = new BigNumber('1000000000000000000'); // 1 WEGLD in raw

      parseQueryResponseSpy = jest
        .spyOn(ResultsParser.prototype, 'parseQueryResponse')
        .mockReturnValueOnce({ firstValue: { valueOf: () => mockPairAddress } } as any) // getPair
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '150000000' }) } } as any) // getEquivalent
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '148500000' }) } } as any); // getAmountOut

      const xexchange = await XExchange.getInstance('mainnet');
      const result = await xexchange.estimateSellTrade(WEGLD_ID, USDC_ID, amount);

      expect(result.expectedAmount).toBe('148500000');
      expect(result.trade.tradeType).toBe(TradeType.EXACT_INPUT);
      expect(result.trade.inputToken).toBe(WEGLD_ID);
      expect(result.trade.outputToken).toBe(USDC_ID);
      expect(result.trade.inputAmount).toBe(amount.toFixed());
      expect(result.trade.outputAmount).toBe('148500000');
      expect(result.trade.pairAddress).toBe(mockPairAddress);
      expect(mockProvider.queryContract).toHaveBeenCalledTimes(3);
    });

    it('should calculate priceImpact correctly', async () => {
      const mockPairAddress = { bech32: () => PAIR_ADDRESS };
      const amount = new BigNumber('1000000000000000000');

      parseQueryResponseSpy = jest
        .spyOn(ResultsParser.prototype, 'parseQueryResponse')
        .mockReturnValueOnce({ firstValue: { valueOf: () => mockPairAddress } } as any)
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '150000000' }) } } as any)
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '150000000' }) } } as any); // same as initialPrice = 0% impact

      const xexchange = await XExchange.getInstance('mainnet');
      const result = await xexchange.estimateSellTrade(WEGLD_ID, USDC_ID, amount);

      expect(parseFloat(result.trade.priceImpact)).toBe(0);
    });
  });

  describe('estimateBuyTrade', () => {
    it('should return trade and expectedAmount for EXACT_OUTPUT', async () => {
      const mockPairAddress = { bech32: () => PAIR_ADDRESS };
      const amount = new BigNumber('148500000'); // desired USDC output

      parseQueryResponseSpy = jest
        .spyOn(ResultsParser.prototype, 'parseQueryResponse')
        .mockReturnValueOnce({ firstValue: { valueOf: () => mockPairAddress } } as any) // getPair
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '150000000' }) } } as any) // getEquivalent
        .mockReturnValueOnce({ firstValue: { valueOf: () => ({ toFixed: () => '1000000000000000000' }) } } as any); // getAmountIn

      const xexchange = await XExchange.getInstance('mainnet');
      const result = await xexchange.estimateBuyTrade(USDC_ID, WEGLD_ID, amount);

      expect(result.expectedAmount).toBe('1000000000000000000');
      expect(result.trade.tradeType).toBe(TradeType.EXACT_OUTPUT);
      expect(result.trade.inputToken).toBe(USDC_ID);
      expect(result.trade.outputToken).toBe(WEGLD_ID);
      expect(result.trade.outputAmount).toBe(amount.toFixed());
    });
  });

  describe('executeTrade', () => {
    const mockTrade = {
      trade: {
        pairAddress: { bech32: () => PAIR_ADDRESS },
        tradeType: TradeType.EXACT_INPUT,
        inputToken: WEGLD_ID,
        outputToken: USDC_ID,
        inputAmount: '1000000000000000000',
        outputAmount: '148500000',
      },
      expectedAmount: '148500000',
    };

    const walletAddr = Address.newFromBech32('erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu');
    const mockWallet = {
      getAddress: jest.fn().mockReturnValue(walletAddr),
    };

    it('should build and return a transaction for EXACT_INPUT', async () => {
      const xexchange = await XExchange.getInstance('mainnet');
      const tx = await xexchange.executeTrade(mockWallet as any, mockTrade);

      expect(mockProvider.getAccount).toHaveBeenCalledTimes(1);
      expect(tx).toBeDefined();
      // Transaction should be a MultiversX Transaction object
      expect(typeof tx.serializeForSigning).toBe('function');
    });

    it('should build and return a transaction for EXACT_OUTPUT', async () => {
      const buyTrade = {
        trade: {
          ...mockTrade.trade,
          tradeType: TradeType.EXACT_OUTPUT,
          inputAmount: '1000000000000000000',
          outputAmount: '148500000',
        },
        expectedAmount: '1000000000000000000',
      };

      const xexchange = await XExchange.getInstance('mainnet');
      const tx = await xexchange.executeTrade(mockWallet as any, buyTrade);

      expect(tx).toBeDefined();
      expect(typeof tx.serializeForSigning).toBe('function');
    });
  });
});
