import {
  bn,
  hasWeb3Instance,
  maxUint256,
  permit2Address,
  sendAndWaitForConfirmations,
  setWeb3Instance,
  signEIP712,
  web3,
} from '@defi.org/web3-candies';
import { create } from 'zustand';
const API_ENDPOINT = 'https://hub.orbs.network';
export const ORBS_WEBSITE = 'https://www.orbs.com';

import Web3 from 'web3';
import { ERC20_ABI } from 'constants/abis/erc20';
export interface QuoteArgs {
  inToken: string;
  outToken: string;
  inAmount: string;
  outAmount: string;
  user: string;
  slippage: number;
}
interface SwapArgs {
  user: string;
  inToken: string;
  outToken: string;
  inAmount: string;
  outAmount: string;
  signature: string;
  quoteResult: any;
  chainId: number;
}

interface ApproveArgs {
  user: string;
  inToken: string;
  inAmount: string;
  provider: any;
}

interface SubmitLiquidityTradeArgs extends SwapArgs, QuoteArgs, ApproveArgs {
  provider: any;
}

interface QuoteResponse {
  outAmount: string;
  serializedOrder: string;
  callData: string;
  permitData: any;
}

interface LiquidityHubSate {
  isWon: boolean;
  isFailed: boolean;
  outAmount?: string;
  waitingForApproval: boolean;
  waitingForSignature: boolean;
  isSwapping: boolean;
  isQuoting: boolean;
  updateState: (state: Partial<LiquidityHubSate>) => void;
}

const initialState = {
  isWon: false,
  isQuoting: false,
  isSwapping: false,
  isFailed: false,
  outAmount: undefined,
  waitingForApproval: false,
  waitingForSignature: false,
};

export const useLiquidityHubSate = create<LiquidityHubSate>((set, get) => ({
  ...initialState,
  updateState: (state) => set({ ...get(), ...state }),
}));

export const quote = async (args: QuoteArgs): Promise<QuoteResponse> => {
  try {
    useLiquidityHubSate.getState().updateState({ isQuoting: true });
    liquidityHubAnalytics.onQuoteRequest(args.outAmount);
    const count = counter();
    const response = await fetch(`${API_ENDPOINT}/quote?chainId=137`, {
      method: 'POST',
      body: JSON.stringify({
        inToken: args.inToken,
        outToken: args.outToken,
        inAmount: args.inAmount,
        outAmount: args.outAmount,
        user: args.user,
        slippage: args.slippage,
        qs: encodeURIComponent(location.search),
      }),
    });
    const result: QuoteResponse = await response.json();

    if (!result) {
      throw new Error('Missing result');
    }

    liquidityHubAnalytics.onQuoteSuccess(
      result.outAmount,
      result.serializedOrder,
      result.callData,
      result.permitData,
      count(),
    );

    if (bn(result.outAmount).isLessThan(bn(args.outAmount))) {
      liquidityHubAnalytics.onClobLowAmountOut();
      throw new Error('Dex trade is better than LiquidityHub trade');
    }

    useLiquidityHubSate
      .getState()
      .updateState({ outAmount: result.outAmount, isWon: true });

    return result;
  } catch (error) {
    liquidityHubAnalytics.onQuoteFailed(error.message);
    throw error;
  } finally {
    useLiquidityHubSate.getState().updateState({ isQuoting: false });
  }
};

export const sign = async (account: string, provider: any, permitData: any) => {
  try {
    useLiquidityHubSate.getState().updateState({ waitingForSignature: true });
    if (!hasWeb3Instance()) {
      setWeb3Instance(new Web3(provider));
    }
    const web3 = new Web3(provider);
    process.env.DEBUG = 'web3-candies';

    const signature = await signEIP712(account!, permitData);
    liquidityHubAnalytics.onSignatureSuccess(signature);
    return signature;
  } catch (error) {
    liquidityHubAnalytics.onSignatureFailed(error.message);
    throw error;
  } finally {
    useLiquidityHubSate.getState().updateState({ waitingForSignature: false });
  }
};

