export type EstimatePlatform = 'viber' | 'whatsapp' | 'telegram';
export const REFERENCE_SECONDS: Record<EstimatePlatform, number>;
export const CANARY_SECONDS: Record<EstimatePlatform, number>;
export const RECENT_TASKS: number;
export function secondsPerChat(platform: EstimatePlatform, finishedAt?: number[], perHour?: number): number;
export function roundMinutes(seconds: number): number;
export function durationLabel(minutes: number): string;
export function estimateBatch(input: { platform: EstimatePlatform; remaining: number; finishedAt?: number[]; perHour?: number; canaryPending?: boolean; now?: number }): { seconds: number; minutes: number; endAt: number; text: string };
export function estimateFromSeconds(seconds: number, now?: number): { seconds: number; minutes: number; endAt: number; text: string };
