import React, { useEffect, useMemo } from 'react';
import BN from 'bignumber.js';
import {
  useLiquidityHubManager,
  useUserSlippageTolerance,
} from 'state/user/hooks';
import { useActiveWeb3React } from 'hooks';
import { useLocation } from 'react-router-dom';
import { styled } from '@material-ui/styles';
import { Box } from '@material-ui/core';
import OrbsLogo from 'assets/images/orbs-logo.svg';
import { useTranslation } from 'react-i18next';
import { useLiquidityHubState } from 'state/swap/liquidity-hub/hooks';
import { submitLiquidityHubTrade, swap } from './liquidity-hub-npm';
const API_ENDPOINT = 'https://hub.orbs.network';
const WEBSITE = 'https://www.orbs.com';

export const useLiquidityHubCallback = (
  srcToken?: string,
  destToken?: string,
) => {
  const [liquidityHubDisabled] = useLiquidityHubManager();
  const { account, library } = useActiveWeb3React();
  const liquidityHubState = useLiquidityHubState();
  const [userSlippageTolerance] = useUserSlippageTolerance();
  const queryParam = useQueryParam();

  return async (srcAmount?: string, minDestAmount?: string) => {
    if (
      !minDestAmount ||
      !destToken ||
      !srcAmount ||
      !srcToken ||
      liquidityHubDisabled ||
      !library ||
      !account ||
      queryParam === LiquidityHubControl.SKIP ||
      (liquidityHubState.isFailed && queryParam !== LiquidityHubControl.FORCE)
    ) {
      return undefined;
    }
    try {
      const txHash = await submitLiquidityHubTrade({
        slippage: userSlippageTolerance / 100,
        inAmount: srcAmount,
        outAmount: minDestAmount,
        inToken: srcToken,
        outToken: destToken,
        user: account,
        provider: library.provider as any,
        chainId: 137,
      });
      const txResponse = await waitForTx(txHash, library);
      return txResponse;
    } catch (error) {
      return undefined;
    }
  };
};

async function waitForTx(txHash: string, library: any) {
  for (let i = 0; i < 30; ++i) {
    // due to swap being fetch and not web3

    await delay(3_000); // to avoid potential rate limiting from public rpc
    try {
      const tx = await library.getTransaction(txHash);
      if (tx && tx instanceof Object && tx.blockNumber) {
        return tx;
      }
    } catch (error) {}
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

enum LiquidityHubControl {
  FORCE = '1',
  SKIP = '2',
}

export const useQueryParam = () => {
  const location = useLocation();

  const query = useMemo(() => new URLSearchParams(location.search), [
    location.search,
  ]);

  return query.get('liquidity-hub')?.toLowerCase();
};

export const LiquidityHubTxSettings = () => {
  const { t } = useTranslation();
  return (
    <StyledLiquidityHubTxSettings>
      <p>{t('disableLiquidityHub')}</p>
      <p className='bottom-text'>
        <img src={OrbsLogo} />
        <a target='_blank' rel='noreferrer' href={`${WEBSITE}/liquidity-hub`}>
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
  );
};

export const LiquidityHubConfirmationModalContent = ({
  txPending,
}: {
  txPending?: boolean;
}) => {
  const { t } = useTranslation();
  const liquidityHubState = useLiquidityHubState();

  if (!liquidityHubState?.isWon || txPending) {
    return null;
  }
  return (
    <StyledLiquidityHubTrade>
      <span>{t('using')}</span>{' '}
      <a href='orbs.com/liquidity-hub' target='_blank' rel='noreferrer'>
        {t('liquidityHub')}
      </a>{' '}
      {t('by')}{' '}
      <a href={WEBSITE} target='_blank' rel='noreferrer'>
        Orbs
        <img src={OrbsLogo} />
      </a>
    </StyledLiquidityHubTrade>
  );
};

// styles
const StyledLiquidityHubTrade = styled('p')({
  '& a': {
    textDecoration: 'none',
    display: 'inline-flex',
    gap: 5,
    fontWeight: 600,
    color: 'white',
    '&:hover': {
      textDecoration: 'underline',
    },
  },
  '& span': {
    textTransform: 'capitalize',
    fontSize: 'inherit',
  },
  '& img': {
    width: 22,
    height: 22,
    objectFit: 'contain',
  },
});

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


export const useConfirmationPendingContent = (pendingText?: string) => {
  const { t } = useTranslation();
  const liquidityHubState = useLiquidityHubState();
  return useMemo(() => {
    if (liquidityHubState?.waitingForApproval) {
      return {
        title: t('optimizedRouteAvailable'),
        pending: pendingText,
        confirm: t('awaitingApproval'),
      };
    }
    if (liquidityHubState?.isLoading) {
      return {
        title: t('seekingBestPrice'),
      };
    }
    if (liquidityHubState?.isWon) {
      return {
        title: t('optimizedRouteAvailable'),
        pending: pendingText,
        confirm:
          liquidityHubState.waitingForSignature &&
          t('signToPerformGaslessSwap'),
      };
    }
    return {
      title: t('waitingConfirm'),
      pending: pendingText,
      confirm: t('confirmTxinWallet'),
    };
  }, [
    liquidityHubState?.isLoading,
    liquidityHubState?.isWon,
    pendingText,
    t,
    liquidityHubState?.waitingForApproval,
    liquidityHubState.waitingForSignature,
  ]);
};
