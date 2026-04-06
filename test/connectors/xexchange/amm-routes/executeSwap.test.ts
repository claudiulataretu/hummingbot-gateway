import { Multiversx } from '../../../../src/chains/multiversx/multiversx';
import { executeAmmSwap } from '../../../../src/connectors/xexchange/amm-routes/executeSwap';
import { quoteAmmSwap } from '../../../../src/connectors/xexchange/amm-routes/quoteSwap';
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

const PAIR_ADDRESS = 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq';
const WALLET_ADDRESS = 'erd1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6gq4hu';
const WEGLD_ID = 'WEGLD-bd4d79';
const USDC_ID = 'USDC-c76f1f';
const TX_HASH = 'abc123def456';

const mockWegld = { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
const mockUsdc = { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };

const mockSuccessfulTx = {
  status: {
    isPending: jest.fn().mockReturnValue(false),
    isExecuted: jest.fn().mockReturnValue(true),
    isSuccessful: jest.fn().mockReturnValue(true),
  },
};

const mockQuote = {
  poolAddress: PAIR_ADDRESS,
  inputToken: mockWegld,
  outputToken: mockUsdc,
  estimatedAmountIn: 1,
  estimatedAmountOut: 148.5,
  rawAmountIn: '1000000000000000000',
  rawAmountOut: '148500000',
  rawMinAmountOut: '146835000',
  rawMaxAmountIn: '1010000000000000000',
  priceImpact: '0.1000',
  minAmountOut: 146.835,
  maxAmountIn: 1.01,
};

const mockTx = {
  serializeForSigning: jest.fn().mockReturnValue(Buffer.from('mock-tx')),
  applySignature: jest.fn(),
};

const mockWallet = {
  sign: jest.fn().mockResolvedValue(new Uint8Array(64)),
  getAddress: jest.fn().mockReturnValue({ toBech32: () => WALLET_ADDRESS }),
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
    if (name === 'WEGLD') return mockWegld;
    if (name === 'USDC') return mockUsdc;
    return null;
  }),
  findDefaultPool: jest.fn().mockResolvedValue(PAIR_ADDRESS),
  executeTrade: jest.fn().mockResolvedValue(mockTx),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
});

jest.mock('../../../../src/connectors/xexchange/amm-routes/quoteSwap', () => ({
  quoteAmmSwap: jest.fn(),
}));

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { executeSwapRoute } = await import('../../../../src/connectors/xexchange/amm-routes/executeSwap');
  await server.register(executeSwapRoute);
  return server;
};

describe('executeAmmSwap function', () => {
  let mockFastify: any;
  let mockMultiversxInstance: any;
  let mockXExchangeInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockMultiversxInstance = buildMockMultiversx();
    mockXExchangeInstance = buildMockXExchange();

    (Multiversx.getInstance as jest.Mock).mockResolvedValue(mockMultiversxInstance);
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchangeInstance);
    (quoteAmmSwap as jest.Mock).mockResolvedValue(mockQuote);

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

  it('should execute SELL swap and return success status', async () => {
    const result = await executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'SELL', 1);

    expect(result.signature).toBe(TX_HASH);
    expect(result.status).toBe(1);
    expect(result.data.tokenIn).toBe('EGLD'); // WEGLD mapped to EGLD in response
    expect(result.data.tokenOut).toBe('USDC');
    expect(result.data.amountIn).toBe(1);
    expect(result.data.amountOut).toBe(148.5);
  });

  it('should execute BUY swap and return success status', async () => {
    const result = await executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'BUY', 1);

    expect(result.signature).toBe(TX_HASH);
    expect(result.status).toBe(1);
  });

  it('should return status -1 when transaction fails', async () => {
    mockMultiversxInstance.getTransaction.mockResolvedValue({
      status: {
        isPending: jest.fn().mockReturnValue(false),
        isExecuted: jest.fn().mockReturnValue(true),
        isSuccessful: jest.fn().mockReturnValue(false),
      },
    });

    const result = await executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'SELL', 1);

    expect(result.status).toBe(-1);
  });

  it('should return status -1 when tx not found after retries', async () => {
    // Skip retry delays
    const originalSetTimeout = global.setTimeout;
    (global as any).setTimeout = (fn: () => void) => fn();

    mockMultiversxInstance.getTransaction.mockResolvedValue(null);

    const result = await executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'SELL', 1);

    expect(result.status).toBe(-1);
    expect(result.signature).toBe(TX_HASH);

    global.setTimeout = originalSetTimeout;
  }, 15000);

  it('should throw 500 when wallet not found', async () => {
    mockMultiversxInstance.getWallet.mockRejectedValue(new Error('Wallet not found for address'));

    await expect(
      executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'SELL', 1),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('should throw 400 on insufficient funds error', async () => {
    mockXExchangeInstance.executeTrade.mockRejectedValue(new Error('insufficient funds for transaction'));

    await expect(
      executeAmmSwap(mockFastify, WALLET_ADDRESS, 'mainnet', 'WEGLD', 'USDC', 1, 'SELL', 1),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('POST /execute-swap', () => {
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
    (quoteAmmSwap as jest.Mock).mockResolvedValue(mockQuote);
  });

  it('should return 200 on successful SELL swap', async () => {
    const response = await server.inject({
      method: 'POST',
      url: '/execute-swap',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        baseToken: 'WEGLD',
        quoteToken: 'USDC',
        amount: 1,
        side: 'SELL',
        slippagePct: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('signature', TX_HASH);
    expect(body).toHaveProperty('status', 1);
    expect(body).toHaveProperty('data');
    expect(body.data).toHaveProperty('tokenIn');
    expect(body.data).toHaveProperty('tokenOut');
    expect(body.data).toHaveProperty('amountIn');
    expect(body.data).toHaveProperty('amountOut');
  });

  it('should map EGLD to WEGLD in request body', async () => {
    const mockXExchange = buildMockXExchange();
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'POST',
      url: '/execute-swap',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        baseToken: 'EGLD',
        quoteToken: 'USDC',
        amount: 1,
        side: 'SELL',
        slippagePct: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockXExchange.getTokenByName).toHaveBeenCalledWith('WEGLD');
  });

  it('should return 500 on execution error', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.executeTrade.mockRejectedValue(new Error('Contract call failed'));
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'POST',
      url: '/execute-swap',
      payload: {
        network: 'mainnet',
        walletAddress: WALLET_ADDRESS,
        baseToken: 'WEGLD',
        quoteToken: 'USDC',
        amount: 1,
        side: 'SELL',
        slippagePct: 1,
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
