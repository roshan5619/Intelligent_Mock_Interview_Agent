/**
 * Button — primary CTA component used across the app.
 * Variants: default (gradient), secondary (glass), ghost (text-only), outline.
 *
 * Decoupling: this component knows nothing about routing — wrap with <Link>
 * (Next.js) or pass an onClick. Style only.
 */
'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

type Variant = 'default' | 'secondary' | 'ghost' | 'outline';
type Size = 'sm' | 'md' | 'lg';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variants: Record<Variant, string> = {
  default:
    'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-500/25 hover:shadow-brand-500/40 hover:from-brand-400 hover:to-brand-600',
  secondary:
    'glass text-foreground hover:bg-white/[0.07] border-white/15',
  ghost:
    'text-muted-foreground hover:text-foreground hover:bg-white/[0.05]',
  outline:
    'border border-white/15 text-foreground hover:bg-white/[0.05]',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-lg',
  md: 'h-11 px-5 text-sm rounded-xl',
  lg: 'h-13 px-7 text-base rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'default', size = 'md', ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 font-medium transition-all',
        'disabled:opacity-50 disabled:pointer-events-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        variants[variant],
        sizes[size],
        className
      )}
      {...rest}
    />
  );
});
