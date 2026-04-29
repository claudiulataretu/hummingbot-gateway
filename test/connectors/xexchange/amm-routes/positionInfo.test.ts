import { getPositionInfo } from '../../../../src/connectors/xexchange/amm-routes/positionInfo';
import { XExchange } from '../../../../src/connectors/xexchange/xexchange';
import { fastifyWithTypeProvider } from '../../../utils/testUtils';

jest.mock('../../../../src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
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

const BigNumber = require('bignumber.js').BigNumber;

// Pool: 10 WEGLD + 1500 USDC, price = 150 USDC/WEGLD
const LP_SUPPLY = new BigNumber('3872983346207417');
const mockPoolData = {
  firstTokenId: WEGLD_ID,
  secondTokenId: USDC_ID,
  firstReserve: new BigNumber('10000000000000000000'), // 10 WEGLD (18 dec)
  secondReserve: new BigNumber('1500000000'), // 1500 USDC (6 dec)
  lpSupply: LP_SUPPLY,
  lpTokenId: LP_TOKEN_ID,
  totalFeePercent: 300,
};

const buildMockXExchange = (overrides: Record<string, any> = {}) => ({
  getTokenByName: jest.fn((name: string) => {
    if (name === 'WEGLD') return { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
    if (name === 'USDC') return { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };
    return null;
  }),
  getPoolData: jest.fn().mockResolvedValue(mockPoolData),
  getLpTokenBalance: jest.fn().mockResolvedValue(new BigNumber(0)),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
  ...overrides,
});

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { positionInfoRoute } = await import('../../../../src/connectors/xexchange/amm-routes/positionInfo');
  await server.register(positionInfoRoute);
  return server;
};

describe('getPositionInfo function', () => {
  let mockFastify: any;
  let mockXExchangeInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockXExchangeInstance = buildMockXExchange();
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchangeInstance);
    mockFastify = {
      httpErrors: {
        badRequest: jest.fn((msg: string) => {
          const e = new Error(msg) as any;
          e.statusCode = 400;
          return e;
        }),
        internalServerError: jest.fn((msg: string) => {
          const e = new Error(msg) as any;
          e.statusCode = 500;
          return e;
        }),
      },
    };
  });

  it('returns formatted position when wallet holds LP tokens (half of supply)', async () => {
    const halfSupply = LP_SUPPLY.dividedToIntegerBy(2);
    mockXExchangeInstance.getLpTokenBalance.mockResolvedValue(halfSupply);

    const result = await getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS);

    expect(result.poolAddress).toBe(PAIR_ADDRESS);
    expect(result.walletAddress).toBe(WALLET_ADDRESS);
    expect(result.baseTokenAddress).toBe(WEGLD_ID);
    expect(result.quoteTokenAddress).toBe(USDC_ID);
    expect(result.baseTokenAmount).toBeCloseTo(5, 1); // ~5 WEGLD
    expect(result.quoteTokenAmount).toBeCloseTo(750, 0); // ~750 USDC
    expect(result.price).toBeCloseTo(150, 0); // 1500 USDC / 10 WEGLD
    expect(result.lpTokenAmount).toBeGreaterThan(0);
  });

  it('returns zeros when wallet has no LP balance', async () => {
    mockXExchangeInstance.getLpTokenBalance.mockResolvedValue(new BigNumber(0));

    const result = await getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS);

    expect(result.lpTokenAmount).toBe(0);
    expect(result.baseTokenAmount).toBe(0);
    expect(result.quoteTokenAmount).toBe(0);
    expect(result.price).toBe(0);
    expect(result.baseTokenAddress).toBe(WEGLD_ID);
    expect(result.quoteTokenAddress).toBe(USDC_ID);
    // getPoolData must still be called to resolve token addresses
    expect(mockXExchangeInstance.getPoolData).toHaveBeenCalledWith(PAIR_ADDRESS);
  });

  it('returns zeros when lpSupply is zero (empty pool guard)', async () => {
    const emptyPoolData = { ...mockPoolData, lpSupply: new BigNumber(0) };
    mockXExchangeInstance.getPoolData.mockResolvedValue(emptyPoolData);
    // Give wallet a non-zero LP balance to confirm the lpSupply guard fires
    mockXExchangeInstance.getLpTokenBalance.mockResolvedValue(new BigNumber('1000000000000000'));

    const result = await getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS);

    expect(result.lpTokenAmount).toBe(0);
    expect(result.baseTokenAmount).toBe(0);
    expect(result.quoteTokenAmount).toBe(0);
    expect(result.price).toBe(0);
  });

  it('throws 400 when poolAddress is empty', async () => {
    await expect(getPositionInfo(mockFastify, 'mainnet', '', WALLET_ADDRESS)).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockXExchangeInstance.getPoolData).not.toHaveBeenCalled();
  });

  it('throws 400 when walletAddress is empty', async () => {
    await expect(getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, '')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(mockXExchangeInstance.getPoolData).not.toHaveBeenCalled();
  });

  it('throws 400 when getLpTokenBalance rejects with a bech32 error', async () => {
    mockXExchangeInstance.getLpTokenBalance.mockRejectedValue(new Error('bech32 decode failed: invalid character'));

    await expect(
      getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, 'not-a-valid-erd-address'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 500 when getPoolData rejects', async () => {
    mockXExchangeInstance.getPoolData.mockRejectedValue(new Error('rpc connection failed'));

    await expect(getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS)).rejects.toMatchObject({
      statusCode: 500,
    });
  });

  it('defaults decimals to 18 when token is not in local list', async () => {
    // getTokenByName returns null for all tokens — decimals should fall back to 18
    mockXExchangeInstance.getTokenByName.mockReturnValue(null);
    const halfSupply = LP_SUPPLY.dividedToIntegerBy(2);
    mockXExchangeInstance.getLpTokenBalance.mockResolvedValue(halfSupply);

    const result = await getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS);

    // With 18 decimal default both reserves are scaled by 1e18; amounts still > 0
    expect(result.baseTokenAmount).toBeGreaterThan(0);
    expect(result.quoteTokenAmount).toBeGreaterThan(0);
    expect(result.lpTokenAmount).toBeGreaterThan(0);
  });

  it('re-throws errors that already have a statusCode', async () => {
    const existingError = new Error('already handled') as any;
    existingError.statusCode = 422;
    mockXExchangeInstance.getPoolData.mockRejectedValue(existingError);

    await expect(getPositionInfo(mockFastify, 'mainnet', PAIR_ADDRESS, WALLET_ADDRESS)).rejects.toMatchObject({
      statusCode: 422,
    });
  });
});

