import { BigNumber, ContractWrappers, SignerType, signatureUtils } from '0x.js';
import ethUtil from 'ethereumjs-util';
import { cache, time } from '../decorators/cls';

export default class ZeroExClient {
  static NULL_ADDRESS = '0x0000000000000000000000000000000000000000';
  static ZERO = new BigNumber(0);
  static MAX = new BigNumber(2).pow(256).minus(1);
  static ORDER_FIELDS = [
    'exchangeAddress',
    'expirationTimeSeconds',
    'feeRecipientAddress',
    'makerAddress',
    'makerAssetAmount',
    'makerAssetData',
    'makerFee',
    'salt',
    'senderAddress',
    'signature',
    'takerAddress',
    'takerAssetAmount',
    'takerAssetData',
    'takerFee'
  ];

  constructor(ethereumClient, options = {}) {
    this.ethereumClient = ethereumClient;
    this.options = options;
  }

  async filterFillableOrders(orders) {
    const wrappers = await this.getContractWrappers();
    const orderFillableStatuses = await Promise.all(
      orders.map(async order => {
        try {
          await wrappers.exchange.validateOrderFillableOrThrowAsync(order);
          return true;
        } catch (err) {
          return false;
        }
      })
    );
    const fillableOrders = orders.filter(
      (order, index) => orderFillableStatuses[index]
    );
    return fillableOrders;
  }

  async filterTestOrderFill(orders, amount, account) {
    const wrappers = await this.getContractWrappers();
    const orderFillableStatuses = await Promise.all(
      orders.map(async order => {
        try {
          await wrappers.exchange.validateFillOrderThrowIfInvalidAsync(
            order,
            new BigNumber(amount),
            `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`
          );
          return true;
        } catch (err) {
          return false;
        }
      })
    );
    const fillableOrders = orders.filter(
      (order, index) => orderFillableStatuses[index]
    );
    return fillableOrders;
  }

  @time
  async getContractWrappers() {
    return new ContractWrappers(this.ethereumClient.getCurrentProvider(), {
      networkId: await this.ethereumClient.getNetworkId()
    });
  }

  @time
  @cache('0x:v2:exchange:address', 60 * 60 * 24)
  async getExchangeContractAddress() {
    const wrappers = await this.getContractWrappers();
    return wrappers.exchange.getContractAddress();
  }

  @time
  @cache('0x:v2:exchange:ZRX:address', 60 * 60 * 24)
  async getZRXTokenAddress() {
    const wrappers = await this.getContractWrappers();
    return wrappers.exchange.getZRXTokenAddress();
  }

  @time
  @cache('0x:v2:ether-token:WETH:address', 60 * 60 * 24)
  async getWETHTokenAddress() {
    const wrappers = await this.getContractWrappers();
    return (
      wrappers.etherToken.getContractAddressIfExists() ||
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    );
  }

  @time
  @cache('0x:v2:exchange:order:filled:{}', 60)
  async getFilledTakerAmount(orderHash) {
    const wrappers = await this.getContractWrappers();
    return wrappers.exchange.getFilledTakerAssetAmountAsync(orderHash);
  }

  @time
  async signOrderHash(orderHash) {
    const account = await this.ethereumClient.getAccount();
    return signatureUtils.ecSignOrderHashAsync(
      this.ethereumClient.getCurrentProvider(),
      orderHash,
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      SignerType.Metamask
    );
  }

  @time
  async depositEther(amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    const WETHAddress = await this.getWETHTokenAddress(true);
    return wrappers.etherToken.depositAsync(
      WETHAddress,
      new BigNumber(amount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`
    );
  }

  @time
  async withdrawEther(amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    const WETHAddress = await this.getWETHTokenAddress(true);
    return wrappers.etherToken.withdrawAsync(
      WETHAddress,
      new BigNumber(amount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`
    );
  }

  @time
  async fillOrKillOrder(order, amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    return wrappers.exchange.fillOrKillOrderAsync(
      order,
      new BigNumber(amount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      { shouldValidate: false }
    );
  }

  @time
  async fillOrKillOrders(orders, amounts) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    return wrappers.exchange.batchFillOrKillOrdersAsync(
      orders,
      amounts.map(amount => new BigNumber(amount)),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      { shouldValidate: false }
    );
  }

  @time
  async cancelOrder(order) {
    const wrappers = await this.getContractWrappers();
    return wrappers.exchange.cancelOrderAsync(order, {
      shouldValidate: false
    });
  }

  @time
  async marketBuy(orders, amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    const fillableOrders = await this.filterTestOrderFill(
      await this.filterFillableOrders(orders),
      amount,
      account
    );

    if (fillableOrders.length === 0) {
      throw new Error(
        'There are no more valid orders to fill. Sometimes this happens when there are several invalid orders stored in the orderbook.'
      );
    }

    return wrappers.exchange.marketBuyOrdersAsync(
      fillableOrders,
      new BigNumber(amount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      this.options
    );
  }

  @time
  async marketSell(orders, amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    const fillableOrders = await this.filterTestOrderFill(
      await this.filterFillableOrders(orders),
      amount,
      account
    );

    if (fillableOrders.length === 0) {
      throw new Error(
        'There are no more valid orders to fill. Sometimes this happens when there are several invalid orders stored in the orderbook.'
      );
    }

    return wrappers.exchange.marketSellOrdersAsync(
      fillableOrders,
      new BigNumber(amount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      { ...this.options, shouldValidate: true }
    );
  }

  @time
  async marketBuyWithEth(
    orders,
    feeOrders,
    feePercentage,
    feeRecipient,
    makerAmount,
    ethAmount
  ) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    const fillableOrders = await this.filterFillableOrders(orders);
    const fillableFeeOrders = await this.filterFillableOrders(feeOrders);

    if (fillableOrders.length === 0) {
      throw new Error(
        'There are no more valid orders to fill. Sometimes this happens when there are several invalid orders stored in the orderbook.'
      );
    }

    return wrappers.forwarder.marketBuyOrdersWithEthAsync(
      fillableOrders,
      new BigNumber(makerAmount),
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      new BigNumber(ethAmount),
      fillableFeeOrders,
      feePercentage,
      feeRecipient,
      this.options
    );
  }

  @time
  async marketSellEth(orders, feeOrders, feePercentage, feeRecipient, amount) {
    const wrappers = await this.getContractWrappers();
    const account = await this.ethereumClient.getAccount();
    return wrappers.forwarder.marketSellOrdersWithEthAsync(
      orders,
      `0x${ethUtil.stripHexPrefix(account.toString().toLowerCase())}`,
      new BigNumber(amount),
      feeOrders,
      feePercentage,
      feeRecipient,
      this.options
    );
  }
}
