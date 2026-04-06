import { XExchange } from '../../../../src/connectors/xexchange/xexchange';
import { fastifyWithTypeProvider } from '../../../utils/testUtils';

jest.mock('../../../../src/services/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../../../src/connectors/xexchange/xexchange', () => ({
  XExchange: { getInstance: jest.fn() },
}));
jest.mock('../../../../src/connectors/uniswap/uniswap.utils', () => ({
  formatTokenAmount: jest.fn((amount: string, decimals: number) => parseFloat(amount) / Math.pow(10, decimals)),
}));

const PAIR_ADDRESS = 'erd1qqqqqqqqqqqqqpgqeel2kumf0r8ffyhth7pqdujjat9nx0862jpsg2pqaq';
const WEGLD_ID = 'WEGLD-bd4d79';
const USDC_ID = 'USDC-c76f1f';
const LP_TOKEN_ID = 'EGLDUSDC-594e5e';

const mockWegld = { name: 'WEGLD', symbol: 'WEGLD', address: WEGLD_ID, decimals: 18 };
const mockUsdc = { name: 'USDC', symbol: 'USDC', address: USDC_ID, decimals: 6 };

const mockPoolData = {
  firstTokenId: WEGLD_ID,
  secondTokenId: USDC_ID,
  firstReserve: { toFixed: () => '10000000000000000000' }, // 10 WEGLD
  secondReserve: { toFixed: () => '1500000000' }, // 1500 USDC
  lpSupply: { toFixed: () => '3872983346207417' },
  lpTokenId: LP_TOKEN_ID,
  totalFeePercent: 300,
};

const buildMockXExchange = (poolData = mockPoolData) => ({
  getTokenByName: jest.fn((name: string) => {
    if (name === WEGLD_ID) return mockWegld;
    if (name === USDC_ID) return mockUsdc;
    return null;
  }),
  getPoolData: jest.fn().mockResolvedValue(poolData),
  config: { slippagePct: 1, gasLimitEstimate: 25000000, routerAbi: '', pairAbi: '', availableNetworks: [] },
});

const buildApp = async () => {
  const server = fastifyWithTypeProvider();
  await server.register(require('@fastify/sensible'));
  const { poolInfoRoute } = await import('../../../../src/connectors/xexchange/amm-routes/poolInfo');
  await server.register(poolInfoRoute);
  return server;
};

describe('GET /pool-info', () => {
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

  it('should return 200 with pool info', async () => {
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());

    const response = await server.inject({
      method: 'GET',
      url: '/pool-info',
      query: { network: 'mainnet', poolAddress: PAIR_ADDRESS },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('address', PAIR_ADDRESS);
    expect(body).toHaveProperty('baseTokenAddress', WEGLD_ID);
    expect(body).toHaveProperty('quoteTokenAddress', USDC_ID);
    expect(body).toHaveProperty('feePct', 0.3);
    expect(body).toHaveProperty('price');
    expect(body.price).toBeGreaterThan(0);
    expect(body).toHaveProperty('baseTokenAmount');
    expect(body).toHaveProperty('quoteTokenAmount');
  });

  it('should return feePct = 0.3 when totalFeePercent = 300', async () => {
    (XExchange.getInstance as jest.Mock).mockResolvedValue(buildMockXExchange());

    const response = await server.inject({
      method: 'GET',
      url: '/pool-info',
      query: { network: 'mainnet', poolAddress: PAIR_ADDRESS },
    });

    const body = JSON.parse(response.body);
    expect(body.feePct).toBeCloseTo(0.3, 5);
  });

  it('should return 500 on contract query failure', async () => {
    const mockXExchange = buildMockXExchange();
    mockXExchange.getPoolData.mockRejectedValue(new Error('Contract error'));
    (XExchange.getInstance as jest.Mock).mockResolvedValue(mockXExchange);

    const response = await server.inject({
      method: 'GET',
      url: '/pool-info',
      query: { network: 'mainnet', poolAddress: PAIR_ADDRESS },
    });

    expect(response.statusCode).toBe(500);
  });
});
