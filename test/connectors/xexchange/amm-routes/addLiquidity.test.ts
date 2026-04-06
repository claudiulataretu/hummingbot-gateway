import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { executeAddLiquidity } from '../../../../src/connectors/xexchange/amm-routes/addLiquidity';
import { XExchange } from '../../../../src/connectors/xexchange/xexchange';
import { fastifyWithTypeProvider } from '../../../utils/testUtils';

jest.mock('../../../../src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../../src/chains/multiversx/multiversx', () => ({
  Multiversx: { getInstance: jest.fn() },
}));
jest.mock('../../../../src/connectors/xexchange/xexchange', () => ({
  XExchange: { getInstance: jest.fn() },
}));
jest.mock('../../../../src/chains/multiversx/multiversx.config', () => ({
  getMultiversxChainConfig: jest.fn().mockReturnValue({
    defaultNetwork: 'mainnet',
    defaultWallet: 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu',
  }),
}));
jest.mock('../../../../src/connectors/uniswap/uniswap.utils', () => ({
  formatTokenAmount: jest.fn((amount: string, decimals: number) => parseFloat(amount) / Math.pow(10, decimals)),
}));

const PAIR_ADDRESS = 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq';
const WALLET_ADDRESS = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';
const WEGLD_ID = 'WEGLD-bd4d79';
const USDC_ID = 'USDC-c76f1f';
const LP_TOKEN_ID = 'EGLDUSDC-594e5e';
const TX_HASH = 'abc123def456';

const mockWegld = { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
const mockUsdc = { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };

const BigNumber = require('bignumber.js').BigNumber;

const mockPoolData = {
  firstTokenId: WEGLD_ID,
  secondTokenId: USDC_ID,
  firstReserve: new BigNumber('10000000000000000000'), // 10 WEGLD
  secondReserve: new BigNumber('1500000000'), // 1500 USDC
  lpSupply: new BigNumber('3872983346207417'),
  lpTokenId: LP_TOKEN_ID,
  totalFeePercent: 300,
};

const mockTx = {
  serializeForSigning: jest.fn().mockReturnValue(Buffer.from('mock-tx')),
  applySignature: jest.fn(),
};

const mockWallet = {
  sign: jest.fn().mockResolvedValue(new Uint8Array(64)),
  getAddress: jest.fn().mockReturnValue({ toBech32: () => WALLET_ADDRESS }),
};

const mockSuccessfulTx = {
  status: {
    isPending: jest.fn().mockReturnValue(false),
    isExecuted: jest.fn().mockReturnValue(true),
    isSuccessful: jest.fn().mockReturnValue(true),
  },
};

const buildMockMultiversx = () => ({
  ready: jest.fn().mockReturnValue(true),
  init: jest.fn().mockResolvedValue(undefined),
  getWallet: jest.fn().mockResolvedValue(mockWallet),
  provider: {
    sendTransaction: jest.fn().mockResolvedValue(TX_HASH),
    getAccount: jest.fn().mockResolvedValue({ nonce: 0 }),
  },
  getTransaction: jest.fn().mockResolvedValue(mockSuccessfulTx),
});

const buildMockXExchange = () => ({
  getTokenByName: jest.fn((name: string) => {
    if (name === WEGLD_ID) return mockWegld;
    if (name === USDC_ID) return mockUsdc;
    return null;
  }),
  getPoolData: jest.fn().mockResolvedValue(mockPoolData),
  buildAddLiquidityTx: jest.fn().mockResolvedValue(mockTx),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
});

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { addLiquidityRoute } = await import('../../../../src/connectors/xexchange/amm-routes/addLiquidity');
  await server.register(addLiquidityRoute);
  return server;
};

describe('executeAddLiquidity function', () => {
  let mockFastify: any;
  let mockMultiversxInstance: any;
  let mockXExchangeInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMultiversxInstance = buildMockMultiversx();
    mockXExchangeInstance = buildMockXExchange();

    (Multiversx.getInstance as jest.Mock).mockResolvedValue(mockMultiversxInstance);
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchangeInstance);

    mockFastify = {
      httpErrors: {
        internalServerError: jest.fn((msg: string) => {
          const e = new Error(msg) as any;
          e.statusCode = 500;
          return e;
        }),
        badRequest: jest.fn((msg: string) => {
          const e = new Error(msg) as any;
          e.statusCode = 400;
          return e;
        }),
      },
    };
  });

  it('should execute add liquidity and return status 1 on success', async () => {
    const result = await executeAddLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 1, 150, 1);

    expect(result.signature).toBe(TX_HASH);
    expect(result.status).toBe(1);
    expect(result.data).toHaveProperty('baseTokenAmountAdded');
    expect(result.data).toHaveProperty('quoteTokenAmountAdded');
    expect(result.data.fee).toBe(0);
  });

  it('should call buildAddLiquidityTx with ratio-limited amounts (base limiting)', async () => {
    // Pool ratio: 10 WEGLD : 1500 USDC => 1 WEGLD : 150 USDC
    // User provides 1 WEGLD (base), 200 USDC (quote) => base is limiting, optimal quote = 150 USDC
    await executeAddLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 1, 200, 1);

    const callArgs = mockXExchangeInstance.buildAddLiquidityTx.mock.calls[0];
    // buildAddLiquidityTx args: wallet, pairAddress, firstTokenId, firstAmount, secondTokenId, secondAmount, ...
    // secondAmount is at index 5
    const secondActual = callArgs[5];
    expect(parseFloat(secondActual.toFixed())).toBeCloseTo(150_000_000, -3);
  });

  it('should return status -1 when tx not found after retries', async () => {
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (fn: () => void) => fn();

    mockMultiversxInstance.getTransaction.mockResolvedValue(null);

    const result = await executeAddLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 1, 150, 1);

    expect(result.status).toBe(-1);
    expect(result.signature).toBe(TX_HASH);

    global.setTimeout = originalSetTimeout;
  }, 15000);

  it('should throw 500 when wallet not found', async () => {
    mockMultiversxInstance.getWallet.mockRejectedValue(new Error('Wallet not found'));

    await expect(
      executeAddLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 1, 150, 1),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('should throw 400 on insufficient funds', async () => {
    mockXExchangeInstance.buildAddLiquidityTx.mockRejectedValue(new Error('insufficient funds for transaction'));

    await expect(
      executeAddLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 1, 150, 1),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('POST /add-liquidity', () => {
  let server: any;

  beforeAll(async () => {
    server = await buildApp();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (Multiversx.getInstance as jest.Mock).mockResolvedValue(buildMockMultiversx());
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());
  });

  it('should return 200 on successful add liquidity', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/add-liquidity',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        poolAddress: PAIR_ADDRESS,
        baseTokenAmount: 1,
        quoteTokenAmount: 150,
        slippagePct: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('signature', TX_HASH);
    expect(body).toHaveProperty('status', 1);
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('baseTokenAmountAdded');
    expect(body.data).toHaveProperty('quoteTokenAmountAdded');
  });

  it('should return 500 on execution error', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.buildAddLiquidityTx.mockRejectedValue(new Error('Contract call failed'));
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'POST',
      url: '/add-liquidity',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        poolAddress: PAIR_ADDRESS,
        baseTokenAmount: 1,
        quoteTokenAmount: 150,
        slippagePct: 1,
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
