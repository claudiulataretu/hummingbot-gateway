import { quoteAmmSwap } from '../../../../src/connectors/xexchange/amm-routes/quoteSwap';
import { XExchange } from '../../../../src/connectors/xexchange/xexchange';
import { fastifyWithTypeProvider } from '../../../utils/testUtils';

jest.mock('../../../../src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../../src/connectors/xexchange/xexchange', () => ({
  XExchange: { getInstance: jest.fn() },
}));
// uniswap.utils transitively loads uniswap.config → ConfigManagerV2; mock to prevent it
jest.mock('../../../../src/connectors/uniswap/uniswap.utils', () => ({
  formatTokenAmount: jest.fn((amount: string, decimals: number) => parseFloat(amount) / Math.pow(10, decimals)),
}));

const PAIR_ADDRESS = 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq';
const WEGLD_ID = 'WEGLD-bd4d79';
const USDC_ID = 'USDC-c76f1f';

const mockWegld = { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
const mockUsdc = { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };

// A sell of 1 WEGLD → 148.5 USDC
const mockSellTrade = {
  trade: {
    pairAddress: PAIR_ADDRESS,
    tradeType: 0, // EXACT_INPUT
    inputToken: WEGLD_ID,
    outputToken: USDC_ID,
    inputAmount: '1000000000000000000',
    outputAmount: '148500000',
    priceImpact: '0.1000',
  },
  expectedAmount: '148500000',
};

// A buy of 1 WEGLD → needs 150.5 USDC
const mockBuyTrade = {
  trade: {
    pairAddress: PAIR_ADDRESS,
    tradeType: 1, // EXACT_OUTPUT
    inputToken: USDC_ID,
    outputToken: WEGLD_ID,
    inputAmount: '150500000',
    outputAmount: '1000000000000000000',
    priceImpact: '0.1000',
  },
  expectedAmount: '150500000',
};

const buildMockXExchange = (sellTrade = mockSellTrade, buyTrade = mockBuyTrade) => ({
  getTokenByName: jest.fn((name: string) => {
    if (name === 'WEGLD') return mockWegld;
    if (name === 'USDC') return mockUsdc;
    return null;
  }),
  estimateSellTrade: jest.fn().mockResolvedValue(sellTrade),
  estimateBuyTrade: jest.fn().mockResolvedValue(buyTrade),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
});

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { quoteSwapRoute } = await import('../../../../src/connectors/xexchange/amm-routes/quoteSwap');
  await server.register(quoteSwapRoute);
  return server;
};

describe('quoteAmmSwap function', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return quote for SELL side', async () => {
    const mockXExchange = buildMockXExchange();
    const result = await quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'SELL');

    expect(mockXExchange.estimateSellTrade).toHaveBeenCalledWith(
      WEGLD_ID,
      USDC_ID,
      expect.objectContaining({ toFixed: expect.any(Function) }),
    );
    expect(result.estimatedAmountIn).toBeCloseTo(1, 5);
    expect(result.estimatedAmountOut).toBeCloseTo(148.5, 2);
    expect(result.rawAmountIn).toBe('1000000000000000000');
    expect(result.rawAmountOut).toBe('148500000');
  });

  it('should return quote for BUY side', async () => {
    const mockXExchange = buildMockXExchange();
    const result = await quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'BUY');

    expect(mockXExchange.estimateBuyTrade).toHaveBeenCalledWith(
      USDC_ID,
      WEGLD_ID,
      expect.objectContaining({ toFixed: expect.any(Function) }),
    );
    expect(result.estimatedAmountOut).toBeCloseTo(1, 5);
    expect(result.rawAmountOut).toBe('1000000000000000000');
  });

  it('should use provided slippagePct', async () => {
    const mockXExchange = buildMockXExchange();
    const result = await quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'SELL', 2);

    // minAmountOut should reflect 2% slippage on 148500000
    const expectedMin = 148500000 * (1 - 0.02);
    const minAmountOutRaw = parseFloat(result.rawMinAmountOut as string);
    expect(minAmountOutRaw).toBeCloseTo(expectedMin, -3);
  });

  it('should fall back to config slippage when not provided', async () => {
    const mockXExchange = buildMockXExchange();
    // config.slippagePct = 1
    const result = await quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'SELL');

    const expectedMin = 148500000 * (1 - 0.01);
    const minAmountOutRaw = parseFloat(result.rawMinAmountOut as string);
    expect(minAmountOutRaw).toBeCloseTo(expectedMin, -3);
  });

  it('should rethrow insufficient liquidity errors from xExchange contract', async () => {
    const mockXExchange = buildMockXExchange();
    const reserveError = new Error('execution failed: insufficient liquidity');
    mockXExchange.estimateSellTrade.mockRejectedValue(reserveError);

    await expect(quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'SELL')).rejects.toThrow(
      `Insufficient liquidity in pool for ${WEGLD_ID}-${USDC_ID}`,
    );
  });

  it('should rethrow generic errors', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.estimateSellTrade.mockRejectedValue(new Error('Network error'));

    await expect(quoteAmmSwap(mockXExchange as any, mockWegld, mockUsdc, 1, 'SELL')).rejects.toThrow('Network error');
  });
});

describe('GET /quote-swap', () => {
  let server: any;

  beforeAll(async () => {
    server = await buildApp();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 for SELL side', async () => {
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        baseToken: 'WEGLD',
        quoteToken: 'USDC',
        amount: '1',
        side: 'SELL',
        slippagePct: '1',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('tokenIn', 'EGLD'); // WEGLD mapped to EGLD in response
    expect(body).toHaveProperty('tokenOut', 'USDC');
    expect(body).toHaveProperty('amountIn');
    expect(body).toHaveProperty('amountOut');
    expect(body).toHaveProperty('poolAddress');
    expect(typeof body.poolAddress).toBe('string');
    expect(body).toHaveProperty('minAmountOut');
    expect(body).toHaveProperty('slippagePct', 1);
  });

  it('should return 200 for BUY side', async () => {
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        baseToken: 'WEGLD',
        quoteToken: 'USDC',
        amount: '1',
        side: 'BUY',
        slippagePct: '1',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('tokenIn', 'USDC');
    expect(body).toHaveProperty('tokenOut', 'EGLD'); // WEGLD mapped to EGLD in response
  });

  it('should map EGLD to WEGLD for baseToken', async () => {
    const mockXExchange = buildMockXExchange();
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        baseToken: 'EGLD',
        quoteToken: 'USDC',
        amount: '1',
        side: 'SELL',
      },
    });

    expect(response.statusCode).toBe(200);
    // EGLD was mapped to WEGLD before token lookup
    expect(mockXExchange.getTokenByName).toHaveBeenCalledWith('WEGLD');
  });

  it('should return 400 when baseToken is missing', async () => {
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        quoteToken: 'USDC',
        amount: '1',
        side: 'SELL',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should return 400 when token not found in list', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.getTokenByName.mockReturnValue(null);
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        baseToken: 'UNKNOWN',
        quoteToken: 'USDC',
        amount: '1',
        side: 'SELL',
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it('should return 500 on internal error', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.estimateSellTrade.mockRejectedValue(new Error('Contract error'));
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: '/quote-swap',
      query: {
        network: 'mainnet',
        baseToken: 'WEGLD',
        quoteToken: 'USDC',
        amount: '1',
        side: 'SELL',
      },
    });

    expect(response.statusCode).toBe(500);
  });
});
