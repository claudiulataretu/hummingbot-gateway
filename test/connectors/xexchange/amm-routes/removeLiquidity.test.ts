import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { executeRemoveLiquidity } from '../../../../src/connectors/xexchange/amm-routes/removeLiquidity';
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

// User holds ~50% of the LP supply
const USER_LP_BALANCE = new BigNumber('1936491673103708');

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
  getLpTokenBalance: jest.fn().mockResolvedValue(USER_LP_BALANCE),
  buildRemoveLiquidityTx: jest.fn().mockResolvedValue(mockTx),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
});

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { removeLiquidityRoute } = await import('../../../../src/connectors/xexchange/amm-routes/removeLiquidity');
  await server.register(removeLiquidityRoute);
  return server;
};

describe('executeRemoveLiquidity function', () => {
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

  it('should execute remove liquidity and return status 1', async () => {
    const result = await executeRemoveLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 50, 1);

    expect(result.signature).toBe(TX_HASH);
    expect(result.status).toBe(1);
    expect(result.data).toHaveProperty('baseTokenAmountRemoved');
    expect(result.data).toHaveProperty('quoteTokenAmountRemoved');
    expect(result.data.fee).toBe(0);
  });

  it('should calculate LP amount from user balance and percentage', async () => {
    // 50% of USER_LP_BALANCE
    await executeRemoveLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 50, 1);

    const callArgs = mockXExchangeInstance.buildRemoveLiquidityTx.mock.calls[0];
    const lpAmount = callArgs[3]; // 4th arg is lpAmount
    const expectedLpAmount = USER_LP_BALANCE.multipliedBy(50).dividedBy(100).integerValue();
    expect(lpAmount.toFixed()).toBe(expectedLpAmount.toFixed());
  });

  it('should return status -1 when tx not found after retries', async () => {
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (fn: () => void) => fn();

    mockMultiversxInstance.getTransaction.mockResolvedValue(null);

    const result = await executeRemoveLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 50, 1);

    expect(result.status).toBe(-1);
    expect(result.signature).toBe(TX_HASH);

    global.setTimeout = originalSetTimeout;
  }, 15000);

  it('should throw 500 when wallet not found', async () => {
    mockMultiversxInstance.getWallet.mockRejectedValue(new Error('Wallet not found'));

    await expect(
      executeRemoveLiquidity(mockFastify, WALLET_ADDRESS, 'mainnet', PAIR_ADDRESS, 50, 1),
    ).rejects.toMatchObject({ statusCode: 500 });
  });
});

describe('POST /remove-liquidity', () => {
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

  it('should return 200 on successful remove liquidity', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/remove-liquidity',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        poolAddress: PAIR_ADDRESS,
        percentageToRemove: 50,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('signature', TX_HASH);
    expect(body).toHaveProperty('status', 1);
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('baseTokenAmountRemoved');
    expect(body.data).toHaveProperty('quoteTokenAmountRemoved');
  });

  it('should return 500 on execution error', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.buildRemoveLiquidityTx.mockRejectedValue(new Error('Contract call failed'));
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'POST',
      url: '/remove-liquidity',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        poolAddress: PAIR_ADDRESS,
        percentageToRemove: 50,
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
