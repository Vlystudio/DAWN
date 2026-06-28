import React from 'react';
import { cn } from '../lib/cn';

/** shadcn-style glass card primitives. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('glass p-4', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('text-sm font-semibold text-ink', className)} {...props} />;
}
export function CardRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between text-xs py-0.5">
      <span className="text-dim">{label}</span>
      <span className="font-medium text-ink">{value}</span>
    </div>
  );
}
