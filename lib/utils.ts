/**
 * Tiny utility shed shared across the app.
 * Keep this file dependency-light — heavier helpers belong in their own module.
 */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Combine Tailwind classes safely (de-duplicates conflicting utility classes). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format a number 0-100 as an integer percentage. */
export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

/** Clamp a number into [min, max]. */
export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