export const swap = async (args: SwapArgs): Promise<string> => {
  try {
    useLiquidityHubSate.getState().updateState({ isSwapping: true });
    const count = counter();
    liquidityHubAnalytics.onSwapRequest();
    const txHashResponse = await fetch(
      `${API_ENDPOINT}/swapx?chainId=${args.chainId}`,
      {
        method: 'POST',
        body: JSON.stringify({
          inToken: args.inToken,
          outToken: args.outToken,
          inAmount: args.inAmount,
          outAmount: args.outAmount,
          user: args.user,
          signature: args.signature,
          ...args.quoteResult,
        }),
      },
    );
    const swap = await txHashResponse.json();
    if (!swap || !swap.txHash) {
      throw new Error('Missing txHash');
    }

    liquidityHubAnalytics.onSwapSuccess(swap.txHash, count());
    return swap.txHash;
  } catch (error) {
    liquidityHubAnalytics.onSwapFailed(error.message);
    throw error;
  } finally {
    useLiquidityHubSate.getState().updateState({ isSwapping: false });
  }
};

const approve = async (args: ApproveArgs) => {
  try {
    const web3 = new Web3(args.provider);
    const contract = new web3.eth.Contract(ERC20_ABI as any, args.inToken);

    const allowance = await contract.methods
      ?.allowance(args.user, permit2Address)
      .call();
    if (bn(allowance.toString()).gte(bn(args.inAmount))) {
      liquidityHubAnalytics.onTokenApproved();
      return;
    }
    useLiquidityHubSate.getState().updateState({ waitingForApproval: true });
    liquidityHubAnalytics.onApproveRequest();
    setWeb3Instance(new Web3(args.provider));
    const tx = contract.methods
      .approve(permit2Address, maxUint256)
      .send({ from: args.user });
    await sendAndWaitForConfirmations(tx, {});
    liquidityHubAnalytics.onTokenApproved();
  } catch (error) {
    liquidityHubAnalytics.onApproveFailed(error.message);
  } finally {
    useLiquidityHubSate.getState().updateState({ waitingForApproval: false });
  }
};

export const submitLiquidityHubTrade = async (args: SubmitLiquidityTradeArgs) => {
  try {
    const quoteArgs = {
      inToken: args.inToken,
      outToken: args.outToken,
      inAmount: args.inAmount,
      outAmount: args.outAmount,
      user: args.user,
      slippage: args.slippage,
    };
    await quote(quoteArgs);
    await approve({
      user: args.user,
      inToken: args.inToken,
      inAmount: args.inAmount,
      provider: args.provider,
    });
    const quoteResult = await quote(quoteArgs);
    const signature = await sign(
      args.user,
      args.provider,
      quoteResult.permitData,
    );
    const txHash = await swap({
      inAmount: args.inAmount,
      outAmount: args.outAmount,
      inToken: args.inToken,
      outToken: args.outToken,
      user: args.user,
      chainId: args.chainId,
      quoteResult,
      signature,
    });
    return txHash;
  } catch (error) {
    throw error;
  }
};

interface State {
  state: string;
  time: number;
}
interface LiquidityHubAnalyticsData {
  _id: string;
  state: State;
  walletAddress?: string;
  srcTokenAddress: string;
  srcTokenSymbol: string;
  dstTokenAddress: string;
  dstTokenSymbol: string;
  srcAmount: string;
  dstAmountOut: string;
  clobOutAmount: string;
  approvalAmount: string;
  approvalSpender: string;
  approveFailedError: string;
  clobAmountOut: string;
  dexAmountOut: string;
  isClobTrade: boolean;
  quoteFailedError: string;
  quoteRequestDurationMillis: number;
  swapTxHash: string;
  swapFailedError: string;
  signature: string;
  serializedOrder: string;
  callData: string;
  permitData: string;
  signatureFailedError: string;
  swapRequestDurationMillis: number;
}

const counter = () => {
  const now = Date.now();

  return () => {
    return Date.now() - now;
  };
};

