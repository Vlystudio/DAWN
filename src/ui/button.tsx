import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

/** Minimal shadcn-style Button (Tailwind + cva, no Radix dependency). */
const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed select-none',
  {
    variants: {
      variant: {
        default: 'bg-panel2/60 border border-border text-ink hover:bg-panel2',
        primary: 'bg-neural-cyan/20 border border-neural-cyan/70 text-neural-cyan hover:bg-neural-cyan/30',
        danger: 'bg-neural-red/15 border border-neural-red/60 text-neural-red hover:bg-neural-red/25',
        ghost: 'bg-transparent border border-transparent text-dim hover:text-ink hover:bg-panel2/50',
        glass: 'glass-soft text-ink hover:border-neural-cyan/60',
      },
      size: {
        default: 'px-4 py-2',
        sm: 'px-3 py-1.5 text-xs',
        lg: 'px-6 py-3 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';