describe('GET /position-info', () => {
  let server: any;

  beforeAll(async () => {
    server = await buildApp();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());
  });

  it('returns 200 with full body for a wallet with LP tokens', async () => {
    const halfSupply = LP_SUPPLY.dividedToIntegerBy(2);
    const mockXExchange = buildMockXExchange({
      getLpTokenBalance: jest.fn().mockResolvedValue(halfSupply),
    });
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: `/position-info?poolAddress=${PAIR_ADDRESS}&walletAddress=${WALLET_ADDRESS}&network=mainnet`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('poolAddress', PAIR_ADDRESS);
    expect(body).toHaveProperty('walletAddress', WALLET_ADDRESS);
    expect(body).toHaveProperty('baseTokenAddress', WEGLD_ID);
    expect(body).toHaveProperty('quoteTokenAddress', USDC_ID);
    expect(body).toHaveProperty('lpTokenAmount');
    expect(body).toHaveProperty('baseTokenAmount');
    expect(body).toHaveProperty('quoteTokenAmount');
    expect(body).toHaveProperty('price');
    expect(body.baseTokenAmount).toBeCloseTo(5, 1);
    expect(body.quoteTokenAmount).toBeCloseTo(750, 0);
  });

  it('returns 200 with zeros for a wallet with no LP tokens', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/position-info?poolAddress=${PAIR_ADDRESS}&walletAddress=${WALLET_ADDRESS}&network=mainnet`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.lpTokenAmount).toBe(0);
    expect(body.baseTokenAmount).toBe(0);
    expect(body.quoteTokenAmount).toBe(0);
    expect(body.price).toBe(0);
  });

  it('returns 400 when poolAddress is missing', async () => {
    const response = await server.inject({
      method: 'GET',
      url: `/position-info?walletAddress=${WALLET_ADDRESS}&network=mainnet`,
    });

    expect(response.statusCode).toBe(400);
  });

  it('defaults network and walletAddress from config when omitted', async () => {
    const mockXExchange = buildMockXExchange();
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: `/position-info?poolAddress=${PAIR_ADDRESS}`,
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    // walletAddress should be the defaultWallet from getMultiversxChainConfig
    expect(body.walletAddress).toBe(WALLET_ADDRESS);
    expect(mockXExchange.getPoolData).toHaveBeenCalledWith(PAIR_ADDRESS);
  });

  it('returns 500 on internal error', async () => {
    const mockXExchange = buildMockXExchange({
      getPoolData: jest.fn().mockRejectedValue(new Error('rpc timeout')),
    });
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: `/position-info?poolAddress=${PAIR_ADDRESS}&walletAddress=${WALLET_ADDRESS}&network=mainnet`,
    });

    expect(response.statusCode).toBe(500);
  });
});