class LiquidityHubAnalytics {
  history: State[] = [];
  initialTimestamp = Date.now();
  data = { _id: crypto.randomUUID() } as LiquidityHubAnalyticsData;

  private update({
    newState,
    values = {},
  }: {
    newState: string;
    values?: Partial<LiquidityHubAnalyticsData>;
  }) {
    if (this.data.state) {
      this.history.push(this.data.state);
    }

    this.data.state = {
      state: newState,
      time: Date.now() - this.initialTimestamp,
    };
    this.data = { ...this.data, ...values };

    fetch('https://bi.orbs.network/putes/clob-ui', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...this.data, history: this.history }),
    }).catch();
  }

  onWalletConnected(walletAddress?: string) {
    this.update({
      newState: 'walletConnected',
      values: { walletAddress },
    });
  }

  onSrcToken(srcTokenAddress: string, srcTokenSymbol: string) {
    this.update({
      newState: 'srcToken',
      values: { srcTokenAddress, srcTokenSymbol },
    });
  }

  onDstToken(dstTokenAddress: string, dstTokenSymbol: string) {
    this.update({
      newState: 'dstToken',
      values: { dstTokenAddress, dstTokenSymbol },
    });
  }

  onDisabled() {
    this.update({
      newState: 'clobDisabled',
    });
  }

  onSrcAmount(srcAmount: string) {
    this.update({
      newState: 'srcAmount',
      values: { srcAmount },
    });
  }

  onPageLoaded() {
    this.update({
      newState: 'swapPageLoaded',
    });
  }

  onApproveRequest() {
    this.update({
      newState: 'approveRequest',
      values: {
        approveFailedError: '',
      },
    });
  }

  onTokenApproved() {
    this.update({
      newState: 'approved',
    });
  }

  onApproveFailed(approveFailedError: string) {
    this.update({
      newState: 'approveFailed',
      values: { approveFailedError },
    });
  }

  onSwapClick() {
    this.update({
      newState: 'swapClick',
    });
  }

  onConfirmSwapClick() {
    this.update({
      newState: 'swapConfirmClick',
    });
  }

  onQuoteRequest(dexAmountOut: string) {
    this.update({
      newState: 'quoteRequest',
      values: {
        dexAmountOut,
        quoteFailedError: '',
      },
    });
  }

  onQuoteSuccess(
    clobAmountOut: string,
    serializedOrder: string,
    callData: string,
    permitData: any,
    quoteRequestDurationMillis: number,
  ) {
    this.update({
      newState: 'quoteSuccess',
      values: {
        clobAmountOut,
        quoteRequestDurationMillis,
        isClobTrade: bn(this.data.dexAmountOut).isLessThan(bn(clobAmountOut)),
        serializedOrder,
        callData,
        permitData,
      },
    });
  }
  onQuoteFailed(quoteFailedError: string) {
    this.update({
      newState: 'quoteFailed',
      values: {
        quoteFailedError,
      },
    });
  }

  onClobLowAmountOut() {
    this.update({
      newState: 'clobLowAmountOut',
    });
  }

  onSignatureRequest() {
    this.update({
      newState: 'signatureRequest',
    });
  }
  onSignatureSuccess(signature: string) {
    this.update({
      newState: 'signatureSuccess',
      values: { signature },
    });
  }

  onSignatureFailed(signatureFailedError: string) {
    this.update({
      newState: 'signatureFailed',
      values: { signatureFailedError },
    });
  }

  onSwapRequest() {
    this.update({
      newState: 'swapRequest',
      values: { swapFailedError: '' },
    });
  }

  onSwapSuccess(swapTxHash: string, swapRequestDurationMillis: number) {
    this.update({
      newState: 'swapSuccess',
      values: { swapTxHash, swapRequestDurationMillis },
    });
  }

  onSwapFailed(swapFailedError: string) {
    this.update({
      newState: 'swapFailed',
      values: { swapFailedError },
    });
  }
}

export const liquidityHubAnalytics = new LiquidityHubAnalytics();
