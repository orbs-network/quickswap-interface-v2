import React, { useCallback, useEffect, useMemo } from 'react';
import { useUserSlippageTolerance } from 'state/user/hooks';
import { useActiveWeb3React } from 'hooks';
import { styled } from '@material-ui/styles';
import { Box, Divider } from '@material-ui/core';
import OrbsLogo from 'assets/images/orbs-logo.svg';
import { useTranslation } from 'react-i18next';
import ToggleSwitch from 'components/ToggleSwitch';
import { useUSDCPriceFromAddress } from 'utils/useUSDCPrice';
import { Trade, Currency } from '@uniswap/sdk';
import { Field } from 'state/swap/actions';
import { Currency as CoreCurrency, Percent } from '@uniswap/sdk-core';
import { wrappedCurrency } from 'utils/wrappedCurrency';
import {
  useSettings,
  WEBSITE,
  isSupportedChain,
  analytics,
  amountBN,
} from '@orbs-network/liquidity-hub-lib';
import { zeroAddress } from '@defi.org/web3-candies';
import { useWeb3React } from '@web3-react/core';
import { OptimalRate, SwapSide } from '@paraswap/sdk';
import { BigNumber } from 'ethers';
import { parseUnits } from 'ethers/lib/utils';

const partner = 'quickswap';

const useIsSupportedChain = () => {
  const { chainId } = useWeb3React();

  return useMemo(() => isSupportedChain(partner, chainId), [chainId]);
};

export const LiquidityHubTxSettings = () => {
  const { liquidityHubEnabled, updateLiquidityHubEnabled } = useSettings();
  const { t } = useTranslation();

  const isSupported = useIsSupportedChain();

  if (!isSupported) return null;

  return (
    <>
      <Box my={2.5} className='flex items-center justify-between'>
        <StyledLiquidityHubTxSettings>
          <p>{t('disableLiquidityHub')}</p>
          <p className='bottom-text'>
            <img src={OrbsLogo} />
            <a
              target='_blank'
              rel='noreferrer'
              href={`${WEBSITE}/liquidity-hub`}
            >
              {t('liquidityHub')}
            </a>
            , {t('poweredBy').toLowerCase()}{' '}
            <a href={WEBSITE} target='_blank' rel='noreferrer'>
              Orbs
            </a>
            , {t('aboutLiquidityHub')}{' '}
            <a
              className='more-info'
              href={`${WEBSITE}/liquidity-hub`}
              target='_blank'
              rel='noreferrer'
            >
              {t('forMoreInfo')}
            </a>
          </p>
        </StyledLiquidityHubTxSettings>
        <ToggleSwitch
          toggled={!liquidityHubEnabled}
          onToggle={updateLiquidityHubEnabled}
        />
      </Box>
      <Divider />
    </>
  );
};

const StyledLiquidityHubTxSettings = styled(Box)({
  display: 'flex',
  flexDirection: 'column',
  '& .bottom-text': {
    maxWidth: 500,
    fontSize: 14,
    lineHeight: '23px',
    '& img': {
      width: 22,
      height: 22,
      marginRight: 8,
      position: 'relative',
      top: 6,
    },
    '& a': {
      textDecoration: 'none',
      fontWeight: 600,
      color: '#6381e9',
      '&:hover': {
        textDecoration: 'underline',
      },
    },
    '& .more-info': {
      color: 'inherit',
      fontWeight: 400,
      textDecoration: 'underline',
    },
  },
});

const useSlippage = () => {
  const [allowedSlippage] = useUserSlippageTolerance();
  return allowedSlippage / 100;
};

export function useV3Trade({
  INPUT,
  OUTPUT,
}: {
  INPUT?: CoreCurrency | undefined;
  OUTPUT?: CoreCurrency | undefined;
}) {
  const currencies = {
    [Field.INPUT]: INPUT,
    [Field.OUTPUT]: OUTPUT,
  };
  const outTokenUSD = useUSDCPriceFromAddress(
    currencies[Field.OUTPUT]?.wrapped.address || '',
  ).price;

  const srcTokenCurrency = currencies[Field.INPUT];
  const dstTokenCurrency = currencies[Field.OUTPUT];
  const slippage = useSlippage();
  const { chainId } = useActiveWeb3React();

  return useCallback(
    function(formattedAmounts: { [x: string]: any; [x: number]: any }) {
      const fromToken = srcTokenCurrency?.isNative
        ? { ...srcTokenCurrency, address: zeroAddress }
        : srcTokenCurrency;
      const toToken = dstTokenCurrency?.isNative
        ? { ...dstTokenCurrency, address: zeroAddress }
        : dstTokenCurrency;
      if (!chainId) return;
      analytics?.initSwap({
        fromToken,
        toToken,
        srcAmountUI: formattedAmounts[Field.INPUT],
        dexAmountOutUI: formattedAmounts[Field.OUTPUT],
        dstTokenUsdValue: outTokenUSD,
        slippage,
        tradeType: 'V3',
        chainId,
        partner,
      });
    },
    [srcTokenCurrency, dstTokenCurrency, outTokenUSD, slippage, chainId],
  );
}

export const useV2Trade = (currencies: {
  INPUT?: Currency | undefined;
  OUTPUT?: Currency | undefined;
}) => {
  const { chainId } = useActiveWeb3React();
  const srcTokenCurrency = currencies[Field.INPUT];
  const dstTokenCurrency = currencies[Field.OUTPUT];
  const inToken = wrappedCurrency(srcTokenCurrency, chainId);
  const outToken = wrappedCurrency(dstTokenCurrency, chainId);
  const outTokenUSD = useUSDCPriceFromAddress(outToken?.address).price;
  const slippage = useSlippage();

  return useCallback(
    (trade?: Trade) => {
      analytics?.initSwap({
        fromToken: inToken,
        toToken: outToken,
        srcAmount: trade?.inputAmount.raw.toString(),
        dexAmountOut: trade?.outputAmount.raw.toString(),
        dstTokenUsdValue: outTokenUSD,
        slippage,
        tradeType: 'V2',
        chainId,
        partner,
      });
    },
    [inToken, outToken, outTokenUSD, slippage, chainId],
  );
};

export const useTwapTrade = () => {
  const slippage = useSlippage();
  const { chainId } = useActiveWeb3React();

  return useCallback(
    (
      {
        srcAmount,
        srcToken,
        dstToken,
        dexAmountOut,
        dstTokenUsdValue,
      }: {
        srcAmount: string;
        srcToken: any;
        dstToken: any;
        dexAmountOut: string;
        dstTokenUsdValue: number;
      },
      isLimit: boolean,
    ) => {
      if (!chainId) return;
      analytics?.initSwap({
        fromToken: srcToken,
        toToken: dstToken,
        srcAmount: srcAmount,
        dexAmountOut,
        dstTokenUsdValue,
        slippage,
        tradeType: isLimit ? 'LIMIT' : 'TWAP',
        chainId,
        partner,
      });
    },
    [slippage, chainId],
  );
};

export const lhAnalytics = {
  useTwapTrade,
  useV2Trade,
  useV3Trade,
  ...analytics,
};
