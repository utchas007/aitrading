/**
 * Bot State Manager
 * Persists bot running state to PostgreSQL so it survives page refreshes
 */

import { prisma } from './db';
import { Prisma } from '@prisma/client';
import { createLogger } from './logger';

const log = createLogger('bot-state');

export interface BotConfig {
  pairs: string[];
  autoExecute: boolean;
  minConfidence: number;
  checkInterval: number;
  maxPositions?: number;
  riskPerTrade?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
}

export interface BotStateData {
  isRunning: boolean;
  startedAt: Date | null;
  stoppedAt: Date | null;
  config: BotConfig | null;
}

/**
 * Get current bot state from database
 */
export async function getBotState(): Promise<BotStateData> {
  try {
    const state = await prisma.botState.findUnique({
      where: { id: 1 },
    });
    
    if (!state) {
      // Initialize default state
      return {
        isRunning: false,
        startedAt: null,
        stoppedAt: null,
        config: null,
      };
    }
    
    return {
      isRunning: state.isRunning,
      startedAt: state.startedAt,
      stoppedAt: state.stoppedAt,
      config: state.config as BotConfig | null,
    };
  } catch (error) {
    log.error('Failed to get bot state', { error: String(error) });
    return {
      isRunning: false,
      startedAt: null,
      stoppedAt: null,
      config: null,
    };
  }
}

/**
 * Set bot as running
 */
export async function setBotRunning(config: BotConfig): Promise<void> {
  try {
    log.info('Saving bot state to database');
    await prisma.botState.upsert({
      where: { id: 1 },
      update: {
        isRunning: true,
        startedAt: new Date(),
        stoppedAt: null,
        config: config as any,
      },
      create: {
        id: 1,
        isRunning: true,
        startedAt: new Date(),
        stoppedAt: null,
        config: config as any,
      },
    });
    log.info('Bot state saved successfully');
  } catch (error) {
    log.error('Failed to set bot running', { error: String(error) });
  }
}

/**
 * Set bot as stopped
 */
export async function setBotStopped(): Promise<void> {
  try {
    log.info('Setting bot as stopped');
    await prisma.botState.upsert({
      where: { id: 1 },
      update: {
        isRunning: false,
        stoppedAt: new Date(),
      },
      create: {
        id: 1,
        isRunning: false,
        stoppedAt: new Date(),
        config: Prisma.JsonNull,
      },
    });
    log.info('Bot stopped state saved');
  } catch (error) {
    log.error('Failed to set bot stopped', { error: String(error) });
  }
}

/**
 * Check if bot should be running (for recovery after server restart)
 */
export async function shouldBotBeRunning(): Promise<{ should: boolean; config: BotConfig | null }> {
  const state = await getBotState();
  return {
    should: state.isRunning,
    config: state.config,
  };
}
